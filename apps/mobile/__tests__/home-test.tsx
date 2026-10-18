import { render, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import HomeScreen from '@/app/(app)/index';
import { sessionStore, useSession } from '@/lib/session';
import { mobileSession, secureStoreMap } from '../test/fixtures';

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
  };
});

const subscription = (status: 'ACTIVE' | 'SUSPENDED') => ({
  status,
  planName: 'Growth',
  trialEndsAt: null,
  currentPeriodEnd: null,
  graceEndsAt: null,
  cancelAtPeriodEnd: false,
});

describe('home screen subscription state', () => {
  beforeEach(() => {
    secureStoreMap().clear();
    // Keep the screen on its loading state; only the banner matters here.
    globalThis.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
  });

  it('tells staff when the business is read-only', async () => {
    await sessionStore.applySession({
      ...mobileSession(),
      subscription: subscription('SUSPENDED'),
    });
    await render(<HomeScreen />);
    expect(
      await screen.findByText(/This business is read-only until a plan is paid/),
    ).toBeOnTheScreen();
  });

  it('keeps the subscription in the session and shows nothing while paid', async () => {
    await sessionStore.applySession({ ...mobileSession(), subscription: subscription('ACTIVE') });
    function Probe() {
      const session = useSession();
      return session.status === 'authenticated' ? <HomeScreen /> : null;
    }
    await render(<Probe />);
    expect(screen.queryByText(/read-only/)).toBeNull();
  });
});
