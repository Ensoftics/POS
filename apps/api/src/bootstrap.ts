import { ConsoleLogger, type LoggerService, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { CSRF_HEADER } from '@pos/contracts';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { AppConfig } from './config/app-config';

export const API_PREFIX = 'api/v1';

export function createLogger(config: AppConfig): LoggerService | false {
  if (config.LOG_FORMAT === 'silent') return false;
  return new ConsoleLogger({
    json: config.LOG_FORMAT === 'json',
    colors: config.LOG_FORMAT === 'pretty',
  });
}

/** HTTP pipeline shared by the server entry point and integration tests. */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // Needed for correct client IPs (rate limiting, audit) behind a load balancer.
  app.set('trust proxy', config.TRUST_PROXY > 0 ? config.TRUST_PROXY : false);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  // Room for CSV imports (MAX_IMPORT_BYTES plus JSON overhead); other bodies are far smaller.
  app.useBodyParser('json', { limit: '6mb' });
  // Payment providers post their notifications as HTML form data.
  app.useBodyParser('urlencoded', { extended: false, limit: '64kb' });
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Request-Id', CSRF_HEADER],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 600,
  });
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableShutdownHooks();

  if (config.ENABLE_API_DOCS) {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, () => buildOpenApiDocument(app, config));
  }
}

export function buildOpenApiDocument(
  app: NestExpressApplication,
  config: AppConfig,
): OpenAPIObject {
  const document = new DocumentBuilder()
    .setTitle('Ensoftic POS API')
    .setDescription(
      'Multi-tenant POS API. All routes except auth and health require a Bearer access token; ' +
        'the tenant is always derived from the token. Errors use the envelope `{ error: { code, message, requestId } }`.',
    )
    .setVersion(config.APP_VERSION)
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, document);
}
