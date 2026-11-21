import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one empty state: what is missing, in one sentence, and at most one way
 * forward. Never decorative; never claims something that isn't true.
 */
export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-2 rounded-lg border border-dashed px-5 py-6 sm:px-6', className)}>
      {Icon ? (
        <span className="mb-1 inline-flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-[1.125rem]" strokeWidth={1.75} />
        </span>
      ) : null}
      <p className="font-medium">{title}</p>
      {children ? <div className="max-w-prose text-sm leading-relaxed text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
