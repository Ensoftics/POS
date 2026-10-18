import { describe, expect, it } from 'vitest';
import {
  acceptInvitationRequestSchema,
  createInvitationRequestSchema,
  updateStaffRequestSchema,
} from './index';

const BRANCH = '33333333-3333-4333-8333-333333333333';

describe('staff contracts', () => {
  it('normalises the invited e-mail and removes duplicate branches', () => {
    const parsed = createInvitationRequestSchema.parse({
      email: '  Kamal@Example.COM ',
      role: 'CASHIER',
      branchIds: [BRANCH, BRANCH],
    });
    expect(parsed).toEqual({ email: 'kamal@example.com', role: 'CASHIER', branchIds: [BRANCH] });
    expect(
      createInvitationRequestSchema.parse({ email: 'a@b.co', role: 'MANAGER' }).branchIds,
    ).toEqual([]);
  });

  it('rejects unknown roles and malformed branch ids', () => {
    expect(
      createInvitationRequestSchema.safeParse({ email: 'a@b.co', role: 'ADMIN' }).success,
    ).toBe(false);
    expect(
      createInvitationRequestSchema.safeParse({
        email: 'a@b.co',
        role: 'CASHIER',
        branchIds: ['x'],
      }).success,
    ).toBe(false);
  });

  it('needs a version for every staff change', () => {
    expect(updateStaffRequestSchema.safeParse({ status: 'DISABLED' }).success).toBe(false);
    expect(updateStaffRequestSchema.safeParse({ version: 2, status: 'DISABLED' }).success).toBe(
      true,
    );
  });

  it('accepts an invitation with or without a name and defaults to the web client', () => {
    const parsed = acceptInvitationRequestSchema.parse({
      token: 'a'.repeat(43),
      password: 'secret',
    });
    expect(parsed.clientType).toBe('WEB');
    expect(acceptInvitationRequestSchema.safeParse({ token: 'short', password: 'x' }).success).toBe(
      false,
    );
  });
});
