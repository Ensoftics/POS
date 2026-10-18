import { loadConfig } from './app-config';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'POS <no-reply@example.com>',
};

describe('loadConfig', () => {
  it('applies safe defaults for development', () => {
    const config = loadConfig({ ...base });
    expect(config.NODE_ENV).toBe('development');
    expect(config.COOKIE_SECURE).toBe(false);
    expect(config.ENABLE_API_DOCS).toBe(true);
    expect(config.PASSWORD_HASH_LOG_N).toBe(16);
  });

  it('hardens production defaults', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.com, https://admin.example.com',
      WEB_APP_URL: 'https://app.example.com',
      API_PUBLIC_URL: 'https://api.example.com',
    });
    expect(config.COOKIE_SECURE).toBe(true);
    expect(config.ENABLE_API_DOCS).toBe(false);
    expect(config.CORS_ORIGINS).toEqual(['https://app.example.com', 'https://admin.example.com']);
  });

  it('requires CORS origins in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        WEB_APP_URL: 'https://app.example.com',
        API_PUBLIC_URL: 'https://api.example.com',
      }),
    ).toThrow(/CORS_ORIGINS/);
  });

  it('requires https links in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com',
        WEB_APP_URL: 'http://app.example.com',
      }),
    ).toThrow(/WEB_APP_URL must use https[\s\S]*API_PUBLIC_URL must use https/);
  });

  it('reads the number of trusted proxy hops', () => {
    expect(loadConfig({ ...base }).TRUST_PROXY).toBe(0);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'all' })).toThrow(/TRUST_PROXY/);
  });

  it('rejects short JWT secrets and lists every problem', () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: 'short', DATABASE_URL: '' })).toThrow(
      /JWT_ACCESS_SECRET[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*JWT_ACCESS_SECRET/,
    );
  });
});
