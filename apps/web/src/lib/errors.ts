import { isApiError } from '@pos/api-client';
import type { TFunction } from 'i18next';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

/** Localised, user-safe message for any thrown error. */
export function errorMessage(t: TFunction, error: unknown): string {
  if (isApiError(error)) return t(`errors.${error.code}`, { defaultValue: t('errors.generic') });
  return t('errors.generic');
}

/**
 * Copies server-side validation issues onto form fields. Returns true when at
 * least one field was marked, so callers can skip a duplicate banner.
 */
export function applyServerIssues<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): boolean {
  if (!isApiError(error) || error.code !== 'VALIDATION_FAILED') return false;
  let applied = false;
  for (const issue of error.issues) {
    if (fields.includes(issue.path)) {
      setError(
        issue.path as Path<T>,
        { type: 'server', message: issue.message },
        { shouldFocus: !applied },
      );
      applied = true;
    }
  }
  return applied;
}
