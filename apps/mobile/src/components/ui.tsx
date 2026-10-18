import { colors, fontSizes, radii, spacing, touchTarget } from '@pos/ui-tokens';
import type { ComponentRef, ReactNode, Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

export function Button({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && styles.pressed,
        inactive && styles.inactive,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.neutral[0] : colors.brand[700]} />
      ) : (
        <Text style={[styles.buttonText, variant !== 'primary' && styles[`${variant}Text`]]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string; ref?: Ref<ComponentRef<typeof TextInput>> }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error}
        placeholderTextColor={colors.neutral[400]}
        style={[styles.input, error ? styles.inputError : null]}
        {...props}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: 'danger' | 'warning' | 'success';
  children: ReactNode;
}) {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.banner, { backgroundColor: colors[tone][50] }]}
    >
      <Text style={{ color: colors[tone][700], fontSize: fontSizes.sm }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  primary: { backgroundColor: colors.brand[700] },
  secondary: {
    backgroundColor: colors.neutral[0],
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  danger: { backgroundColor: colors.neutral[0], borderWidth: 1, borderColor: colors.danger[600] },
  pressed: { opacity: 0.85 },
  inactive: { opacity: 0.6 },
  buttonText: { color: colors.neutral[0], fontSize: fontSizes.md, fontWeight: '600' },
  secondaryText: { color: colors.neutral[800] },
  dangerText: { color: colors.danger[700] },
  primaryText: {},
  field: { gap: spacing[1] },
  label: { fontSize: fontSizes.sm, fontWeight: '500', color: colors.neutral[800] },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    fontSize: fontSizes.md,
    color: colors.neutral[900],
    backgroundColor: colors.neutral[0],
  },
  inputError: { borderColor: colors.danger[600] },
  error: { fontSize: fontSizes.sm, color: colors.danger[700] },
  banner: { borderRadius: radii.md, padding: spacing[3] },
});

export const screenStyles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: spacing[6],
    gap: spacing[4],
    backgroundColor: colors.neutral[50],
  },
  title: { fontSize: fontSizes['2xl'], fontWeight: '700', color: colors.neutral[900] },
  subtitle: { fontSize: fontSizes.sm, color: colors.neutral[600] },
  link: {
    color: colors.brand[700],
    fontSize: fontSizes.sm,
    fontWeight: '600',
    paddingVertical: spacing[3],
  },
  card: {
    backgroundColor: colors.neutral[0],
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[2],
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  rowLabel: { fontSize: fontSizes.sm, color: colors.neutral[600] },
  rowValue: { fontSize: fontSizes.md, color: colors.neutral[900], fontWeight: '500' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    gap: spacing[4],
  },
});
