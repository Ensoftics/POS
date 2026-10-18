import { loggablePath } from './request-context.middleware';

describe('access log paths', () => {
  it('drops query strings and opt-out codes', () => {
    expect(loggablePath('/api/v1/sales?cursor=abc')).toBe('/api/v1/sales');
    expect(loggablePath('/api/v1/public/unsubscribe/AbCdEfGhJkMn')).toBe(
      '/api/v1/public/unsubscribe/:code',
    );
    expect(loggablePath('/api/v1/media/t/x/i/y/thumb.webp?s=secret')).toBe(
      '/api/v1/media/t/x/i/y/thumb.webp',
    );
  });
});
