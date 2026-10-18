import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { ErrorCode, ErrorResponse } from '@pos/contracts';
import type { Response } from 'express';
import { AppException } from './app-exception';
import { RequestContext } from './request-context';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

const SAFE_MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Request validation failed',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'You do not have permission to perform this action',
  NOT_FOUND: 'Resource not found',
  CONFLICT: 'The request conflicts with the current state',
  RATE_LIMITED: 'Too many requests. Please wait and try again.',
};

/**
 * Converts every error into the public envelope `{ error: { code, message, requestId } }`.
 * Unknown errors are logged with their stack but reported to clients generically.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const requestId = RequestContext.get()?.requestId;
    const { status, body } = this.toEnvelope(exception, requestId);

    if (status >= 500) {
      this.logger.error({
        msg: 'unhandled error',
        requestId,
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
      });
    }
    if (!response.headersSent) response.status(status).json(body);
  }

  private toEnvelope(
    exception: unknown,
    requestId?: string,
  ): { status: number; body: ErrorResponse } {
    const build = (
      status: number,
      code: ErrorCode,
      message: string,
      issues?: ErrorResponse['error']['issues'],
    ) => ({
      status,
      body: { error: { code, message, requestId, ...(issues?.length ? { issues } : {}) } },
    });

    if (exception instanceof AppException) {
      return build(exception.getStatus(), exception.code, exception.message, exception.issues);
    }
    if (exception instanceof ThrottlerException) {
      return build(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', SAFE_MESSAGES.RATE_LIMITED!);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return build(HttpStatus.CONFLICT, 'CONFLICT', SAFE_MESSAGES.CONFLICT!);
    }
    if (exception instanceof PayloadTooLargeException) {
      // Raised by the upload handler when a file passes the configured size.
      return build(HttpStatus.PAYLOAD_TOO_LARGE, 'VALIDATION_FAILED', 'The file is too large', [
        { path: 'file', message: 'validation.image.too_large' },
      ]);
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_FAILED');
      // Framework messages (e.g. JSON parse errors) can echo input; use fixed text instead.
      return build(status, code, SAFE_MESSAGES[code] ?? 'Request failed');
    }
    return build(
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_ERROR',
      'An unexpected error occurred',
    );
  }
}
