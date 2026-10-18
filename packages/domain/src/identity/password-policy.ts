/**
 * Password policy following NIST SP 800-63B guidance: favour length over
 * composition rules, reject known-weak values and values derived from the
 * account identity. Applied identically on the client (for feedback) and the
 * server (for enforcement).
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

// Small deny-list of the most common passwords that satisfy the length rule.
// A breached-password service can be added behind the same function later.
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0987654321',
  '1111111111',
  '0000000000',
  'password12',
  'password123',
  'password1234',
  'qwertyuiop',
  'qwerty1234',
  'qwerty12345',
  'iloveyou12',
  'letmein123',
  'welcome123',
  'abcdefghij',
  'abc1234567',
  'administrator',
  'passw0rd123',
]);

export type PasswordIssue = 'too_short' | 'too_long' | 'too_common' | 'contains_identity';

export interface PasswordContext {
  email?: string;
  fullName?: string;
}

export function checkPassword(password: string, context: PasswordContext = {}): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  // Count Unicode code points, not UTF-16 units, so Sinhala/Tamil input is measured fairly.
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) issues.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) issues.push('too_long');

  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered)) issues.push('too_common');

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  const identityParts = [localPart, ...(context.fullName?.toLowerCase().split(/\s+/) ?? [])].filter(
    (part): part is string => !!part && part.length >= 4,
  );
  if (identityParts.some((part) => lowered.includes(part))) issues.push('contains_identity');

  return issues;
}
