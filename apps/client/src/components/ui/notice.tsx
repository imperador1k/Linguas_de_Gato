import { cva, type VariantProps } from 'class-variance-authority';
import { CircleCheck, CircleX, Info } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const noticeVariants = cva('flex gap-3 rounded-md px-3.5 py-3 text-sm leading-relaxed [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0', {
  variants: {
    tone: {
      info: 'bg-muted text-foreground [&>svg]:text-muted-foreground',
      error: 'bg-destructive-subtle text-foreground [&>svg]:text-destructive',
      success: 'bg-success-subtle text-foreground [&>svg]:text-success',
    },
  },
  defaultVariants: { tone: 'info' },
});

const ICONS = { info: Info, error: CircleX, success: CircleCheck } as const;

export type NoticeProps = ComponentProps<'div'> & VariantProps<typeof noticeVariants>;

/** Inline status message. Tone is conveyed by icon and text, not colour alone. */
export function Notice({ className, tone, children, ...props }: NoticeProps) {
  const Icon = ICONS[tone ?? 'info'];
  return (
    <div className={cn(noticeVariants({ tone }), className)} {...props}>
      <Icon aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
