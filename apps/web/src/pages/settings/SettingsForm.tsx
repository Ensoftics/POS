import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card } from '../../components/ui';
import type { Feedback } from '../../lib/settings';

/** Shared frame for a settings section: read-only notice, feedback banner and save button. */
export function SettingsForm({
  onSubmit,
  canEdit,
  saving,
  feedback,
  children,
}: {
  onSubmit: (event?: React.BaseSyntheticEvent) => Promise<void>;
  canEdit: boolean;
  saving: boolean;
  feedback: Feedback | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <form noValidate onSubmit={onSubmit} className="space-y-5">
        {!canEdit && <Alert tone="info">{t('settings.noPermission')}</Alert>}
        {feedback && <Alert tone={feedback.tone}>{feedback.message}</Alert>}
        {/* A disabled fieldset makes every control read-only for non-owners. */}
        <fieldset disabled={!canEdit} className="space-y-5">
          {children}
        </fieldset>
        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              {t('settings.save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
