import type { AuthSessionResponse } from '@pos/contracts';

export function mobileSession(
  refreshToken = 'rotated-refresh-token-0123456789',
): AuthSessionResponse {
  return {
    user: {
      id: '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a',
      email: 'cashier@example.com',
      fullName: 'Kasun Fernando',
      isPlatformAdmin: false,
    },
    tenant: {
      id: '0b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11',
      name: 'Nimal Textiles',
      slug: 'nimal-textiles-a1b2c3',
      status: 'ACTIVE',
      businessType: 'TEXTILE',
      contactPhone: null,
      onboardingStatus: 'COMPLETED',
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    role: 'CASHIER',
    permissions: ['tenant.read'],
    memberships: [],
    accessToken: 'access-token',
    accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
    refreshToken,
    refreshTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  };
}

export function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function secureStoreMap(): Map<string, string> {
  return (jest.requireMock('expo-secure-store') as { __store: Map<string, string> }).__store;
}
