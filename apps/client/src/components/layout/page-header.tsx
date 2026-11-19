import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-10 flex flex-col gap-6 sm:mb-12 md:flex-row md:items-end md:justify-between', className)}>
      <div className="max-w-2xl">
        {eyebrow ? (
          <p className="mb-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="font-serif text-[2.125rem] leading-[1.1] font-normal tracking-[-0.015em] sm:text-[2.75rem]">{title}</h1>
        {description ? (
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({ children, id, className }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={cn('mb-4 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase', className)}>
      {children}
    </h2>
  );
}
