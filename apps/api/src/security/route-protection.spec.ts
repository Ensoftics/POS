import 'reflect-metadata';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC, REQUIRED_PERMISSIONS, SELF_SERVICE } from '../auth/auth.decorators';
import { PlatformGuard } from '../platform/platform.guard';

/**
 * Every API route must state who may call it: a permission, @SelfService (the
 * caller's own data), or @Public. Public routes are listed here by name with the
 * reason, so a new one fails this test until it has been reviewed.
 */
const REVIEWED_PUBLIC: Record<string, string> = {
  'AuthController.register': 'sign-up; rate-limited',
  'AuthController.login': 'sign-in; rate-limited, account lockout',
  'AuthController.previewInvitation': 'invitation token in body; rate-limited',
  'AuthController.acceptInvitation': 'invitation token in body; rate-limited',
  'AuthController.verifyEmail': 'single-use token; rate-limited',
  'AuthController.refresh': 'refresh token (cookie + client header, or body for mobile)',
  'AuthController.logout': 'revokes the presented refresh token only',
  'AuthController.forgotPassword': 'same answer for any e-mail; rate-limited',
  'AuthController.resetPassword': 'single-use token; rate-limited',
  'BillingController.payhere': 'payment notifications, verified by md5sig',
  'HealthController.live': 'liveness probe, no data',
  'HealthController.ready': 'readiness probe, no data',
  'MediaController.image': 'HMAC-signed image links',
  'MessagingController.unsubscribeInfo': "customer's own opt-out code; rate-limited",
  'MessagingController.unsubscribe': "customer's own opt-out code; rate-limited",
  'PlatformAuthController.login': 'platform sign-in with TOTP; rate-limited',
};

interface Route {
  name: string;
  permissions: unknown[] | undefined;
  selfService: boolean;
  isPublic: boolean;
  platformGuarded: boolean;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return path.endsWith('.controller.ts') ? [path] : [];
  });
}

function routes(): Route[] {
  const found: Route[] = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exports = require(file) as Record<string, unknown>;
    for (const controller of Object.values(exports)) {
      if (typeof controller !== 'function' || Reflect.getMetadata('path', controller) === undefined)
        continue;
      const prototype = controller.prototype as Record<string, object>;
      for (const method of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[method]!;
        if (method === 'constructor' || Reflect.getMetadata('path', handler) === undefined)
          continue;
        const read = (key: string) =>
          Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
        const guards = [
          ...((Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]) ?? []),
          ...((Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? []),
        ];
        found.push({
          name: `${controller.name}.${method}`,
          permissions: read(REQUIRED_PERMISSIONS) as unknown[] | undefined,
          selfService: read(SELF_SERVICE) === true,
          isPublic: read(IS_PUBLIC) === true,
          platformGuarded: guards.includes(PlatformGuard),
        });
      }
    }
  }
  return found;
}

describe('route protection', () => {
  const all = routes();

  it('finds the API routes', () => {
    expect(all.length).toBeGreaterThanOrEqual(150);
  });

  it('gives every route an explicit rule', () => {
    const undecided = all.filter(
      (route) =>
        !route.permissions?.length &&
        !route.selfService &&
        !route.isPublic &&
        !route.platformGuarded,
    );
    expect(undecided.map((route) => route.name)).toEqual([]);
  });

  it('only exposes reviewed public routes; platform routes need the platform guard', () => {
    const unreviewed = all.filter(
      (route) => route.isPublic && !route.platformGuarded && !(route.name in REVIEWED_PUBLIC),
    );
    expect(unreviewed.map((route) => route.name)).toEqual([]);
    const platform = all.filter((route) => route.name.startsWith('Platform'));
    expect(
      platform
        .filter((route) => !route.platformGuarded && route.name !== 'PlatformAuthController.login')
        .map((route) => route.name),
    ).toEqual([]);
  });

  it('never combines public with a permission (the permission would not be checked)', () => {
    expect(
      all.filter((route) => route.isPublic && route.permissions?.length).map((r) => r.name),
    ).toEqual([]);
  });
});
