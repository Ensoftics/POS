import { useId, useState } from 'react';

export interface TrendPoint {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  valueMinor: number;
  count: number;
}

/**
 * Daily sales as columns: one series, so no legend (the card title names it).
 * Columns are capped at 24px with a 4px rounded top and grow from one baseline;
 * gridlines are hairline and recessive. Each column is focusable and shows its
 * value on hover or focus; a visually hidden table carries the same numbers for
 * screen readers.
 */
export function SalesTrendChart({
  points,
  formatMoney,
  formatDay,
  title,
  countLabel,
}: {
  points: TrendPoint[];
  formatMoney: (minor: number) => string;
  formatDay: (date: string) => string;
  title: string;
  countLabel: (count: number) => string;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const height = 160;
  // At least 100 minor units on the axis, so an empty week still has a sensible scale.
  const max = Math.max(100, ...points.map((p) => p.valueMinor));
  // A clean top tick: the next 1, 2 or 5 × 10^n above the maximum (always a whole amount).
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 5, 10].map((m) => m * magnitude).find((v) => v >= max) ?? max;
  const ticks = [0, Math.round(top / 2), top];

  return (
    <figure aria-labelledby={`${id}-title`} className="space-y-2">
      <figcaption id={`${id}-title`} className="sr-only">
        {title}
      </figcaption>
      <div className="flex gap-2">
        <div
          className="relative w-16 shrink-0 text-right text-[11px] text-neutral-500"
          style={{ height }}
          aria-hidden
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 tabular-nums"
              style={{ top: height - (tick / top) * height }}
            >
              {formatMoney(tick)}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height }}>
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className="absolute inset-x-0 border-t border-neutral-200"
              style={{ top: height - (tick / top) * height }}
            />
          ))}
          <ul className="absolute inset-0 flex items-end justify-around gap-0.5">
            {points.map((point, index) => {
              const barHeight =
                point.valueMinor === 0 ? 0 : Math.max(2, (point.valueMinor / top) * height);
              const label = `${formatDay(point.date)}: ${formatMoney(point.valueMinor)}, ${countLabel(point.count)}`;
              return (
                <li
                  key={point.date}
                  className="relative flex h-full flex-1 items-end justify-center"
                >
                  <button
                    type="button"
                    aria-label={label}
                    onMouseEnter={() => setActive(index)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                    // The hit target is the whole column slot, larger than the bar itself.
                    className="flex h-full w-full items-end justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
                  >
                    <span
                      className={`block w-full max-w-6 rounded-t ${active === index ? 'bg-brand-700' : 'bg-brand-600'}`}
                      style={{ height: barHeight }}
                    />
                  </button>
                  {active === index && (
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded bg-neutral-900 px-2 py-1 text-xs text-white"
                    >
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="ml-[4.5rem] flex justify-around text-[11px] text-neutral-500" aria-hidden>
        {points.map((point) => (
          <span key={point.date} className="flex-1 text-center">
            {formatDay(point.date)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.date}>
              <th scope="row">{formatDay(point.date)}</th>
              <td>{formatMoney(point.valueMinor)}</td>
              <td>{countLabel(point.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
