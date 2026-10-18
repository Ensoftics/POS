import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/* Buttons ---------------------------------------------------------------- */

const buttonVariants = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/60',
  secondary:
    'bg-white text-neutral-800 ring-1 ring-neutral-300 hover:bg-neutral-100 disabled:text-neutral-400',
  danger:
    'bg-white text-danger-700 ring-1 ring-danger-600/40 hover:bg-danger-50 disabled:text-neutral-400',
  ghost: 'text-neutral-700 hover:bg-neutral-100',
} as const;

type ButtonProps = ComponentProps<'button'> & {
  variant?: keyof typeof buttonVariants;
  loading?: boolean;
  block?: boolean;
};

export function Button({
  variant = 'primary',
  loading = false,
  block,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
        buttonVariants[variant],
        block && 'w-full',
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/* Form fields ------------------------------------------------------------ */

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  /** i18n key or plain text; translated if it is a key. */
  error?: string;
  optional?: boolean;
  children: ReactNode;
}

function FieldShell({ id, label, hint, error, optional, children }: FieldShellProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800">
        {label}
        {optional && (
          <span className="ml-1 font-normal text-neutral-500">({t('common.optional')})</span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-neutral-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger-700">
          {t(error, { defaultValue: error })}
        </p>
      )}
    </div>
  );
}

const inputClass = (invalid: boolean) =>
  cx(
    'block min-h-11 w-full rounded-md border bg-white px-3 text-base text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2',
    invalid
      ? 'border-danger-600 focus:ring-danger-600/30'
      : 'border-neutral-300 focus:border-brand-600 focus:ring-brand-600/30',
  );

type TextFieldProps = ComponentProps<'input'> & {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
};

export function TextField({
  label,
  hint,
  error,
  optional,
  id,
  className,
  ...props
}: TextFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} optional={optional}>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(inputClass(!!error), className)}
        {...props}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = ComponentProps<'textarea'> & {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
};

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  id,
  className,
  ...props
}: TextAreaFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} optional={optional}>
      <textarea
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(inputClass(!!error), 'min-h-32 py-2', className)}
        {...props}
      />
    </FieldShell>
  );
}

export function PasswordField({ label, hint, error, id, ...props }: Omit<TextFieldProps, 'type'>) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={fieldId}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cx(inputClass(!!error), 'pr-12')}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-neutral-500 hover:text-neutral-800"
        >
          {visible ? (
            <EyeOff aria-hidden className="size-5" />
          ) : (
            <Eye aria-hidden className="size-5" />
          )}
        </button>
      </div>
    </FieldShell>
  );
}

type CheckboxFieldProps = ComponentProps<'input'> & { label: ReactNode; error?: string };

export function CheckboxField({ label, error, id, ...props }: CheckboxFieldProps) {
  const { t } = useTranslation();
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-3">
        <input
          id={fieldId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className="mt-0.5 size-5 rounded border-neutral-400 accent-brand-700"
          {...props}
        />
        <label htmlFor={fieldId} className="text-sm text-neutral-800">
          {label}
        </label>
      </div>
      {error && (
        <p id={`${fieldId}-error`} className="text-sm text-danger-700">
          {t(error, { defaultValue: error })}
        </p>
      )}
    </div>
  );
}

/* Feedback --------------------------------------------------------------- */

const alertTones = {
  info: 'bg-info-50 text-info-700 ring-info-600/20',
  success: 'bg-success-50 text-success-700 ring-success-600/20',
  warning: 'bg-warning-50 text-warning-700 ring-warning-600/20',
  danger: 'bg-danger-50 text-danger-700 ring-danger-600/20',
} as const;

export function Alert({
  tone = 'info',
  children,
  action,
}: {
  tone?: keyof typeof alertTones;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx(
        'flex items-start justify-between gap-4 rounded-md px-4 py-3 text-sm ring-1',
        alertTones[tone],
      )}
    >
      <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-neutral-600">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded bg-neutral-200', className)} />;
}

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx('rounded-lg bg-white p-5 shadow-sm ring-1 ring-neutral-200', className)}
      aria-label={title}
    >
      {title && <h2 className="mb-4 text-base font-semibold text-neutral-900">{title}</h2>}
      {children}
    </section>
  );
}

type SelectFieldProps = ComponentProps<'select'> & {
  label: string;
  hint?: string;
  error?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
};

export function SelectField({
  label,
  hint,
  error,
  options,
  id,
  className,
  ...props
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(inputClass(!!error), className)}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** A labelled group of checkboxes sharing one field name (multi-select). */
export function CheckboxGroup({
  legend,
  hint,
  error,
  options,
  inputProps,
  disabled,
}: {
  legend: string;
  hint?: string;
  error?: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Usually `form.register('field')`. */
  inputProps: ComponentProps<'input'>;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <fieldset
      aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      disabled={disabled}
      className="space-y-2"
    >
      <legend className="text-sm font-medium text-neutral-800">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-neutral-600">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
          >
            <input
              type="checkbox"
              value={option.value}
              className="size-4 accent-brand-700"
              {...inputProps}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger-700">
          {t(error, { defaultValue: error })}
        </p>
      )}
    </fieldset>
  );
}

const badgeTones = {
  neutral: 'bg-neutral-100 text-neutral-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
} as const;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}
