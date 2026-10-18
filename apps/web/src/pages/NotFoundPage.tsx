import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-2xl font-semibold text-neutral-900">{t('notFound.title')}</h1>
      <p className="mt-2 text-neutral-600">{t('notFound.body')}</p>
      <Link to="/" className="mt-6 inline-block font-medium text-brand-700 hover:underline">
        {t('notFound.home')}
      </Link>
    </div>
  );
}
