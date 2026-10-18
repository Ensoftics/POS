import { zodResolver } from '@hookform/resolvers/zod';
import { isApiError } from '@pos/api-client';
import type { TenantSettings, UpdateTenantSettingsRequest } from '@pos/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { type DefaultValues, type FieldValues, type Resolver, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { api } from './api';
import { useAuthContext } from './auth-store';
import { applyServerIssues, errorMessage } from './errors';

export const settingsKey = (tenantId: string) => ['settings', tenantId] as const;

export function useSettings() {
  const { tenant } = useAuthContext();
  return useQuery({ queryKey: settingsKey(tenant.id), queryFn: () => api.settings.get() });
}

export interface Feedback {
  tone: 'success' | 'warning' | 'danger';
  message: string;
}

/**
 * One settings section form: validates with a shared Zod schema, saves with the
 * current version, maps server field errors, and on VERSION_CONFLICT reloads the
 * latest settings and tells the user to re-apply their change.
 */
export function useSettingsForm<S extends z.ZodType<FieldValues, FieldValues>>(options: {
  schema: S;
  settings: TenantSettings;
  toValues: (settings: TenantSettings) => z.input<S>;
  toRequest?: (values: z.output<S>) => Omit<UpdateTenantSettingsRequest, 'version'>;
}) {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const toValues = useRef(options.toValues);
  const canEdit = permissions.includes('settings.update');

  const form = useForm<z.input<S>, unknown, z.output<S>>({
    resolver: zodResolver(options.schema as never) as unknown as Resolver<
      z.input<S>,
      unknown,
      z.output<S>
    >,
    defaultValues: options.toValues(options.settings) as DefaultValues<z.input<S>>,
  });

  // Keep the form in sync with the latest saved (or reloaded) settings.
  useEffect(() => {
    form.reset(toValues.current(options.settings) as DefaultValues<z.input<S>>);
  }, [options.settings, form]);

  const mutation = useMutation({
    mutationFn: (body: UpdateTenantSettingsRequest) => api.settings.update(body),
    onSuccess: (updated) => queryClient.setQueryData(settingsKey(tenant.id), updated),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFeedback(null);
    try {
      const request = options.toRequest ? options.toRequest(values) : values;
      await mutation.mutateAsync({ version: options.settings.version, ...request });
      setFeedback({ tone: 'success', message: t('settings.saved') });
    } catch (error) {
      if (isApiError(error) && error.code === 'VERSION_CONFLICT') {
        await queryClient.invalidateQueries({ queryKey: settingsKey(tenant.id) });
        setFeedback({ tone: 'warning', message: t('settings.conflict') });
        return;
      }
      const fields = Object.keys(options.toValues(options.settings) as object);
      if (!applyServerIssues(error, form.setError, fields)) {
        setFeedback({ tone: 'danger', message: errorMessage(t, error) });
      }
    }
  });

  return { form, onSubmit, feedback, canEdit, saving: mutation.isPending };
}
