import { isApiError } from '@pos/api-client';
import type { Campaign, MessagingStatus } from '@pos/contracts';
import { type MessageChannel, personalise, smsLength, smsOptOutLine } from '@pos/domain';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Alert,
  Badge,
  Button,
  Card,
  Skeleton,
  TextAreaField,
  TextField,
} from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';
import { newDocumentId } from '../../lib/inventory';

const statusKey = ['messaging', 'status'];
const campaignsKey = ['messaging', 'campaigns'];

/** Messages to customers who agreed to hear from the business, by e-mail or SMS. */
export function MessagesPage() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: statusKey, queryFn: () => api.messaging.status() });

  return (
    <div className="space-y-6">
      <Link
        to="/customers"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('customers.back')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('messaging.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('messaging.subtitle')}</p>
      </div>
      {status.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : status.isError ? (
        <Alert tone="danger">{errorMessage(t, status.error)}</Alert>
      ) : (
        <Composer status={status.data} />
      )}
      <CampaignList />
    </div>
  );
}

function Composer({ status }: { status: MessagingStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<MessageChannel>(status.channels.EMAIL ? 'EMAIL' : 'SMS');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  // One id per message being written: a double click or retry sends it once.
  const [id, setId] = useState(newDocumentId);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const audience = status.audience[channel];
  const smsLeft = Math.max(0, status.smsAllowance - status.smsUsedThisMonth);
  // What one customer receives, with a sample name and the opt-out line counted in.
  const sample = personalise(body, t('messaging.sampleName'));
  const sms =
    channel === 'SMS'
      ? smsLength(sample + smsOptOutLine('x'.repeat(status.optOutUrlLength)))
      : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setResult(null);
    const next: Record<string, string> = {};
    if (channel === 'EMAIL' && !subject.trim()) next.subject = 'validation.required';
    if (!body.trim()) next.body = 'validation.required';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (!window.confirm(t('messaging.confirm', { count: audience }))) return;
    setSending(true);
    try {
      const campaign = await api.messaging.send({
        id,
        channel,
        body,
        ...(channel === 'EMAIL' ? { subject } : {}),
      });
      setResult({
        tone: 'success',
        text: t('messaging.queued', { count: campaign.recipients }),
      });
      setSubject('');
      setBody('');
      setId(newDocumentId());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: statusKey }),
        queryClient.invalidateQueries({ queryKey: campaignsKey }),
      ]);
    } catch (error) {
      if (isApiError(error) && error.issues.length > 0)
        setErrors(Object.fromEntries(error.issues.map((i) => [i.path, i.message])));
      else if (isApiError(error) && error.code === 'PLAN_LIMIT_REACHED')
        setResult({ tone: 'danger', text: t('messaging.smsLimit', { left: smsLeft }) });
      else setResult({ tone: 'danger', text: errorMessage(t, error) });
    } finally {
      setSending(false);
    }
  };

  if (!status.channels.EMAIL && !status.channels.SMS)
    return <Alert tone="warning">{t('messaging.off')}</Alert>;

  return (
    <Card title={t('messaging.compose')}>
      <form noValidate onSubmit={submit} className="space-y-4">
        <fieldset>
          <legend className="text-sm font-medium text-neutral-800">{t('messaging.channel')}</legend>
          <div className="mt-2 flex flex-wrap gap-4">
            {(['EMAIL', 'SMS'] as const).map((option) => (
              <label key={option} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="channel"
                  value={option}
                  checked={channel === option}
                  disabled={!status.channels[option]}
                  onChange={() => setChannel(option)}
                  className="size-5 accent-brand-700"
                />
                {t(`messaging.channels.${option}`)} ·{' '}
                {t('messaging.audience', { count: status.audience[option] })}
              </label>
            ))}
          </div>
          {!status.channels.SMS && (
            <p className="mt-1 text-xs text-neutral-600">{t('messaging.smsUnavailable')}</p>
          )}
          {status.channels.SMS && (
            <p className="mt-1 text-xs text-neutral-600">
              {t('messaging.smsAllowance', {
                used: status.smsUsedThisMonth,
                total: status.smsAllowance,
              })}
            </p>
          )}
        </fieldset>
        {channel === 'EMAIL' && (
          <TextField
            label={t('messaging.subject')}
            maxLength={120}
            value={subject}
            error={errors.subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        )}
        <TextAreaField
          label={t('messaging.body')}
          hint={t('messaging.bodyHint')}
          maxLength={channel === 'SMS' ? 621 : 2000}
          value={body}
          error={errors.body}
          onChange={(e) => setBody(e.target.value)}
        />
        {sms && body && (
          <p className="text-xs text-neutral-600" aria-live="polite">
            {t('messaging.smsCount', { length: sms.length, segments: sms.segments })}
            {sms.unicode ? ` ${t('messaging.unicode')}` : ''}
          </p>
        )}
        {body && (
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <div className="text-xs uppercase text-neutral-600">{t('messaging.preview')}</div>
            <p className="whitespace-pre-line">{sample}</p>
            <p className="mt-2 text-xs text-neutral-600">{t('messaging.optOutAdded')}</p>
          </div>
        )}
        {result && <Alert tone={result.tone}>{result.text}</Alert>}
        <Button type="submit" loading={sending} disabled={audience === 0}>
          <Send aria-hidden className="size-4" />
          {t('messaging.send', { count: audience })}
        </Button>
        {audience === 0 && <p className="text-xs text-neutral-600">{t('messaging.nobody')}</p>}
      </form>
    </Card>
  );
}

function CampaignList() {
  const { t, i18n } = useTranslation();
  const campaigns = useInfiniteQuery({
    queryKey: campaignsKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.messaging.campaigns(pageParam ? { cursor: pageParam } : {}),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Sending happens in the background; refresh while anything is still going out.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((c) => c.status === 'SENDING'))
        ? 10_000
        : false,
  });
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const items: Campaign[] = campaigns.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Card title={t('messaging.sent')}>
      {campaigns.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : campaigns.isError ? (
        <Alert tone="danger">{errorMessage(t, campaigns.error)}</Alert>
      ) : items.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('messaging.none')}</p>
      ) : (
        <ul className="divide-y divide-neutral-200" aria-label={t('messaging.sent')}>
          {items.map((campaign) => (
            <li key={campaign.id} className="space-y-1 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={campaign.status === 'DONE' ? 'success' : 'warning'}>
                  {t(`messaging.status.${campaign.status}`)}
                </Badge>
                <span className="font-medium">
                  {t(`messaging.channels.${campaign.channel}`)}
                  {campaign.subject ? ` · ${campaign.subject}` : ''}
                </span>
                <span className="text-neutral-600">
                  · {when.format(new Date(campaign.createdAt))}
                  {campaign.createdByName ? ` · ${campaign.createdByName}` : ''}
                </span>
              </div>
              <p className="line-clamp-2 whitespace-pre-line text-neutral-700">{campaign.body}</p>
              <p className="text-xs text-neutral-600">
                {t('messaging.counts', {
                  sent: campaign.sent,
                  recipients: campaign.recipients,
                  queued: campaign.queued,
                  failed: campaign.failed,
                  skipped: campaign.skipped,
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
