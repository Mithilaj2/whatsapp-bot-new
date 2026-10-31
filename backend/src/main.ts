import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { checkProductionConfig } from './common/config-check';

async function bootstrap() {
  checkProductionConfig();
  // rawBody: needed to check WhatsApp webhook signatures
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Behind Caddy: trust its X-Forwarded-For so we log and limit the real address
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));
  app.disable('x-powered-by');
  app.use(
    helmet({
      // The API only serves JSON and campaign images (which WhatsApp and the panel load from here)
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );

  app.setGlobalPrefix('api');
  // Campaign recipient lists can be large (1 lakh numbers is about 1.5 MB)
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: false });
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((o) => o.trim()).filter(Boolean);
  // In production the panel and API share one address per domain, so no cross-origin access is needed
  if (origins.length) app.enableCors({ origin: origins, credentials: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 4000);
  await app.listen(port, process.env.HOST || '0.0.0.0');
  console.log(`API running on port ${port}`);
}

bootstrap();
