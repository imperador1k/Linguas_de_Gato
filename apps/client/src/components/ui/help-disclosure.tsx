import { ChevronDown, CircleHelp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const STORAGE_PREFIX = 'ldg.help.';

function readOpen(id: string): boolean {
  try {
    // Open until the learner closes it once; after that it stays out of the way.
    return localStorage.getItem(STORAGE_PREFIX + id) !== 'closed';
  } catch {
    return true;
  }
}

/**
 * "How it works" and similar explanations: useful on the first visit, noise
 * every day after. Collapsible, keyboard-operable (native <details>), and the
 * open/closed choice is remembered per explanation on this device.
 */
export function HelpDisclosure({ id, title = 'How it works', children, className }: { id: string; title?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(() => readOpen(id));
  return (
    <details
      open={open}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        try {
          localStorage.setItem(STORAGE_PREFIX + id, next ? 'open' : 'closed');
        } catch {
          // Not remembered; harmless.
        }
      }}
      className={cn('group rounded-lg border bg-card', className)}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <CircleHelp aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="flex-1">{title}</span>
        <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t px-4 py-4 text-sm leading-relaxed">{children}</div>
    </details>
  );
}
