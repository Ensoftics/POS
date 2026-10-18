import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import NotificationsScreen from '@/app/(app)/notifications';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

const conflict = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'SALE_CONFLICT',
  data: { saleNumber: 'INV-000042' },
  link: '/sales/review',
  readAt: null,
  createdAt: '2026-10-17T02:00:00.000Z',
};

describe('notifications screen', () => {
  const fetchMock = jest.fn();
  beforeEach(async () => {
    secureStoreMap().clear();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sessionStore.applySession(mobileSession());
  });

  it('shows notifications in plain words and marks one read when tapped', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/read')
        ? respond(200, { ...conflict, readAt: '2026-10-17T03:00:00.000Z' })
        : respond(200, { items: [conflict], nextCursor: null }),
    );
    await render(<NotificationsScreen />);
    const row = await screen.findByRole('button', {
      name: 'Unread: An offline sale needs review. Sale INV-000042 was recorded with differences.',
    });
    await fireEvent.press(row);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).endsWith(`/notifications/${conflict.id}/read`),
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByRole('button', {
        name: 'An offline sale needs review. Sale INV-000042 was recorded with differences.',
      }),
    ).toBeOnTheScreen();
  });

  it('explains when there is nothing new', async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [], nextCursor: null }));
    await render(<NotificationsScreen />);
    expect(await screen.findByText(/Nothing new/)).toBeOnTheScreen();
  });
});
