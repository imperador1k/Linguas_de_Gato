import { cn } from '@/lib/utils';

/** Wordmark: a stylised "língua de gato" biscuit beside the name. `compact` shows the biscuit alone (tablet rail). */
export function BrandMark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="size-7 shrink-0">
        <rect width="32" height="32" rx="8" className="fill-foreground" />
        <rect x="7" y="12.5" width="18" height="7" rx="3.5" transform="rotate(-24 16 16)" className="fill-brand" />
      </svg>
      {compact ? null : (
        <span className="font-serif text-[1.1875rem] leading-none tracking-tight">
          <span className="italic">Linguas</span> de Gato
        </span>
      )}
    </span>
  );
}
