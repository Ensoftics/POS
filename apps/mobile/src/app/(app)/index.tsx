import { isSubscriptionUsable } from '@pos/domain';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles } from '@/components/ui';
import { api, signOut } from '@/lib/api';
import { resolveDeviceRegister } from '@/lib/device-register';
import { errorMessage } from '@/lib/errors';
import { sessionStore, useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={screenStyles.rowLabel}>{label}</Text>
      <Text style={screenStyles.rowValue}>{value}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const [busy, setBusy] = useState<'signOut' | 'signOutAll' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tenantId = session.status === 'authenticated' ? session.context.tenant.id : '';

  const [workspace, reload] = useLoad(async () => {
    const [settings, branches] = await Promise.all([api.settings.get(), api.branches.list()]);
    const register = await resolveDeviceRegister(tenantId, branches.items);
    return { settings, register, hasBranches: branches.items.length > 0 };
  });

  // A failed count never blocks the home screen.
  const [unread] = useLoad(() => api.notifications.unreadCount().catch(() => ({ unread: 0 })));

  if (session.status !== 'authenticated') return null;
  const { user, tenant, role, subscription } = session.context;
  const readOnly = !!subscription && !isSubscriptionUsable(subscription.status);

  // Onboarded businesses always have a branch; ask for the register before anything else.
  if (workspace.status === 'ready' && !workspace.data.register && workspace.data.hasBranches) {
    return <Redirect href="/register" />;
  }

  const confirmSignOutAll = () =>
    Alert.alert(t('dashboard.signOutAll'), t('dashboard.signOutAllConfirm'), [
      { text: t('mobile.home.cancel'), style: 'cancel' },
      {
        text: t('dashboard.signOutAll'),
        style: 'destructive',
        onPress: () => {
          setBusy('signOutAll');
          api.auth
            .logoutAll()
            .then(() => sessionStore.clear('signed_out'))
            .catch((err: unknown) => setError(errorMessage(t, err)))
            .finally(() => setBusy(null));
        },
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={screenStyles.container}>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('dashboard.greeting', { name: user.fullName })}
        </Text>
        {tenant.onboardingStatus === 'PENDING' ? (
          <Banner tone="warning">{t('mobile.home.onboardingPending')}</Banner>
        ) : null}
        {readOnly ? <Banner tone="danger">{t('mobile.readOnly')}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        {workspace.status === 'loading' ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        ) : workspace.status === 'error' ? (
          <>
            <Banner tone="danger">{errorMessage(t, workspace.error)}</Banner>
            <Button variant="secondary" label={t('common.retry')} onPress={reload} />
          </>
        ) : (
          <View style={screenStyles.card}>
            <Row label={t('mobile.home.business')} value={tenant.name} />
            <Row
              label={t('mobile.home.type')}
              value={
                tenant.businessType
                  ? t(`businessTypes.${tenant.businessType}.label`)
                  : t('dashboard.notSet')
              }
            />
            <Row label={t('mobile.home.role')} value={t(`roles.${role}`)} />
            <Row label={t('mobile.home.currency')} value={workspace.data.settings.currency} />
            {workspace.data.register ? (
              <Row
                label={t('mobile.home.register')}
                value={`${workspace.data.register.registerName} · ${workspace.data.register.branchName}`}
              />
            ) : null}
          </View>
        )}

        {workspace.status === 'ready' &&
        workspace.data.register &&
        session.context.permissions.includes('sales.create') ? (
          <Button label={t('mobile.home.sell')} onPress={() => router.push('/sell')} />
        ) : null}
        {unread.status === 'ready' && unread.data.unread > 0 ? (
          <Button
            variant="secondary"
            label={t('mobile.notifications', { count: unread.data.unread })}
            onPress={() => router.push('/notifications')}
          />
        ) : null}
        {workspace.status === 'ready' ? (
          <Button
            variant="secondary"
            label={t('mobile.lookup.open')}
            onPress={() => router.push('/lookup')}
          />
        ) : null}
        {workspace.status === 'ready' && workspace.data.register ? (
          <Button
            variant="secondary"
            label={t('printing.title')}
            onPress={() => router.push('/printer')}
          />
        ) : null}
        {workspace.status === 'ready' && workspace.data.register ? (
          <Button
            variant="secondary"
            label={t('mobile.home.changeRegister')}
            onPress={() => router.push('/register')}
          />
        ) : null}
        <Button
          variant="secondary"
          label={t('common.signOut')}
          loading={busy === 'signOut'}
          onPress={() => {
            setBusy('signOut');
            void signOut().finally(() => setBusy(null));
          }}
        />
        <Button
          variant="danger"
          label={t('dashboard.signOutAll')}
          loading={busy === 'signOutAll'}
          onPress={confirmSignOutAll}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
