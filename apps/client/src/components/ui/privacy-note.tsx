import { ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

/**
 * The contextual privacy line, shown where data is about to be sent: one
 * sentence about this action, plus a link to the full explanation in
 * Settings → Privacy & AI. Replaces the long, differently worded paragraphs
 * each module used to carry.
 */
export function PrivacyNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex gap-2 text-xs leading-relaxed text-muted-foreground', className)}>
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {children}{' '}
        <Link to="/settings/privacy" className="underline underline-offset-2 hover:text-foreground">
          How your data is handled
        </Link>
      </span>
    </p>
  );
}
