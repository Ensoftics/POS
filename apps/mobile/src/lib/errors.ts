import { isApiError } from '@pos/api-client';
import type { TFunction } from 'i18next';

export function errorMessage(t: TFunction, error: unknown): string {
  if (isApiError(error)) return t(`errors.${error.code}`, { defaultValue: t('errors.generic') });
  return t('errors.generic');
}
