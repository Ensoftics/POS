import { isApiError } from '@pos/api-client';
import type { ApprovalAction, ApprovalDto, ApproverList } from '@pos/contracts';
import { APPROVAL_PIN_PATTERN } from '@pos/domain';
import { colors, fontSizes, radii, spacing, touchTarget } from '@pos/ui-tokens';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Banner, Button, screenStyles, TextField } from './ui';

const APPROVAL_CODES = ['APPROVAL_REQUIRED', 'APPROVAL_INVALID', 'APPROVAL_LOCKED'];

interface Pending {
  action: ApprovalAction;
  error: string | null;
  resolve: (approval: ApprovalDto | null) => void;
}

/**
 * Manager approval on the till: tries the action, and when the API says a manager
 * must approve (or the PIN was wrong) asks for the manager and PIN, then retries.
 * Resolves to null when cancelled.
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

  const prompt = pending ? (
    <ApprovalPrompt action={pending.action} error={pending.error} onDone={pending.resolve} />
  ) : null;
  return { run, prompt };
}

function ApprovalPrompt({
  action,
  error,
  onDone,
}: {
  action: ApprovalAction;
  error: string | null;
  onDone: (approval: ApprovalDto | null) => void;
}) {
  const { t } = useTranslation();
  const [approvers, setApprovers] = useState<ApproverList['items'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approverId, setApproverId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  useEffect(() => {
    api.approvals
      .approvers()
      .then((list) => {
        setApprovers(list.items);
        setApproverId(list.items[0]?.userId ?? null);
      })
      .catch((e: unknown) => setLoadError(errorMessage(t, e)));
  }, [t]);

  const approve = () => {
    if (!approverId) return;
    if (!APPROVAL_PIN_PATTERN.test(pin)) return setPinError(t('validation.pin.invalid'));
    onDone({ approverId, pin });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={() => onDone(null)}>
      <View style={styles.backdrop}>
        <View style={[screenStyles.card, styles.sheet]} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={screenStyles.title}>
            {t('approval.title')}
          </Text>
          <Text style={screenStyles.subtitle}>{t(`approval.reasons.${action}`)}</Text>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {loadError ? <Banner tone="danger">{loadError}</Banner> : null}
          {approvers && approvers.length === 0 ? (
            <Banner tone="warning">{t('approval.noApprovers')}</Banner>
          ) : null}
          {approvers && approvers.length > 0 ? (
            <>
              <Text style={screenStyles.rowLabel}>{t('mobile.approval.choose')}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {approvers.map((a) => (
                  <Pressable
                    key={a.userId}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: approverId === a.userId }}
                    onPress={() => setApproverId(a.userId)}
                    style={[styles.chip, approverId === a.userId && styles.chipActive]}
                  >
                    <Text style={approverId === a.userId ? styles.chipTextActive : styles.chipText}>
                      {a.fullName}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextField
                label={t('approval.pin')}
                value={pin}
                onChangeText={(text) => {
                  setPin(text.replace(/\D/g, ''));
                  setPinError(null);
                }}
                secureTextEntry
                keyboardType="number-pad"
                maxLength={8}
                error={pinError ?? undefined}
              />
              <Button label={t('approval.approve')} onPress={approve} />
            </>
          ) : null}
          <Button variant="secondary" label={t('approval.cancel')} onPress={() => onDone(null)} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing[4],
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: { gap: spacing[3] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    minHeight: touchTarget,
    paddingHorizontal: spacing[3],
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  chipActive: { backgroundColor: colors.brand[700], borderColor: colors.brand[700] },
  chipText: { color: colors.neutral[800], fontSize: fontSizes.sm },
  chipTextActive: { color: colors.neutral[0], fontSize: fontSizes.sm, fontWeight: '600' },
});
