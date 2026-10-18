import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { getDeviceId } from '@/lib/device-id';
import { saveDeviceRegister, toDeviceRegister } from '@/lib/device-register';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';

/** Lets the signed-in user pick which register this device sells from. */
export default function SelectRegisterScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const [branches, reload] = useLoad(() => api.branches.list());
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (session.status !== 'authenticated') return null;
  const tenantId = session.context.tenant.id;

  const choose = async (branchId: string, registerId: string) => {
    if (branches.status !== 'ready') return;
    const branch = branches.data.items.find((b) => b.id === branchId);
    const selection = branch ? toDeviceRegister(branch, registerId) : null;
    if (!selection) return;
    setSaving(registerId);
    setError(null);
    try {
      // Enrol this till with the business so it shows in Settings › Devices and can be blocked.
      await api.devices.register(await getDeviceId(), {
        name: t('mobile.register.deviceName', { register: selection.registerName }),
        registerId,
      });
      await saveDeviceRegister(tenantId, selection);
      router.replace('/');
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setSaving(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={screenStyles.container}>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('mobile.register.title')}
        </Text>
        <Text style={screenStyles.subtitle}>{t('mobile.register.subtitle')}</Text>
        {error && <Banner tone="danger">{error}</Banner>}

        {branches.status === 'loading' ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        ) : branches.status === 'error' ? (
          <>
            <Banner tone="danger">{errorMessage(t, branches.error)}</Banner>
            <Button variant="secondary" label={t('common.retry')} onPress={reload} />
          </>
        ) : branches.data.items.every((b) => b.registers.length === 0) ? (
          <Banner tone="warning">{t('mobile.register.empty')}</Banner>
        ) : (
          branches.data.items.map((branch) => (
            <View key={branch.id} style={screenStyles.card}>
              <Text accessibilityRole="header" style={screenStyles.rowValue}>
                {branch.name}
              </Text>
              <Text style={screenStyles.rowLabel}>
                {t('mobile.register.branch', { code: branch.code })}
              </Text>
              {branch.registers.map((register) => (
                <Button
                  key={register.id}
                  variant="secondary"
                  label={`${register.name} (${register.code})`}
                  loading={saving === register.id}
                  disabled={saving !== null}
                  onPress={() => void choose(branch.id, register.id)}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
