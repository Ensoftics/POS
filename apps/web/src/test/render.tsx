import type { AuthSessionResponse, TenantSettings } from '@pos/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { createQueryClient } from '../App';
import { authStore } from '../lib/auth-store';
import { routes } from '../router';

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown };

/** Calls made to a path, ignoring the shell's settings load. */
export function callsTo(fetchMock: { mock: { calls: unknown[][] } }, path: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(path));
}

export function settingsFixture(overrides: Partial<TenantSettings> = {}): TenantSettings {
  return {
    version: 3,
    legalName: null,
    taxRegistrationNumber: null,
    addressLine1: null,
    addressLine2: null,
    city: 'Colombo',
    postalCode: null,
    country: 'LK',
    currency: 'LKR',
    timezone: 'Asia/Colombo',
    defaultLanguage: 'en',
    enabledLanguages: ['en', 'si', 'ta'],
    profile: {
      trackBatchNumbers: true,
      trackExpiryDates: true,
      allowFractionalQuantities: false,
      variantAttributes: ['brand', 'shade'],
      defaultUnits: ['piece'],
    },
    checkout: {
      pricesIncludeTax: true,
      allowNegativeStock: false,
      receiptFooter: null,
      discountApprovalBp: null,
      refundsRequireApproval: true,
    },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Stubs fetch with a route handler and returns the mock for assertions.
 * `GET /settings` (loaded by the app shell) is always answered from `settings`, and the
 * bell's unread count with 0;
 * pass a function to change the answer between calls.
 */
export function mockApi(
  handler: Handler,
  settings: TenantSettings | (() => TenantSettings) = settingsFixture(),
) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const isSettingsRead = url.endsWith('/settings') && (init.method ?? 'GET') === 'GET';
    // The header's notification bell polls this on every page.
    const isUnreadCount = url.endsWith('/notifications/unread-count');
    const { status, body } = isSettingsRead
      ? { status: 200, body: typeof settings === 'function' ? settings() : settings }
      : isUnreadCount
        ? { status: 200, body: { unread: 0 } }
        : handler(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

export function session(overrides: Partial<AuthSessionResponse> = {}): AuthSessionResponse {
  return {
    user: {
      id: '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a',
      email: 'ama@example.com',
      fullName: 'Ama Silva',
      isPlatformAdmin: false,
    },
    tenant: {
      id: '0b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11',
      name: 'Lotus Cosmetics',
      slug: 'lotus-cosmetics-a1b2c3',
      status: 'ACTIVE',
      businessType: 'COSMETICS',
      contactPhone: null,
      onboardingStatus: 'COMPLETED',
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    role: 'OWNER',
    permissions: ['tenant.read', 'tenant.update', 'tenant.onboarding.complete', 'audit.read'],
    memberships: [],
    accessToken: 'access-token',
    accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
    refreshTokenExpiresAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function signedInAs(overrides: Partial<AuthSessionResponse> = {}) {
  authStore.applySession(session(overrides));
}

export function signedOut() {
  authStore.clear();
}
