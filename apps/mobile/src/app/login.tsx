import { isTenantSelection, loginRequestSchema, type MembershipSummary } from '@pos/contracts';
import { Link, Redirect } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { getDeviceId } from '@/lib/device-id';
import { errorMessage } from '@/lib/errors';
import { sessionStore, useSession } from '@/lib/session';

const credentialsSchema = loginRequestSchema.pick({ email: true, password: true });
type FieldErrors = Partial<Record<'email' | 'password', string>>;

export default function LoginScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [choices, setChoices] = useState<MembershipSummary[] | null>(null);

  if (session.status === 'authenticated') return <Redirect href="/" />;
  if (session.status === 'loading') {
    return (
      <View style={screenStyles.center}>
        <ActivityIndicator accessibilityLabel={t('common.loading')} />
      </View>
    );
  }

  async function signIn(tenantId?: string) {
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        errors[key] ??= t(issue.message);
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      const deviceId = await getDeviceId();
      const result = await api.auth.login({
        ...parsed.data,
        tenantId,
        deviceName: Platform.OS,
        deviceId,
      });
      if (isTenantSelection(result)) {
        setChoices(result.tenants);
      } else {
        await sessionStore.applySession(result);
      }
    } catch (error) {
      setFormError(errorMessage(t, error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={screenStyles.container}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={screenStyles.subtitle}>{t('common.appName')}</Text>
          <Text accessibilityRole="header" style={screenStyles.title}>
            {choices ? t('auth.login.chooseBusiness') : t('auth.login.title')}
          </Text>

          {session.status === 'anonymous' && session.reason === 'expired' && !formError ? (
            <Banner tone="warning">{t('auth.login.sessionEnded')}</Banner>
          ) : null}
          {formError ? <Banner tone="danger">{formError}</Banner> : null}

          {choices ? (
            choices.map((choice) => (
              <Button
                key={choice.tenantId}
                variant="secondary"
                label={`${choice.tenantName} · ${t(`roles.${choice.role}`)}`}
                loading={submitting}
                onPress={() => void signIn(choice.tenantId)}
              />
            ))
          ) : (
            <>
              <Text style={screenStyles.subtitle}>{t('mobile.login.subtitle')}</Text>
              <TextField
                label={t('auth.login.email')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="username"
                error={fieldErrors.email}
              />
              <TextField
                label={t('auth.login.password')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                textContentType="password"
                onSubmitEditing={() => void signIn()}
                error={fieldErrors.password}
              />
              <Button
                label={t('auth.login.submit')}
                loading={submitting}
                onPress={() => void signIn()}
              />
              <Link href="/forgot-password" style={screenStyles.link}>
                {t('auth.login.forgot')}
              </Link>
              <Text style={screenStyles.subtitle}>{t('mobile.login.noAccount')}</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
