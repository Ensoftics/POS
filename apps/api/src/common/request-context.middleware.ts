import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext, type RequestContextData } from './request-context';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * The path as logged: capability codes in paths (a customer's opt-out code) are
 * replaced, so reading the logs does not let anyone act for the customer.
 */
export function loggablePath(originalUrl: string): string {
  return originalUrl.split('?')[0]!.replace(/(\/public\/unsubscribe\/)[^/]+/, '$1:code');
}

/**
 * Assigns a request ID (honouring a well-formed upstream `X-Request-Id`), binds
 * the async request context, and writes one structured access-log line per request.
 * Query strings, bodies and capability codes in paths are never logged.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', requestId);

    const userAgent = req.header('user-agent')?.slice(0, 255) ?? null;
    const context: RequestContextData = { requestId, ip: req.ip ?? null, userAgent };
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.logger.log({
        msg: 'request completed',
        requestId,
        method: req.method,
        path: loggablePath(req.originalUrl),
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        tenantId: context.principal?.tenantId,
        userId: context.principal?.userId,
      });
    });

    RequestContext.run(context, next);
  }
}
