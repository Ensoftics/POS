import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import { createApiClient } from './client';

const tenant = {
  id: '0b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11',
  name: 'Lotus',
  slug: 'lotus-abc123',
  status: 'ACTIVE',
  businessType: null,
  contactPhone: null,
  onboardingStatus: 'PENDING',
  onboardingCompletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('sends bearer token and CSRF header', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, tenant));
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => 'token-1',
      fetch,
    });

    await expect(client.tenant.current()).resolves.toEqual(tenant);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/tenant');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.headers['x-pos-client']).toBe('web');
    expect(init.credentials).toBe('include');
  });

  it('sends uploads as multipart form data', async () => {
    const product = {
      id: '1b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11',
      name: 'Lipstick',
      brand: null,
      description: null,
      unit: 'piece',
      categoryId: null,
      categoryName: null,
      taxRateId: null,
      status: 'ACTIVE',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      variants: [],
      images: [],
    };
    const fetch = vi.fn().mockResolvedValue(json(201, product));
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => 'token-1',
      fetch,
    });
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: 'image/jpeg' }), 'photo.jpg');

    await expect(client.products.addImage(product.id, form)).resolves.toEqual(product);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`/api/v1/products/${product.id}/images`);
    expect(init.body).toBe(form);
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('renews once for concurrent 401s and retries', async () => {
    let token = 'stale';
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer fresh'
        ? json(200, tenant)
        : json(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } });
    });
    const renew = vi.fn(async () => {
      token = 'fresh';
      return token;
    });
    const client = createApiClient({
      baseUrl: 'https://api.example.com/api/v1',
      clientType: 'MOBILE',
      getAccessToken: () => token,
      renewAccessToken: renew,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await Promise.all([client.tenant.current(), client.tenant.current()]);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.example.com/api/v1/tenant');
  });

  it('maps error envelopes to ApiError', async () => {
    const fetch = vi.fn().mockResolvedValue(
      json(400, {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid',
          requestId: 'req-1',
          issues: [{ path: 'email', message: 'validation.email.invalid' }],
        },
      }),
    );
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => null,
      fetch,
    });
    const error = await client.auth.forgotPassword({ email: 'x@y.co' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', requestId: 'req-1' });
    expect((error as ApiError).issues).toHaveLength(1);
  });

  it('reports network failures as transient', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => null,
      fetch,
    });
    const error = (await client.tenant.current().catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.isTransient).toBe(true);
  });

  it('rejects responses that break the contract', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { id: 'nope' }));
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => null,
      fetch,
    });
    await expect(client.tenant.current()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('settings and locations endpoints', () => {
  it('sends PATCH bodies and encodes ids', async () => {
    const register = {
      id: '11111111-1111-4111-8111-111111111111',
      branchId: '22222222-2222-4222-8222-222222222222',
      code: 'R2',
      name: 'Register 2',
      status: 'ACTIVE',
      version: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const fetch = vi.fn().mockResolvedValue(json(200, register));
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => 't',
      fetch,
    });
    await expect(
      client.registers.update(register.id, { version: 1, name: 'Register 2' }),
    ).resolves.toEqual(register);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`/api/v1/registers/${register.id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ version: 1, name: 'Register 2' });
  });

  it('passes includeArchived as a query parameter', async () => {
    const fetch = vi.fn().mockResolvedValue(json(200, { items: [] }));
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => 't',
      fetch,
    });
    await client.branches.list({ includeArchived: true });
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/branches?includeArchived=true');
  });
});

describe('catalog endpoints', () => {
  it('downloads CSV exports as text through the same auth path', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: 'SESSION_EXPIRED', message: 'x' } }))
      .mockResolvedValueOnce(new Response('product_name,sku\r\n', { status: 200 }));
    const renew = vi.fn().mockResolvedValue('fresh');
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => 'stale',
      renewAccessToken: renew,
      fetch,
    });
    await expect(client.products.exportCsv()).resolves.toBe('product_name,sku\r\n');
    expect(renew).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[1]![1].headers.Authorization).toBe('Bearer fresh');
  });

  it('passes lookup codes as query parameters', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(json(404, { error: { code: 'NOT_FOUND', message: 'x' } }));
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'MOBILE',
      getAccessToken: () => 't',
      fetch,
    });
    await expect(client.products.lookup('4006381333931')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(fetch.mock.calls[0]![0]).toBe('/api/v1/products/lookup?code=4006381333931');
  });

  it('sends invitation tokens in the body without credentials of the current user', async () => {
    const fetch = vi.fn().mockResolvedValue(
      json(200, {
        businessName: 'Lotus',
        email: 'k@example.com',
        role: 'CASHIER',
        existingAccount: false,
      }),
    );
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'WEB',
      getAccessToken: () => 'token-1',
      fetch,
    });
    const token = 'a'.repeat(43);
    await expect(client.auth.previewInvitation(token)).resolves.toMatchObject({ role: 'CASHIER' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/auth/invitations/preview');
    expect(url).not.toContain(token);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token });
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('registers a device with PUT under its install id', async () => {
    const id = '77777777-7777-4777-8777-777777777777';
    const fetch = vi.fn().mockResolvedValue(
      json(200, {
        id,
        name: 'Till',
        branchId: '33333333-3333-4333-8333-333333333333',
        branchName: 'Main',
        registerId: '44444444-4444-4444-8444-444444444444',
        registerName: 'R1',
        registeredByName: null,
        lastSeenAt: '2026-10-17T00:00:00.000Z',
        revoked: false,
        createdAt: '2026-10-17T00:00:00.000Z',
      }),
    );
    const client = createApiClient({
      baseUrl: '/api/v1',
      clientType: 'MOBILE',
      getAccessToken: () => 'token-1',
      fetch,
    });
    await client.devices.register(id, {
      name: 'Till',
      registerId: '44444444-4444-4444-8444-444444444444',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`/api/v1/devices/${id}`);
    expect(init.method).toBe('PUT');
  });
});
