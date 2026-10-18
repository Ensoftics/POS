import { daysLeft, isSubscriptionUsable } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { useAuthContext } from '../lib/auth-store';
import { errorMessage } from '../lib/errors';
import { Alert, Button } from './ui';

/** Days before a trial ends from which every page shows a reminder. */
const TRIAL_BANNER_DAYS = 7;

/**
 * Account-wide notices above every page: confirm the e-mail address (owners),
 * and trial / payment due / read-only states of the subscription.
 */
export function AccountBanners() {
  const { t, i18n } = useTranslation();
  const { user, permissions, subscription } = useAuthContext();
  const canBill = permissions.includes('billing.manage');
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  const resend = useMutation({ mutationFn: () => api.auth.resendVerification() });

  const billingLink = canBill ? (
    <Link to="/settings/billing" className="font-semibold underline">
      {t('banner.action')}
    </Link>
  ) : null;

  let notice: { tone: 'warning' | 'danger' | 'info'; text: string } | null = null;
  if (subscription) {
    const status = subscription.status;
    if (!isSubscriptionUsable(status))
      notice = {
        tone: 'danger',
        text: status === 'CANCELLED' ? t('banner.ended') : t('banner.readOnly'),
      };
    else if (status === 'PAST_DUE' && subscription.graceEndsAt)
      notice = {
        tone: 'warning',
        text: t('banner.pastDue', { date: date(subscription.graceEndsAt) }),
      };
    else if (status === 'TRIALING' && subscription.trialEndsAt && canBill) {
      const days = daysLeft(new Date(subscription.trialEndsAt), new Date());
      if (days <= TRIAL_BANNER_DAYS) notice = { tone: 'info', text: t('banner.trial', { days }) };
    }
  }

  const unverified = canBill && user.emailVerified === false;
  if (!notice && !unverified) return null;

  return (
    <div className="mb-6 space-y-3">
      {notice && (
        <Alert tone={notice.tone}>
          {notice.text} {billingLink}
        </Alert>
      )}
      {unverified && (
        <Alert
          tone="warning"
          action={
            resend.isSuccess ? undefined : (
              <Button
                variant="secondary"
                loading={resend.isPending}
                onClick={() => resend.mutate()}
              >
                {t('banner.resend')}
              </Button>
            )
          }
        >
          {resend.isSuccess
            ? t('banner.resent')
            : resend.isError
              ? errorMessage(t, resend.error)
              : t('banner.verify', { email: user.email })}
        </Alert>
      )}
    </div>
  );
}
