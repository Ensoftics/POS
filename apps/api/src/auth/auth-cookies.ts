import { REFRESH_COOKIE } from '@pos/contracts';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config/app-config';

/** Scoped to the auth routes so the refresh token is never sent with ordinary API calls. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function setRefreshCookie(
  res: Response,
  config: AppConfig,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(REFRESH_COOKIE, token, { ...baseOptions(config), expires: expiresAt });
}

export function clearRefreshCookie(res: Response, config: AppConfig): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions(config));
}
