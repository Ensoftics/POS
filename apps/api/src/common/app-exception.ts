import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode, ValidationIssue } from '@pos/contracts';

/** Domain-level error with a stable code. Messages must be safe to show to end users. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super({ code, message }, status);
  }

  static unauthenticated(message = 'Authentication required') {
    return new AppException('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, message);
  }

  static forbidden(message = 'You do not have permission to perform this action') {
    return new AppException('FORBIDDEN', HttpStatus.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found') {
    return new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, message);
  }

  static validation(issues: ValidationIssue[], message = 'Request validation failed') {
    return new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, message, issues);
  }
}
