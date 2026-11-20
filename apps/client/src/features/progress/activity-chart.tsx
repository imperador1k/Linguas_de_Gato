import { LEARNING_MODULES, type LearningModule } from '@ldg/shared';
import { useId, useState } from 'react';
import { MODULE_LABELS, formatShortDate } from './format';

export interface ActivityBucket {
  readonly key: string;
  readonly start: number;
  readonly counts: Record<LearningModule, number>;
  readonly total: number;
}

const HEIGHT = 120;

/**
 * A single-series bar chart of practice actions per day (or week). One
 * colour, no legend (the heading names it); hovering or focusing a bar
 * shows its exact value and module breakdown, and a table view is always
 * available. Empty buckets stay visible so gaps are honest.
 */
export function ActivityChart({ buckets, weekly }: { buckets: readonly ActivityBucket[]; weekly: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const peak = Math.max(0, ...buckets.map((bucket) => bucket.total));
  const max = Math.max(1, peak);
  const width = 100 / Math.max(1, buckets.length);
  const describe = (bucket: ActivityBucket) => {
    const parts = LEARNING_MODULES.filter((module) => bucket.counts[module] > 0).map((module) => `${MODULE_LABELS[module]} ${bucket.counts[module]}`);
    return `${weekly ? 'Week of ' : ''}${formatShortDate(bucket.start)}: ${bucket.total} action${bucket.total === 1 ? '' : 's'}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
  };
  const shown = active !== null ? buckets[active] : null;
  const first = buckets[0];
  const last = buckets.at(-1);

  return (
    <figure className="flex flex-col gap-2">
      <p id={`${id}-readout`} aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
        {shown ? describe(shown) : `Hover or focus a bar for details. Busiest ${weekly ? 'week' : 'day'}: ${peak} action${peak === 1 ? '' : 's'}.`}
      </p>
      <div className="relative" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
        <div aria-hidden="true" className="absolute inset-x-0 bottom-0 border-b border-border-strong" />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
        <ul className="absolute inset-0 flex items-end" aria-label={`Practice actions per ${weekly ? 'week' : 'day'}`}>
          {buckets.map((bucket, index) => (
            <li key={bucket.key} className="flex h-full items-end justify-center" style={{ width: `${width}%` }}>
              <button
                type="button"
                className="group flex h-full w-full items-end justify-center px-px focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={describe(bucket)}
                onMouseEnter={() => setActive(index)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <span
                  className={`block w-full max-w-6 rounded-t-[4px] ${bucket.total === 0 ? 'bg-transparent' : active === index ? 'bg-foreground' : 'bg-brand'}`}
                  style={{ height: bucket.total === 0 ? 0 : `${Math.max(4, (bucket.total / max) * HEIGHT)}px` }}
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div aria-hidden="true" className="flex justify-between text-xs text-muted-foreground">
        <span>{first ? formatShortDate(first.start) : ''}</span>
        <span>{last ? formatShortDate(last.start) : ''}</span>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  {weekly ? 'Week of' : 'Day'}
                </th>
                {LEARNING_MODULES.map((module) => (
                  <th key={module} scope="col" className="py-1 pr-3 font-medium">
                    {MODULE_LABELS[module]}
                  </th>
                ))}
                <th scope="col" className="py-1 font-medium">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {buckets.map((bucket) => (
                <tr key={bucket.key} className="border-t">
                  <th scope="row" className="py-1 pr-3 font-normal">
                    {formatShortDate(bucket.start)}
                  </th>
                  {LEARNING_MODULES.map((module) => (
                    <td key={module} className="py-1 pr-3">
                      {bucket.counts[module]}
                    </td>
                  ))}
                  <td className="py-1">{bucket.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A tiny weekly error sparkline for one category (decorative: the numbers are stated next to it). */
export function Sparkline({ values, label }: { values: readonly number[]; label: string }) {
  const max = Math.max(1, ...values);
  return (
    <span role="img" aria-label={label} className="inline-flex h-6 items-end gap-[2px]">
      {values.map((value, index) => (
        <span key={index} className={`w-1.5 rounded-t-[2px] ${value === 0 ? 'bg-border' : 'bg-brand'}`} style={{ height: value === 0 ? 2 : `${Math.max(4, (value / max) * 24)}px` }} />
      ))}
    </span>
  );
}
