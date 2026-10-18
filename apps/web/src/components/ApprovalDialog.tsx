import { isApiError } from '@pos/api-client';
import type { ApprovalAction, ApprovalDto } from '@pos/contracts';
import { APPROVAL_PIN_PATTERN } from '@pos/domain';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { Alert, Button, SelectField, Skeleton } from './ui';

const APPROVAL_CODES = ['APPROVAL_REQUIRED', 'APPROVAL_INVALID', 'APPROVAL_LOCKED'];

interface Pending {
  action: ApprovalAction;
  error: string | null;
  resolve: (approval: ApprovalDto | null) => void;
}

/**
 * Manager approval at the till. `run` tries the action; when the API answers that
 * approval is needed (or the PIN was wrong) it asks for a manager and PIN and tries
 * again with them. Resolves to null if the cashier cancels.
 */
export function useApproval() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);

  async function run<T>(
    action: ApprovalAction,
    attempt: (approval?: ApprovalDto) => Promise<T>,
  ): Promise<T | null> {
    let approval: ApprovalDto | undefined;
    for (;;) {
      try {
        return await attempt(approval);
      } catch (error) {
        if (!isApiError(error) || !APPROVAL_CODES.includes(error.code)) throw error;
        const message =
          error.code === 'APPROVAL_REQUIRED' && !approval ? null : errorMessage(t, error);
        const given = await new Promise<ApprovalDto | null>((resolve) =>
          setPending({ action, error: message, resolve }),
        );
        setPending(null);
        if (!given) return null;
        approval = given;
      }
    }
  }

  const dialog = pending ? (
    <ApprovalDialog
      action={pending.action}
      error={pending.error}
      onDone={(approval) => pending.resolve(approval)}
    />
  ) : null;
  return { run, dialog };
}

function ApprovalDialog({
  action,
  error,
  onDone,
}: {
  action: ApprovalAction;
  error: string | null;
  onDone: (approval: ApprovalDto | null) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const pinRef = useRef<HTMLInputElement>(null);
  const approvers = useQuery({ queryKey: ['approvers'], queryFn: () => api.approvals.approvers() });
  const [approverId, setApproverId] = useState('');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const items = approvers.data?.items ?? [];
  const chosen = approverId || items[0]?.userId || '';

  useEffect(() => {
    pinRef.current?.focus();
  }, [approvers.isSuccess]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!APPROVAL_PIN_PATTERN.test(pin)) return setPinError(t('validation.pin.invalid'));
    onDone({ approverId: chosen, pin });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onDone(null);
        }}
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="flex items-center gap-2 text-lg font-semibold text-neutral-900">
          <ShieldCheck aria-hidden className="size-5 text-brand-700" />
          {t('approval.title')}
        </h2>
        <p className="text-sm text-neutral-700">{t(`approval.reasons.${action}`)}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        {approvers.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : items.length === 0 ? (
          <>
            <Alert tone="warning">{t('approval.noApprovers')}</Alert>
            <Button variant="secondary" block onClick={() => onDone(null)}>
              {t('approval.cancel')}
            </Button>
          </>
        ) : (
          <form noValidate onSubmit={submit} className="space-y-4">
            <SelectField
              label={t('approval.approver')}
              value={chosen}
              onChange={(e) => setApproverId(e.target.value)}
              options={items.map((a) => ({ value: a.userId, label: a.fullName }))}
            />
            <div>
              <label
                htmlFor={`${titleId}-pin`}
                className="block text-sm font-medium text-neutral-800"
              >
                {t('approval.pin')}
              </label>
              <input
                id={`${titleId}-pin`}
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={pin}
                aria-invalid={pinError ? true : undefined}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ''));
                  setPinError(null);
                }}
                className="mt-1 min-h-11 w-full rounded-md border border-neutral-300 px-3 text-lg tracking-widest focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
              />
              {pinError && <p className="mt-1 text-sm text-danger-700">{pinError}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => onDone(null)}>
                {t('approval.cancel')}
              </Button>
              <Button type="submit">{t('approval.approve')}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
