import { Store } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 bg-brand-800 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2.5 font-semibold text-white">
          <Store aria-hidden className="size-5 text-accent-400" />
          <span>{t('common.appName')}</span>
        </div>
        <LanguageSwitcher onDark />
      </header>
      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:pt-12">
        <div className="w-full max-w-md rounded-xl bg-white p-6 border border-neutral-200 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </main>
    </div>
  );
}
