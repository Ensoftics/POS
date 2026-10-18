import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, createLogger } from './bootstrap';
import { loadConfig } from './config/app-config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: createLogger(config),
    bufferLogs: true,
  });
  configureApp(app, config);
  await app.listen(config.PORT);
  new Logger('Bootstrap').log({ msg: 'API listening', port: config.PORT, env: config.NODE_ENV });
}

main().catch((error: unknown) => {
  // Config errors are expected to be readable; anything else prints its stack.
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
