import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Alert, Button, Card, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { useBusinessDateTime } from '../../lib/sales';
import { ShiftSummaryList } from '../pos/ShiftPanels';

/** Printable end-of-shift (Z) report: sales, tenders, refunds, cash movements and the count. */
export function ShiftReportPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { tenant } = useAuthContext();
  const { format: money } = useMoney();
  const dateTime = useBusinessDateTime();
  const shift = useQuery({ queryKey: ['shift-report', id], queryFn: () => api.shifts.get(id) });
  if (shift.isPending) return <Skeleton className="h-64 w-full" />;
  if (shift.isError) return <Alert tone="danger">{errorMessage(t, shift.error)}</Alert>;
  const s = shift.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          to="/reports?tab=shifts"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('reports.backToShifts')}
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t('reports.print')}
        </Button>
      </div>
      <Card>
        <article
          className="print-area mx-auto max-w-md space-y-4 text-sm"
          aria-label={t('reports.zReport')}
        >
          <header className="space-y-0.5 text-center">
            <p className="text-base font-bold">{tenant.name}</p>
            <p className="font-semibold">
              {t('reports.zReport')} · {s.number}
            </p>
            <p>
              {s.branchName} › {s.registerName}
            </p>
            <p>
              {s.openedByName} · {dateTime(s.openedAt)}
              {s.closedAt ? ` – ${dateTime(s.closedAt)}` : ` · ${t('reports.stillOpen')}`}
            </p>
          </header>
          <ShiftSummaryList shift={s} money={money} />
          {s.countedCashMinor !== null && (
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 border-t border-dashed border-neutral-400 pt-2 font-semibold">
              <dt>{t('pos.shift.counted')}</dt>
              <dd className="text-right tabular-nums">{money(s.countedCashMinor)}</dd>
              <dt>{t('pos.shift.difference')}</dt>
              <dd className="text-right tabular-nums" data-testid="z-difference">
                {money(s.differenceMinor ?? 0)}
              </dd>
            </dl>
          )}
          {s.cashMovements.length > 0 && (
            <div>
              <h2 className="font-semibold">{t('pos.shift.movements')}</h2>
              <ul>
                {s.cashMovements.map((m) => (
                  <li key={m.id} className="flex justify-between gap-2">
                    <span>
                      {m.type === 'PAY_IN' ? t('pos.shift.payIn') : t('pos.shift.payOut')} ·{' '}
                      {m.reason}
                    </span>
                    <span className="tabular-nums">
                      {money(m.type === 'PAY_IN' ? m.amountMinor : -m.amountMinor)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.closingNotes && <p className="italic">{s.closingNotes}</p>}
        </article>
      </Card>
    </div>
  );
}
