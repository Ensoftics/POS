import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../app.module';
import { buildOpenApiDocument, configureApp } from '../bootstrap';
import { loadConfig } from '../config/app-config';

/** Writes docs/api/openapi.json so the contract can be reviewed in pull requests. */
async function exportOpenApi(): Promise<void> {
  const config = { ...loadConfig(), ENABLE_API_DOCS: false };
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureApp(app, config);
  await app.init();
  const target = resolve(__dirname, '../../../../docs/api/openapi.json');
  writeFileSync(target, `${JSON.stringify(buildOpenApiDocument(app, config), null, 2)}\n`);
  await app.close();
  console.warn(`OpenAPI document written to ${target}`);
}

void exportOpenApi();
