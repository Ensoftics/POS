import type { Notification } from '@pos/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { notificationText } from '@/lib/notifications';
import { useLoad } from '@/lib/use-load';

/** The signed-in person's notifications; tapping one marks it read. */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const [list, reload] = useLoad(() => api.notifications.list({ limit: 30 }));
  const [read, setRead] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const markRead = (n: Notification) => {
    if (n.readAt || read.has(n.id)) return;
    setRead((prev) => new Set(prev).add(n.id));
    api.notifications.markRead(n.id).catch((err: unknown) => setError(errorMessage(t, err)));
  };
  const markAll = () => {
    setError(null);
    api.notifications.markAllRead().then(reload, (err: unknown) => setError(errorMessage(t, err)));
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={screenStyles.container}>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('notifications.title')}
        </Text>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {list.status === 'loading' ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        ) : list.status === 'error' ? (
          <>
            <Banner tone="danger">{errorMessage(t, list.error)}</Banner>
            <Button variant="secondary" label={t('common.retry')} onPress={reload} />
          </>
        ) : list.data.items.length === 0 ? (
          <Text style={screenStyles.subtitle}>{t('notifications.empty')}</Text>
        ) : (
          <>
            <Button variant="secondary" label={t('notifications.markAll')} onPress={markAll} />
            {list.data.items.map((n) => {
              const text = notificationText(t, n);
              const unread = !n.readAt && !read.has(n.id);
              return (
                <Pressable
                  key={n.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${unread ? `${t('notifications.unread')}: ` : ''}${text.title}. ${text.body}`}
                  onPress={() => markRead(n)}
                  style={screenStyles.card}
                >
                  <View>
                    <Text style={[screenStyles.rowValue, unread ? { fontWeight: '700' } : null]}>
                      {unread ? '● ' : ''}
                      {text.title}
                    </Text>
                    <Text style={screenStyles.rowLabel}>{text.body}</Text>
                  </View>
                </Pressable>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
