import { forgotPasswordRequestSchema } from '@pos/contracts';
import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const parsed = forgotPasswordRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(t(parsed.error.issues[0]?.message ?? 'validation.required'));
      return;
    }
    setFieldError(undefined);
    setFormError(null);
    setSubmitting(true);
    try {
      await api.auth.forgotPassword(parsed.data);
      setSentTo(parsed.data.email);
    } catch (error) {
      setFormError(errorMessage(t, error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={screenStyles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('auth.forgot.title')}
        </Text>
        {sentTo ? (
          <Banner tone="success">{t('auth.forgot.sent', { email: sentTo })}</Banner>
        ) : (
          <>
            <Text style={screenStyles.subtitle}>{t('auth.forgot.subtitle')}</Text>
            {formError ? <Banner tone="danger">{formError}</Banner> : null}
            <TextField
              label={t('auth.login.email')}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              error={fieldError}
            />
            <Button
              label={t('auth.forgot.submit')}
              loading={submitting}
              onPress={() => void submit()}
            />
          </>
        )}
        <Link href="/login" style={screenStyles.link}>
          {t('auth.forgot.backToLogin')}
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}
