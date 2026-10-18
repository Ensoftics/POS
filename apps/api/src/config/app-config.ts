import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_VERSION: z.string().default('0.0.0'),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS_WEB: z.coerce.number().int().min(1).max(90).default(14),
  REFRESH_TOKEN_TTL_DAYS_MOBILE: z.coerce.number().int().min(1).max(180).default(30),
  SESSION_MAX_LIFETIME_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  /** scrypt cost as log2(N). 16 => 64 MiB per hash. Lower values are only for tests. */
  PASSWORD_HASH_LOG_N: z.coerce.number().int().min(12).max(20).default(16),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  WEB_APP_URL: z.url().default('http://localhost:5180'),
  /**
   * Reverse proxies in front of the API: `false`, `true` (one) or the number of hops
   * (e.g. 2 for TLS proxy + web server). The client IP (rate limits, audit) is read
   * that many hops from the right of X-Forwarded-For, so clients cannot spoof it.
   */
  TRUST_PROXY: z
    .union([z.literal('true'), z.literal('false'), z.string().regex(/^[0-9]$/)])
    .default('false')
    .transform((value) => (value === 'true' ? 1 : value === 'false' ? 0 : Number(value))),
  COOKIE_SECURE: booleanString.optional(),

  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(3),

  RATE_LIMIT_DEFAULT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  ENABLE_API_DOCS: booleanString.optional(),
  LOG_FORMAT: z.enum(['json', 'pretty', 'silent']).default('json'),

  /** Public base URL of this API, for payment-provider callbacks and image links (no trailing /api/v1). */
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  TRIAL_PLAN_CODE: z.string().min(1).default('GROWTH'),
  GRACE_DAYS: z.coerce.number().int().min(0).max(60).default(7),
  /** VAT/SVAT on subscription invoices, in basis points (1800 = 18%). Set per the platform's registration. */
  BILLING_TAX_RATE_BP: z.coerce.number().int().min(0).max(10_000).default(0),
  /** How often subscriptions are checked for trial/period ends; 0 disables the timer. */
  BILLING_SWEEP_SECONDS: z.coerce.number().int().min(0).default(900),
  PAYHERE_MERCHANT_ID: z.string().trim().min(1).optional(),
  PAYHERE_MERCHANT_SECRET: z.string().trim().min(1).optional(),
  PAYHERE_MODE: z.enum(['sandbox', 'live']).default('sandbox'),

  /** Platform console sign-ins: absolute length and inactivity limit. */
  PLATFORM_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  PLATFORM_IDLE_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  /** How often businesses are checked for their daily alerts and digest; 0 disables the timer. */
  NOTIFICATIONS_SWEEP_SECONDS: z.coerce.number().int().min(0).default(900),

  /**
   * S3-compatible object storage for product images (AWS S3, Cloudflare R2, SeaweedFS
   * locally). Images stay unavailable until S3_BUCKET is set. Without keys the SDK's
   * default credential chain applies (e.g. an instance role).
   */
  S3_BUCKET: z.string().trim().min(3).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().trim().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().trim().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().trim().min(1).optional(),
  S3_FORCE_PATH_STYLE: booleanString.default(false),
  /**
   * Notify.lk SMS gateway for customer messages. SMS stays unavailable until all
   * three are set; the sender ID must be approved by Notify.lk.
   */
  NOTIFYLK_USER_ID: z.string().trim().min(1).optional(),
  NOTIFYLK_API_KEY: z.string().trim().min(1).optional(),
  NOTIFYLK_SENDER_ID: z.string().trim().min(1).max(11).optional(),
  NOTIFYLK_URL: z.url().default('https://app.notify.lk/api/v1/send'),
  /** How often queued customer messages are sent; 0 disables the timer. */
  MESSAGING_SWEEP_SECONDS: z.coerce.number().int().min(0).default(20),
  /** Messages sent per sweep (keeps gateway and SMTP load even). */
  MESSAGING_BATCH: z.coerce.number().int().min(1).max(500).default(60),

  /** Largest accepted upload per product image. */
  PRODUCT_IMAGE_MAX_BYTES: z.coerce.number().int().min(100_000).max(20_000_000).default(5_000_000),
});

export type AppConfig = Omit<z.output<typeof envSchema>, 'COOKIE_SECURE' | 'ENABLE_API_DOCS'> & {
  COOKIE_SECURE: boolean;
  ENABLE_API_DOCS: boolean;
};

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Parses and validates environment variables. Fails fast at boot with a readable message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const parsed = result.data;
  const isProduction = parsed.NODE_ENV === 'production';

  // Reset, invitation, opt-out and image links are built from these; over plain
  // HTTP their tokens could be read on the network.
  const insecure = (['WEB_APP_URL', 'API_PUBLIC_URL'] as const).filter(
    (key) => isProduction && !parsed[key].startsWith('https://'),
  );
  if (insecure.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${insecure.map((key) => `  - ${key} must use https in production`).join('\n')}`,
    );
  }

  if (isProduction && parsed.CORS_ORIGINS.length === 0) {
    throw new Error(
      'Invalid environment configuration:\n  - CORS_ORIGINS must be set in production',
    );
  }

  if (!!parsed.PAYHERE_MERCHANT_ID !== !!parsed.PAYHERE_MERCHANT_SECRET) {
    throw new Error(
      'Invalid environment configuration:\n  - set both PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET, or neither',
    );
  }
  if (isProduction && parsed.PAYHERE_MERCHANT_ID && parsed.PAYHERE_MODE !== 'live') {
    throw new Error(
      'Invalid environment configuration:\n  - PAYHERE_MODE must be live in production',
    );
  }

  const notify = [parsed.NOTIFYLK_USER_ID, parsed.NOTIFYLK_API_KEY, parsed.NOTIFYLK_SENDER_ID];
  if (notify.some(Boolean) && !notify.every(Boolean)) {
    throw new Error(
      'Invalid environment configuration:\n  - set NOTIFYLK_USER_ID, NOTIFYLK_API_KEY and NOTIFYLK_SENDER_ID together, or none',
    );
  }

  if (!!parsed.S3_ACCESS_KEY_ID !== !!parsed.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      'Invalid environment configuration:\n  - set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither',
    );
  }

  return {
    ...parsed,
    COOKIE_SECURE: parsed.COOKIE_SECURE ?? isProduction,
    ENABLE_API_DOCS: parsed.ENABLE_API_DOCS ?? !isProduction,
  };
}
