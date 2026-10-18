import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';

/**
 * The opt-out link in every customer message (/u/<code>). No sign-in. Opening
 * the page changes nothing (mail scanners open links); the customer confirms.
 */
export function UnsubscribePage() {
  const { t } = useTranslation();
  const { code = '' } = useParams();
  const info = useQuery({
    queryKey: ['unsubscribe', code],
    queryFn: () => api.messaging.unsubscribeInfo(code),
    retry: false,
  });
  const stop = useMutation({ mutationFn: () => api.messaging.unsubscribe(code) });

  return (
    <AuthLayout title={t('unsubscribe.title')}>
      <div className="space-y-5">
        {info.isPending ? (
          <Spinner label={t('common.loading')} />
        ) : info.isError ? (
          <Alert tone="warning">{t('unsubscribe.notFound')}</Alert>
        ) : stop.isSuccess || !info.data.subscribed ? (
          <Alert tone="success">
            {t('unsubscribe.done', { business: info.data.businessName })}
          </Alert>
        ) : (
          <>
            <p className="text-sm text-neutral-700">
              {t('unsubscribe.question', { business: info.data.businessName })}
            </p>
            {stop.isError && <Alert tone="danger">{errorMessage(t, stop.error)}</Alert>}
            <Button block loading={stop.isPending} onClick={() => stop.mutate()}>
              {t('unsubscribe.confirm')}
            </Button>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
