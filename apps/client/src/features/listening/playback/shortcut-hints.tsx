import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { SKIP_SECONDS } from './playback';

/** Keyboard reference for a listening session. Hidden on small screens, where shortcuts rarely apply. */
export function ShortcutHints({ className, note }: { className?: string; note?: string }) {
  return (
    <div className={cn('hidden text-xs text-muted-foreground md:block', className)}>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Space</Kbd> play / pause
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>J</Kbd>
          <Kbd>L</Kbd> ±{SKIP_SECONDS}s
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>,</Kbd>
          <Kbd>.</Kbd> speed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>M</Kbd> mute
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>R</Kbd> replay line
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>A</Kbd>
          <Kbd>B</Kbd> loop
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Esc</Kbd> clear loop
        </span>
      </p>
      {note ? <p className="mt-2">{note}</p> : null}
    </div>
  );
}
