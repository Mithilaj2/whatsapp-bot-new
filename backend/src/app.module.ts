import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { BrandingModule } from './branding/branding.module';
import { CountriesModule } from './countries/countries.module';
import { CreditsModule } from './credits/credits.module';
import { HealthController } from './common/health.controller';
import { DbModule } from './db/db.module';
import { GatewayModule } from './gateway/gateway.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { BrandsModule } from './brands/brands.module';
import { AutoResponderModule } from './autoresponder/autoresponder.module';
import { BotsModule } from './bots/bots.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AuditModule } from './audit/audit.module';
import { InboxModule } from './inbox/inbox.module';
import { MediaModule } from './media/media.module';
import { OptOutsModule } from './optouts/optouts.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    DbModule,
    AuditModule,
    AuthModule,
    AccountsModule,
    CountriesModule,
    BrandingModule,
    CreditsModule,
    GatewayModule,
    MediaModule,
    OptOutsModule,
    CampaignsModule,
    InboxModule,
    BrandsModule,
    AutoResponderModule,
    BotsModule,
    NotificationsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
  providers: [
    // Every route requires a valid login unless marked @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
