import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/** Where "back" goes from a detail page: always the parent area, named as in the navigation. */
export interface BackTarget {
  readonly to: string;
  readonly label: string;
}

/**
 * The one back pattern: a quiet text link above the title, where reading
 * starts, labelled with the parent's navigation name ("← Speaking").
 */
export function BackLink({ to, label, className }: BackTarget & { className?: string }) {
  return (
    <Link
      to={to}
      className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-md pr-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground sm:min-h-9', className)}
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      <span>
        <span className="sr-only">Back to </span>
        {label}
      </span>
    </Link>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Detail pages: the parent area. Rendered above the eyebrow. */
  back?: BackTarget;
  className?: string;
}) {
  return (
    <header className={cn('mb-10 flex flex-col gap-6 sm:mb-12 md:flex-row md:items-end md:justify-between', className)}>
      <div className="max-w-2xl min-w-0">
        {back ? <BackLink {...back} className="-mt-2 mb-3" /> : null}
        {eyebrow ? <p className="mb-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{eyebrow}</p> : null}
        <h1 className="font-serif text-[2.125rem] leading-[1.1] font-normal tracking-[-0.015em] sm:text-[2.75rem]">{title}</h1>
        {description ? <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

/** Small uppercase label that introduces a group of content on a page. */
export function SectionHeading({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={cn('mb-4 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase', className)}>
      {children}
    </h2>
  );
}
