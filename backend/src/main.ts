import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: needed to check WhatsApp webhook signatures
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');
  // Campaign recipient lists can be large (1 lakh numbers is about 1.5 MB)
  app.useBodyParser('json', { limit: '5mb' });
  app.enableCors({
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api`);
}

bootstrap();
