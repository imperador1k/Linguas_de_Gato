import { Search } from 'lucide-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export const FILTER_CONTROL =
  'h-10 rounded-md border border-input bg-card px-3 text-sm hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none';

/** Search and filters only help once a list is long enough to need them. */
export const SEARCH_THRESHOLD = 4;

/** "7 sets", "1 set", "3 of 7 sets". */
export function resultCount(visible: number, total: number, singular: string, plural = `${singular}s`): string {
  const noun = total === 1 ? singular : plural;
  return visible === total ? `${total} ${noun}` : `${visible} of ${total} ${noun}`;
}

/** A labelled search box for hub lists (the label is visually hidden; the placeholder is not the label). */
export function SearchField({ label, value, onChange, placeholder, className }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cn('relative min-w-0', className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <input id={id} type="search" value={value} placeholder={placeholder ?? label} onChange={(event) => onChange(event.target.value)} className={cn(FILTER_CONTROL, 'w-full pl-9')} />
    </div>
  );
}
