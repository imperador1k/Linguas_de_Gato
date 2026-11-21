import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { buttonVariants } from './button';

/**
 * A hub's "continue where you left off": the single most relevant unfinished
 * item, shown above the library so returning to work is one click. Rendered
 * only when such an item really exists.
 */
export function ContinueCard({ title, detail, to, action = 'Continue', secondary }: { title: string; detail: ReactNode; to: string; action?: string; secondary?: ReactNode }) {
  return (
    <section aria-label="Continue where you left off" className="mb-8 flex flex-col gap-3 rounded-lg border bg-card px-4 py-4 sm:flex-row sm:items-center sm:gap-5 sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Continue where you left off</p>
        <p className="mt-1.5 font-serif text-[1.1875rem] leading-snug break-words">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {secondary}
        <Link to={to} className={buttonVariants()}>
          {action}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
