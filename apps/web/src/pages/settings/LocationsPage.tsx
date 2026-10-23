import { zodResolver } from '@hookform/resolvers/zod';
import {
  type Branch,
  createBranchRequestSchema,
  createRegisterRequestSchema,
  type Register,
} from '@pos/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Phone, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  Skeleton,
  TextField,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { applyServerIssues, errorMessage } from '../../lib/errors';

const branchFields = createBranchRequestSchema;
type BranchInput = z.input<typeof branchFields>;
type BranchOutput = z.output<typeof branchFields>;
const registerFields = createRegisterRequestSchema.pick({ code: true, name: true });
type RegisterInput = z.input<typeof registerFields>;
type RegisterOutput = z.output<typeof registerFields>;

const branchesKey = (tenantId: string) => ['branches', tenantId] as const;

function useInvalidateBranches() {
  const queryClient = useQueryClient();
  const { tenant } = useAuthContext();
  return () => queryClient.invalidateQueries({ queryKey: branchesKey(tenant.id) });
}

export function LocationsPage() {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const canManage = permissions.includes('branches.manage');
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const query = useQuery({
    queryKey: [...branchesKey(tenant.id), { showArchived }],
    queryFn: () => api.branches.list({ includeArchived: showArchived }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-neutral-600">{t('locations.intro')}</p>
        <div className="flex items-center gap-4">
          <CheckboxField
            label={t('locations.showArchived')}
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          {canManage && !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" />
              {t('locations.addBranch')}
            </Button>
          )}
        </div>
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}

      {adding && (
        <Card title={t('locations.addBranch')}>
          <BranchForm
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              setNotice(t('locations.branchAdded'));
            }}
          />
        </Card>
      )}

      {query.isPending ? (
        <Card>
          <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        </Card>
      ) : query.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, query.error)}
        </Alert>
      ) : query.data.items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('locations.empty')}</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {query.data.items.map((branch) => (
            <li key={branch.id}>
              <BranchCard branch={branch} canManage={canManage} onNotice={setNotice} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BranchCard({
  branch,
  canManage,
  onNotice,
}: {
  branch: Branch;
  canManage: boolean;
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateBranches();
  const [editing, setEditing] = useState(false);
  const [addingRegister, setAddingRegister] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = branch.status === 'ARCHIVED';

  const toggle = useMutation({
    mutationFn: () =>
      api.branches.update(branch.id, {
        version: branch.version,
        status: archived ? 'ACTIVE' : 'ARCHIVED',
      }),
    onSuccess: () => {
      onNotice(t('locations.updated'));
      return invalidate();
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  const confirmToggle = () => {
    if (!archived && !window.confirm(t('locations.archiveBranchConfirm', { name: branch.name })))
      return;
    setError(null);
    toggle.mutate();
  };

  return (
    <section
      aria-labelledby={`branch-${branch.id}`}
      className={`rounded-lg bg-white p-5 border border-neutral-200 ${archived ? 'opacity-75' : ''}`}
    >
      {editing ? (
        <BranchForm
          branch={branch}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onNotice(t('locations.updated'));
          }}
        />
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h2
              id={`branch-${branch.id}`}
              className="flex flex-wrap items-center gap-2 text-base font-semibold"
            >
              {branch.name}
              <Badge>{branch.code}</Badge>
              <Badge tone={archived ? 'warning' : 'success'}>
                {t(`locations.status.${branch.status}`)}
              </Badge>
            </h2>
            {(branch.addressLine1 || branch.city) && (
              <p className="flex items-center gap-1.5 text-sm text-neutral-600">
                <MapPin aria-hidden className="size-4" />
                {[branch.addressLine1, branch.city].filter(Boolean).join(', ')}
              </p>
            )}
            {branch.phone && (
              <p className="flex items-center gap-1.5 text-sm text-neutral-600">
                <Phone aria-hidden className="size-4" />
                {branch.phone}
              </p>
            )}
          </div>
          {canManage && (
            <div className="flex gap-2">
              {!archived && (
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {t('locations.editBranch')}
                </Button>
              )}
              <Button
                variant={archived ? 'secondary' : 'danger'}
                loading={toggle.isPending}
                onClick={confirmToggle}
              >
                {archived ? t('locations.restore') : t('locations.archive')}
              </Button>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}

      <div className="mt-5 border-t border-neutral-100 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-neutral-800">{t('locations.registers')}</h3>
          {canManage && !archived && !addingRegister && (
            <Button variant="ghost" onClick={() => setAddingRegister(true)}>
              <Plus aria-hidden className="size-4" />
              {t('locations.addRegister')}
            </Button>
          )}
        </div>
        {branch.registers.length === 0 && !addingRegister ? (
          <p className="text-sm text-neutral-600">{t('locations.noRegisters')}</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {branch.registers.map((register) => (
              <RegisterRow
                key={register.id}
                register={register}
                canManage={canManage && !archived}
                onNotice={onNotice}
              />
            ))}
          </ul>
        )}
        {addingRegister && (
          <div className="mt-3 rounded-md bg-neutral-50 p-4">
            <RegisterForm
              branchId={branch.id}
              onCancel={() => setAddingRegister(false)}
              onSaved={() => {
                setAddingRegister(false);
                onNotice(t('locations.registerAdded'));
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function RegisterRow({
  register,
  canManage,
  onNotice,
}: {
  register: Register;
  canManage: boolean;
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateBranches();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = register.status === 'ARCHIVED';

  const toggle = useMutation({
    mutationFn: () =>
      api.registers.update(register.id, {
        version: register.version,
        status: archived ? 'ACTIVE' : 'ARCHIVED',
      }),
    onSuccess: () => {
      onNotice(t('locations.updated'));
      return invalidate();
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  if (editing) {
    return (
      <li className="py-3">
        <RegisterForm
          register={register}
          branchId={register.branchId}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onNotice(t('locations.updated'));
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-neutral-900">{register.name}</span>
        <Badge>{register.code}</Badge>
        {archived && <Badge tone="warning">{t('locations.status.ARCHIVED')}</Badge>}
        {error && <span className="text-danger-700">{error}</span>}
      </div>
      {canManage && (
        <div className="flex gap-2">
          {!archived && (
            <Button
              variant="ghost"
              onClick={() => setEditing(true)}
              aria-label={`${t('locations.editRegister')}: ${register.name}`}
            >
              {t('locations.editRegister')}
            </Button>
          )}
          <Button
            variant="ghost"
            loading={toggle.isPending}
            aria-label={`${archived ? t('locations.restore') : t('locations.archive')}: ${register.name}`}
            onClick={() => {
              if (
                !archived &&
                !window.confirm(t('locations.archiveRegisterConfirm', { name: register.name }))
              )
                return;
              setError(null);
              toggle.mutate();
            }}
          >
            {archived ? t('locations.restore') : t('locations.archive')}
          </Button>
        </div>
      )}
    </li>
  );
}

function BranchForm({
  branch,
  onCancel,
  onSaved,
}: {
  branch?: Branch;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateBranches();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<BranchInput, unknown, BranchOutput>({
    resolver: zodResolver(branchFields),
    defaultValues: {
      code: branch?.code ?? '',
      name: branch?.name ?? '',
      addressLine1: branch?.addressLine1 ?? '',
      city: branch?.city ?? '',
      phone: branch?.phone ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (branch) await api.branches.update(branch.id, { version: branch.version, ...values });
      else await api.branches.create(values);
      await invalidate();
      onSaved();
    } catch (error) {
      if (
        !applyServerIssues(error, form.setError, ['code', 'name', 'addressLine1', 'city', 'phone'])
      ) {
        setFormError(errorMessage(t, error));
      }
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={t('locations.name')}
          autoFocus
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={t('locations.code')}
          hint={t('locations.codeHint')}
          className="uppercase"
          maxLength={12}
          error={errors.code?.message}
          {...form.register('code')}
        />
        <TextField
          label={t('locations.addressLine1')}
          optional
          error={errors.addressLine1?.message}
          {...form.register('addressLine1')}
        />
        <TextField
          label={t('locations.city')}
          optional
          error={errors.city?.message}
          {...form.register('city')}
        />
        <TextField
          label={t('locations.phone')}
          optional
          type="tel"
          error={errors.phone?.message}
          {...form.register('phone')}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('locations.cancel')}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {t('locations.save')}
        </Button>
      </div>
    </form>
  );
}

function RegisterForm({
  branchId,
  register,
  onCancel,
  onSaved,
}: {
  branchId: string;
  register?: Register;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const invalidate = useInvalidateBranches();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterInput, unknown, RegisterOutput>({
    resolver: zodResolver(registerFields),
    defaultValues: { code: register?.code ?? '', name: register?.name ?? '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (register)
        await api.registers.update(register.id, { version: register.version, ...values });
      else await api.registers.create({ branchId, ...values });
      await invalidate();
      onSaved();
    } catch (error) {
      if (!applyServerIssues(error, form.setError, ['code', 'name']))
        setFormError(errorMessage(t, error));
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-3">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t('locations.name')}
          autoFocus
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={t('locations.code')}
          className="uppercase"
          maxLength={12}
          error={errors.code?.message}
          {...form.register('code')}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('locations.cancel')}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {t('locations.save')}
        </Button>
      </div>
    </form>
  );
}
