import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from './app-exception';

export const versionConflict = () =>
  new AppException(
    'VERSION_CONFLICT',
    HttpStatus.CONFLICT,
    'This record was changed by someone else. Reload it and apply your changes again.',
  );

export const duplicateCode = () =>
  new AppException('DUPLICATE_CODE', HttpStatus.CONFLICT, 'This code is already in use.');

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Lists fields whose values differ, as `{ field: [before, after] }`, for audit metadata. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  patch: Partial<T>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [key, next] of Object.entries(patch)) {
    if (next === undefined) continue;
    const previous = before[key];
    if (JSON.stringify(previous) !== JSON.stringify(next)) changes[key] = [previous ?? null, next];
  }
  return changes;
}
