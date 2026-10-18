import { ADJUSTMENT_REASONS, type AdjustmentReason, DECREASE_ONLY_REASONS } from '@pos/domain';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DocumentLines, type DocumentLine } from '../../components/DocumentLines';
import { ItemPicker } from '../../components/ItemPicker';
import { Alert, Button, Card, SelectField, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';
import { inventoryKey, issuesByPath, newDocumentId, useSelectedBranch } from '../../lib/inventory';

export function AdjustStockPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const [branchId, setBranchId, branches] = useSelectedBranch();
  const [documentId, setDocumentId] = useState(newDocumentId);
  const [reason, setReason] = useState<AdjustmentReason>('DAMAGED');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const decreasing = DECREASE_ONLY_REASONS.includes(reason);

  const submit = async () => {
    setErrors({});
    setFeedback(null);
    setSaving(true);
    try {
      const adjustment = await api.stockAdjustments.create({
        id: documentId,
        branchId: branchId!,
        reason,
        notes,
        lines: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity.trim() })),
      });
      setFeedback({
        tone: 'success',
        message: t('inventory.adjust.posted', { number: adjustment.number }),
      });
      setLines([]);
      setNotes('');
      setDocumentId(newDocumentId());
      await queryClient.invalidateQueries({ queryKey: inventoryKey(tenant.id) });
    } catch (error) {
      const issues = issuesByPath(error);
      setErrors(issues);
      if (Object.keys(issues).length === 0)
        setFeedback({ tone: 'danger', message: errorMessage(t, error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/inventory"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('inventory.title')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('inventory.adjust.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('inventory.adjust.subtitle')}</p>
      </div>
      {feedback && <Alert tone={feedback.tone}>{feedback.message}</Alert>}

      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('inventory.branch')}
            value={branchId ?? ''}
            onChange={(event) => setBranchId(event.target.value)}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <SelectField
            label={t('inventory.adjust.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value as AdjustmentReason)}
            options={ADJUSTMENT_REASONS.map((value) => ({
              value,
              label: t(`inventory.reasons.${value}`),
            }))}
          />
        </div>
      </Card>

      <Card title={t('inventory.lines.title')}>
        <div className="space-y-4">
          <ItemPicker
            onPick={(item) =>
              setLines((current) => [
                ...current,
                { ...item, quantity: decreasing ? '-1' : reason === 'FOUND' ? '1' : '' },
              ])
            }
          />
          <DocumentLines
            lines={lines}
            onChange={setLines}
            errors={errors}
            columns={{ quantityHint: t('inventory.adjust.quantityHint') }}
          />
        </div>
      </Card>

      <Card>
        <TextField
          label={t('inventory.adjust.notes')}
          optional
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => void submit()}
          loading={saving}
          disabled={lines.length === 0 || !branchId}
        >
          {t('inventory.adjust.submit')}
        </Button>
      </div>
    </div>
  );
}
