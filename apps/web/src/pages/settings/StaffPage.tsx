import { zodResolver } from '@hookform/resolvers/zod';
import { createInvitationRequestSchema, type Invitation, type StaffMember } from '@pos/contracts';
import { canManageRole, type TenantRole } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MailPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxGroup,
  SelectField,
  Skeleton,
  TextField,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { applyServerIssues, errorMessage } from '../../lib/errors';
import { useActiveBranches } from '../../lib/inventory';

const ROLES: TenantRole[] = ['OWNER', 'MANAGER', 'CASHIER', 'INVENTORY_STAFF'];
type InviteInput = z.input<typeof createInvitationRequestSchema>;
type InviteOutput = z.output<typeof createInvitationRequestSchema>;

const staffKey = (tenantId: string) => ['staff', tenantId] as const;

function useDateTime() {
  const { i18n } = useTranslation();
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (iso: string) => format.format(new Date(iso));
}

/** Settings › Staff: who works here, what they may do and where. */
export function StaffPage() {
  const { t } = useTranslation();
  const { tenant, role, permissions } = useAuthContext();
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const staff = useQuery({
    queryKey: staffKey(tenant.id),
    queryFn: () => api.staff.list(),
    enabled: permissions.includes('staff.manage'),
  });

  if (!permissions.includes('staff.manage'))
    return <Alert tone="warning">{t('errors.FORBIDDEN')}</Alert>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-neutral-600">{t('staff.intro')}</p>
        {!inviting && (
          <Button onClick={() => setInviting(true)}>
            <MailPlus aria-hidden className="size-4" />
            {t('staff.invite')}
          </Button>
        )}
      </div>

      {notice && <Alert tone="success">{notice}</Alert>}

      {inviting && (
        <Card title={t('staff.invite')}>
          <InviteForm
            roles={ROLES.filter((r) => canManageRole(role, r))}
            onCancel={() => setInviting(false)}
            onSent={(email) => {
              setInviting(false);
              setNotice(t('staff.invited', { email }));
            }}
          />
        </Card>
      )}

      {staff.isPending ? (
        <Card>
          <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        </Card>
      ) : staff.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void staff.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, staff.error)}
        </Alert>
      ) : (
        <>
          <Card title={t('staff.members')}>
            <ul className="divide-y divide-neutral-200">
              {staff.data.members.map((member) => (
                <li key={member.membershipId} className="py-3 first:pt-0 last:pb-0">
                  <MemberRow member={member} onNotice={setNotice} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title={t('staff.pending')}>
            {staff.data.invitations.length === 0 ? (
              <p className="text-sm text-neutral-600">{t('staff.noPending')}</p>
            ) : (
              <ul className="divide-y divide-neutral-200">
                {staff.data.invitations.map((invitation) => (
                  <li key={invitation.id} className="py-3 first:pt-0 last:pb-0">
                    <InvitationRow
                      invitation={invitation}
                      canWithdraw={canManageRole(role, invitation.role)}
                      onNotice={setNotice}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function useBranchNames() {
  const branches = useActiveBranches();
  const names = new Map((branches.data ?? []).map((b) => [b.id, b.name]));
  return { branches: branches.data ?? [], names };
}

function BranchSummary({ role, branchIds }: { role: TenantRole; branchIds: string[] }) {
  const { t } = useTranslation();
  const { names } = useBranchNames();
  if (role === 'OWNER' || branchIds.length === 0) return <>{t('staff.allBranches')}</>;
  return <>{branchIds.map((id) => names.get(id) ?? '—').join(', ')}</>;
}

function MemberRow({ member, onNotice }: { member: StaffMember; onNotice: (m: string) => void }) {
  const { t } = useTranslation();
  const { tenant, role } = useAuthContext();
  const queryClient = useQueryClient();
  const formatDate = useDateTime();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = member.status === 'DISABLED';

  const toggle = useMutation({
    mutationFn: () =>
      api.staff.update(member.membershipId, {
        version: member.version,
        status: disabled ? 'ACTIVE' : 'DISABLED',
      }),
    onSuccess: () => {
      onNotice(t('staff.updated', { name: member.fullName }));
      return queryClient.invalidateQueries({ queryKey: staffKey(tenant.id) });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  if (editing)
    return (
      <AccessForm
        member={member}
        roles={ROLES.filter((r) => canManageRole(role, r))}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onNotice(t('staff.updated', { name: member.fullName }));
        }}
      />
    );

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className={`space-y-1 ${disabled ? 'opacity-75' : ''}`}>
        <p className="flex flex-wrap items-center gap-2 font-medium text-neutral-900">
          {member.fullName}
          {member.isSelf && <Badge>{t('staff.you')}</Badge>}
          <Badge tone={disabled ? 'warning' : 'success'}>
            {t(`staff.status.${member.status}`)}
          </Badge>
        </p>
        <p className="text-sm text-neutral-600">{member.email}</p>
        <p className="text-sm text-neutral-700">
          {t(`roles.${member.role}`)} ·{' '}
          <BranchSummary role={member.role} branchIds={member.branchIds} />
        </p>
        <p className="text-xs text-neutral-500">
          {member.lastLoginAt
            ? t('staff.lastLogin', { date: formatDate(member.lastLoginAt) })
            : t('staff.neverSignedIn')}
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
      {member.manageable && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            aria-label={`${t('staff.edit')}: ${member.fullName}`}
            onClick={() => setEditing(true)}
          >
            {t('staff.edit')}
          </Button>
          <Button
            variant="secondary"
            loading={toggle.isPending}
            aria-label={`${disabled ? t('staff.enable') : t('staff.disable')}: ${member.fullName}`}
            onClick={() => {
              if (
                !disabled &&
                !window.confirm(t('staff.disableConfirm', { name: member.fullName }))
              )
                return;
              setError(null);
              toggle.mutate();
            }}
          >
            {disabled ? t('staff.enable') : t('staff.disable')}
          </Button>
        </div>
      )}
    </div>
  );
}

function InvitationRow({
  invitation,
  canWithdraw,
  onNotice,
}: {
  invitation: Invitation;
  canWithdraw: boolean;
  onNotice: (m: string) => void;
}) {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const formatDate = useDateTime();
  const [error, setError] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: () => api.staff.revokeInvitation(invitation.id),
    onSuccess: () => {
      onNotice(t('staff.withdrawn'));
      return queryClient.invalidateQueries({ queryKey: staffKey(tenant.id) });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <p className="font-medium text-neutral-900">{invitation.email}</p>
        <p className="text-sm text-neutral-700">
          {t(`roles.${invitation.role}`)} ·{' '}
          <BranchSummary role={invitation.role} branchIds={invitation.branchIds} />
        </p>
        <p className="text-xs text-neutral-500">
          {invitation.expired ? (
            <Badge tone="warning">{t('staff.expired')}</Badge>
          ) : (
            t('staff.expires', { date: formatDate(invitation.expiresAt) })
          )}
          {invitation.invitedByName && (
            <> · {t('staff.invitedBy', { name: invitation.invitedByName })}</>
          )}
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
      {canWithdraw && (
        <Button
          variant="secondary"
          loading={withdraw.isPending}
          aria-label={`${t('staff.withdraw')}: ${invitation.email}`}
          onClick={() => {
            if (!window.confirm(t('staff.withdrawConfirm', { email: invitation.email }))) return;
            setError(null);
            withdraw.mutate();
          }}
        >
          {t('staff.withdraw')}
        </Button>
      )}
    </div>
  );
}

function RoleAndBranches({
  roles,
  form,
}: {
  roles: TenantRole[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared by two forms with the same fields
  form: ReturnType<typeof useForm<any>>;
}) {
  const { t } = useTranslation();
  const { branches } = useBranchNames();
  const selectedRole = form.watch('role') as TenantRole;
  const { errors } = form.formState;
  return (
    <>
      <SelectField
        label={t('staff.role')}
        hint={t(`staff.roleHint.${selectedRole}`)}
        options={roles.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
        {...form.register('role')}
      />
      {selectedRole === 'OWNER' ? (
        <p className="text-sm text-neutral-600">{t('staff.ownerBranches')}</p>
      ) : (
        branches.length > 1 && (
          <CheckboxGroup
            legend={t('staff.branches')}
            hint={t('staff.branchesHint')}
            error={errors.branchIds?.message as string | undefined}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
            inputProps={form.register('branchIds')}
          />
        )
      )}
    </>
  );
}

function InviteForm({
  roles,
  onCancel,
  onSent,
}: {
  roles: TenantRole[];
  onCancel: () => void;
  onSent: (email: string) => void;
}) {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<InviteInput, unknown, InviteOutput>({
    resolver: zodResolver(createInvitationRequestSchema),
    defaultValues: {
      email: '',
      role: roles.includes('CASHIER') ? 'CASHIER' : roles[0],
      branchIds: [],
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.staff.invite({
        ...values,
        branchIds: values.role === 'OWNER' ? [] : values.branchIds,
      });
      await queryClient.invalidateQueries({ queryKey: staffKey(tenant.id) });
      onSent(values.email);
    } catch (error) {
      if (!applyServerIssues(error, form.setError, ['email', 'role', 'branchIds']))
        setFormError(errorMessage(t, error));
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <TextField
        label={t('staff.email')}
        type="email"
        autoComplete="off"
        autoFocus
        error={errors.email?.message}
        {...form.register('email')}
      />
      <RoleAndBranches roles={roles} form={form} />
      <div className="flex gap-2">
        <Button type="submit" loading={isSubmitting}>
          {t('staff.send')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('staff.cancel')}
        </Button>
      </div>
    </form>
  );
}

type AccessValues = { role: TenantRole; branchIds: string[] };

function AccessForm({
  member,
  roles,
  onCancel,
  onSaved,
}: {
  member: StaffMember;
  roles: TenantRole[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AccessValues>({
    defaultValues: { role: member.role, branchIds: member.branchIds },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.staff.update(member.membershipId, {
        version: member.version,
        role: values.role,
        branchIds: values.role === 'OWNER' ? [] : (values.branchIds ?? []),
      });
      await queryClient.invalidateQueries({ queryKey: staffKey(tenant.id) });
      onSaved();
    } catch (error) {
      if (!applyServerIssues(error, form.setError, ['role', 'branchIds']))
        setFormError(errorMessage(t, error));
    }
  });

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="space-y-4"
      aria-label={t('staff.editTitle', { name: member.fullName })}
    >
      <p className="font-medium text-neutral-900">
        {t('staff.editTitle', { name: member.fullName })}
      </p>
      {formError && <Alert tone="danger">{formError}</Alert>}
      <RoleAndBranches roles={roles} form={form} />
      <div className="flex gap-2">
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('staff.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('staff.cancel')}
        </Button>
      </div>
    </form>
  );
}
