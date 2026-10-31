import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CampaignsService } from './campaigns.service';

/** Every few seconds: refunds failed messages, starts approved campaigns, marks finished ones. */
@Injectable()
export class CampaignsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('CampaignsWorker');
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly campaigns: CampaignsService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('WORKER_ENABLED', 'true') === 'false') return;
    const every = Number(this.config.get('CAMPAIGN_SWEEP_MS', 5000));
    this.timer = setInterval(() => void this.tick(), every);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.campaigns.sweep();
    } catch (e) {
      this.log.error(`Sweep failed: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
