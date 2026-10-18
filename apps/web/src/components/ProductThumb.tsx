import { Package } from 'lucide-react';
import { useState } from 'react';

const SIZES = { sm: 'size-8', md: 'size-12' } as const;

/**
 * A product's main photo next to its name. Decorative (the name is the label),
 * so it has empty alt text; falls back to an icon when there is no photo or it
 * cannot load (e.g. offline before it was cached).
 */
export function ProductThumb({
  url,
  size = 'md',
}: {
  url: string | null | undefined;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = `${SIZES[size]} shrink-0 rounded-md border border-neutral-200`;
  if (!url || failed === url) {
    return (
      <span
        aria-hidden
        className={`${box} flex items-center justify-center bg-neutral-50 text-neutral-400`}
      >
        <Package className="size-1/2" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(url)}
      className={`${box} bg-white object-cover`}
    />
  );
}
