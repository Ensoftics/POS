import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callsTo, mockApi, renderAt, signedInAs } from '../../test/render';

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const PERMS = ['tenant.read', 'settings.read', 'customers.read', 'customers.message'] as const;
const status = {
  channels: { EMAIL: true, SMS: true },
  audience: { EMAIL: 12, SMS: 30 },
  smsAllowance: 1000,
  smsUsedThisMonth: 40,
  optOutUrlLength: 40,
};
const campaign = {
  id: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
  channel: 'SMS',
  subject: null,
  body: 'Hi {name}',
  status: 'SENDING',
  recipients: 30,
  queued: 30,
  sent: 0,
  failed: 0,
  skipped: 0,
  createdByName: 'Dilani',
  createdAt: '2026-10-18T08:00:00.000Z',
  completedAt: null,
};
const posts = (fetch: { mock: { calls: unknown[][] } }, path: string) =>
  callsTo(fetch, path).filter(([, init]) => (init as RequestInit).method === 'POST');

afterEach(() => vi.restoreAllMocks());

describe('Customer messages', () => {
  it('counts SMS parts with the opt-out link, previews the name and sends once confirmed', async () => {
    signedInAs({ permissions: [...PERMS], features: ['messaging'] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let sent = false;
    const fetch = mockApi((url, init) => {
      if (url.endsWith('/messaging/status')) return { status: 200, body: status };
      if (url.includes('/messaging/campaigns') && init.method === 'POST') {
        sent = true;
        return { status: 201, body: campaign };
      }
      if (url.includes('/messaging/campaigns'))
        return { status: 200, body: { items: sent ? [campaign] : [], nextCursor: null } };
      return { status: 404 };
    });
    renderAt('/customers/messages');
    await userEvent.click(await screen.findByLabelText(/SMS · 30 customers/));
    expect(screen.queryByLabelText('Subject')).toBeNull();
    await userEvent.type(screen.getByLabelText('Message'), 'Hi {{name}, අලුත් සාරි ආවා!');
    expect(screen.getByText('Hi Nimali, අලුත් සාරි ආවා!')).toBeInTheDocument();
    // 26 characters plus the opt-out line passes 70: two Unicode parts.
    expect(screen.getByText(/2 SMS part\(s\) per customer/)).toBeInTheDocument();
    expect(screen.getByText(/Sinhala, Tamil and some symbols/)).toBeInTheDocument();
    expect(
      screen.getByText('SMS this month: 40 of 1000 included in your plan.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send to 30 customers' }));
    expect(window.confirm).toHaveBeenCalledWith('Send this message to 30 customers now?');
    expect(await screen.findByText(/Sending to 30 customers/)).toBeInTheDocument();
    const [post] = posts(fetch, '/messaging/campaigns');
    expect(bodyOf(post)).toMatchObject({ channel: 'SMS', body: 'Hi {name}, අලුත් සාරි ආවා!' });
    expect(bodyOf(post).id).toMatch(/^[0-9a-f-]{36}$/);
    const list = await screen.findByRole('list', { name: 'Sent messages' });
    expect(within(list).getByText(/0 of 30 sent · 30 waiting/)).toBeInTheDocument();
  });

  it('asks for a subject on e-mails and explains when SMS is not set up', async () => {
    signedInAs({ permissions: [...PERMS], features: ['messaging'] });
    const fetch = mockApi((url) => {
      if (url.endsWith('/messaging/status'))
        return { status: 200, body: { ...status, channels: { EMAIL: true, SMS: false } } };
      return { status: 200, body: { items: [], nextCursor: null } };
    });
    renderAt('/customers/messages');
    expect(await screen.findByLabelText(/SMS · 30 customers/)).toBeDisabled();
    expect(screen.getByText('SMS is not set up for this service yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Message'), 'New stock');
    await userEvent.click(screen.getByRole('button', { name: 'Send to 12 customers' }));
    expect(screen.getByText('This field is required')).toBeInTheDocument();
    expect(posts(fetch, '/messaging/campaigns')).toHaveLength(0);
  });
});

describe('Consent history on the customer page', () => {
  it('shows who recorded each change and how', async () => {
    signedInAs({ permissions: ['tenant.read', 'settings.read', 'customers.read'] });
    mockApi((url) => {
      if (url.includes('/consents'))
        return {
          status: 200,
          body: {
            items: [
              {
                id: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
                granted: false,
                source: 'UNSUBSCRIBE_LINK',
                note: null,
                actorName: null,
                createdAt: '2026-10-18T09:00:00.000Z',
              },
              {
                id: 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
                granted: true,
                source: 'STAFF',
                note: 'Asked at the till',
                actorName: 'Dilani',
                createdAt: '2026-10-01T09:00:00.000Z',
              },
            ],
          },
        };
      if (url.includes('/customers/'))
        return {
          status: 200,
          body: {
            id: 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0',
            number: 'CUS-000001',
            name: 'Nimali Perera',
            phone: null,
            email: null,
            address: null,
            notes: null,
            marketingConsent: false,
            marketingConsentAt: null,
            creditLimitMinor: 0,
            balanceMinor: 0,
            availableCreditMinor: 0,
            status: 'ACTIVE',
            version: 3,
            createdAt: '2026-10-01T08:00:00.000Z',
          },
        };
      return {
        status: 200,
        body: { items: [], nextCursor: null, lines: [], openingMinor: 0, closingMinor: 0 },
      };
    });
    renderAt('/customers/c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0');
    const history = await screen.findByRole('list', { name: 'Consent history' });
    expect(screen.getByText('Has not agreed to messages')).toBeInTheDocument();
    expect(
      within(history).getByText(/by the customer, using the link in a message/),
    ).toBeInTheDocument();
    expect(within(history).getByText(/recorded by Dilani/)).toBeInTheDocument();
    expect(within(history).getByText('“Asked at the till”')).toBeInTheDocument();
  });
});

describe('Opt-out page', () => {
  it('stops messages only after the customer confirms', async () => {
    let stopped = false;
    const fetch = mockApi((url, init) => {
      if (url.endsWith('/public/unsubscribe') && init.method === 'POST') {
        stopped = true;
        return { status: 200, body: { businessName: 'Colombo Threads', subscribed: false } };
      }
      if (url.includes('/public/unsubscribe/'))
        return { status: 200, body: { businessName: 'Colombo Threads', subscribed: !stopped } };
      return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'x' } } };
    });
    renderAt('/u/AbCdEfGhJkMn');
    expect(
      await screen.findByText('Stop receiving offers and news from Colombo Threads?'),
    ).toBeInTheDocument();
    expect(stopped).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Stop messages' }));
    expect(
      await screen.findByText('Done. Colombo Threads will not send you any more messages.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(bodyOf(posts(fetch, '/public/unsubscribe').at(-1))).toEqual({ code: 'AbCdEfGhJkMn' }),
    );
  });

  it('says when the link is not valid', async () => {
    mockApi(() => ({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }));
    renderAt('/u/NotARealCode1');
    expect(await screen.findByText(/This link is not valid/)).toBeInTheDocument();
  });
});
