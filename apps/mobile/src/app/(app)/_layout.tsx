import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text, View } from 'react-native';
import { Button, screenStyles } from '@/components/ui';
import { bootstrapSession, signOut } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Everything in this group requires a session. */
export default function AuthenticatedLayout() {
  const { t } = useTranslation();
  const session = useSession();
  const [retrying, setRetrying] = useState(false);

  if (session.status === 'loading') {
    return (
      <View style={screenStyles.center}>
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  if (session.status === 'offline') {
    return (
      <View style={screenStyles.center}>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('mobile.offline.title')}
        </Text>
        <Text style={[screenStyles.subtitle, { textAlign: 'center' }]}>
          {t('mobile.offline.body')}
        </Text>
        <Button
          label={t('common.retry')}
          loading={retrying}
          onPress={() => {
            setRetrying(true);
            void bootstrapSession().finally(() => setRetrying(false));
          }}
        />
        <Button variant="secondary" label={t('common.signOut')} onPress={() => void signOut()} />
      </View>
    );
  }
  if (session.status === 'anonymous') return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
