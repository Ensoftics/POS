import { type ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { AppException } from './app-exception';
import { HttpExceptionFilter } from './http-exception.filter';
import { RequestContext } from './request-context';

function capture(exception: unknown) {
  const response = { headersSent: false, status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  const filter = new HttpExceptionFilter();
  jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  RequestContext.run({ requestId: 'req-1', ip: null, userAgent: null }, () =>
    filter.catch(exception, host),
  );
  return { status: response.status.mock.calls[0]?.[0], body: response.json.mock.calls[0]?.[0] };
}

describe('HttpExceptionFilter', () => {
  it('passes through application error codes and issues', () => {
    const { status, body } = capture(
      AppException.validation([{ path: 'email', message: 'validation.email.invalid' }]),
    );
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        requestId: 'req-1',
        issues: [{ path: 'email', message: 'validation.email.invalid' }],
      },
    });
  });

  it('maps throttling to RATE_LIMITED', () => {
    expect(capture(new ThrottlerException()).body.error.code).toBe('RATE_LIMITED');
  });

  it('maps unique violations to CONFLICT without leaking constraint names', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on users_email_key',
      {
        code: 'P2002',
        clientVersion: 'test',
      },
    );
    const { status, body } = capture(error);
    expect(status).toBe(409);
    expect(JSON.stringify(body)).not.toContain('users_email_key');
  });

  it('replaces framework messages that might echo input', () => {
    const { body } = capture(
      new BadRequestException('Unexpected token s in JSON at position 10: "secret"'),
    );
    expect(body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
    });
    expect(capture(new NotFoundException()).body.error.code).toBe('NOT_FOUND');
  });

  it('hides internal errors', () => {
    const { status, body } = capture(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'),
    );
    expect(status).toBe(500);
    expect(body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: 'req-1',
    });
  });
});
