import { Module } from '@nestjs/common';
import { CreditsModule } from '../credits/credits.module';
import { GatewayModule } from '../gateway/gateway.module';
import { OptOutsModule } from '../optouts/optouts.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsWorker } from './campaigns.worker';

@Module({
  imports: [GatewayModule, CreditsModule, OptOutsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsWorker],
  exports: [CampaignsService],
})
export class CampaignsModule {}
