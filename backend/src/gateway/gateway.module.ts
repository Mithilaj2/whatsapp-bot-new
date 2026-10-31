import { Module } from '@nestjs/common';
import { GatewayController } from './gateway.controller';
import { GatewayService } from './gateway.service';
import { GatewayWorker } from './gateway.worker';
import { MetaProvider } from './providers/meta.provider';
import { TestProvider } from './providers/test.provider';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [GatewayController, WebhooksController],
  providers: [GatewayService, GatewayWorker, MetaProvider, TestProvider],
  exports: [GatewayService],
})
export class GatewayModule {}
