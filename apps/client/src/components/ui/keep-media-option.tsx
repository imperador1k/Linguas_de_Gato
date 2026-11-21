import { formatBytes, MAX_STORED_MEDIA_BYTES, planMediaRetention, type RetentionPlan, type StorageEstimateLike } from '@ldg/shared';
import { useEffect, useId, useState } from 'react';
import { cn } from '@/lib/utils';

async function readEstimate(): Promise<StorageEstimateLike | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return estimate && estimate.usage !== undefined && estimate.quota !== undefined ? { usage: estimate.usage, quota: estimate.quota } : null;
  } catch {
    return null;
  }
}

/**
 * Whether to keep a copy of some media, and what it should default to. The
 * plan starts from the size alone (so the default is right immediately) and
 * is refined once the browser reports free space. The learner's own choice
 * always wins over the default.
 */
export function useKeepChoice(size: number | null, persistent: boolean, maxBytes = MAX_STORED_MEDIA_BYTES) {
  const [estimate, setEstimate] = useState<StorageEstimateLike | null>(null);
  const [choice, setChoice] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    setChoice(null);
    if (size !== null) void readEstimate().then((value) => active && setEstimate(value));
    return () => {
      active = false;
    };
  }, [size]);

  const plan: RetentionPlan | null = size === null ? null : planMediaRetention({ size, persistent, estimate, maxBytes });
  const keep = plan !== null && plan.allowed && (choice ?? plan.defaultKeep);
  return { plan, keep, setKeep: setChoice };
}

function blockerText(plan: RetentionPlan, size: number, maxBytes: number, what: string): string {
  switch (plan.blocker) {
    case 'storage-full':
      return `Storage limit reached: about ${formatBytes(plan.freeBytes ?? 0)} free, ${formatBytes(size)} needed. Free space in Settings & data to keep ${what}.`;
    case 'too-large':
      return `Over ${formatBytes(maxBytes)}, so ${what} can't be kept in the browser.`;
    case 'not-persistent':
      return "This browser isn't keeping data for this site (private window or blocked storage), so nothing can be kept after a reload.";
    default:
      return 'Nothing to keep.';
  }
}

/**
 * The "keep it in this browser" choice, shown where the media is chosen or
 * recorded. Says what it costs and what happens otherwise; when keeping is
 * impossible it says why (including a full disk) instead of a silent no.
 */
export function KeepMediaOption({
  plan,
  size,
  checked,
  onChange,
  label = 'Keep the audio in this browser',
  what = 'this file',
  forgetsTo = "you'll need to choose the file again after a reload",
  maxBytes = MAX_STORED_MEDIA_BYTES,
  disabled = false,
  className,
}: {
  plan: RetentionPlan;
  size: number;
  checked: boolean;
  onChange: (keep: boolean) => void;
  label?: string;
  what?: string;
  /** What happens without a copy, for the hint. */
  forgetsTo?: string;
  maxBytes?: number;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const hint = !plan.allowed
    ? blockerText(plan, size, maxBytes, what)
    : checked
      ? `Uses ${formatBytes(size)} of browser storage on this device; nothing is uploaded.`
      : plan.defaultKeep
        ? `Without a copy, ${forgetsTo}.`
        : `Large file (${formatBytes(size)}). Tick to keep it; otherwise ${forgetsTo}.`;
  return (
    <div className={cn('flex items-start gap-2.5 rounded-lg border bg-card px-3.5 py-3', !plan.allowed && 'border-dashed', className)}>
      <input
        id={id}
        type="checkbox"
        checked={plan.allowed && checked}
        disabled={disabled || !plan.allowed}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
      />
      <div className="min-w-0 text-sm">
        <label htmlFor={id} className={cn('font-medium', !plan.allowed && 'text-muted-foreground')}>
          {label}
        </label>
        <p id={`${id}-hint`} className={cn('mt-0.5 text-xs leading-relaxed', plan.blocker === 'storage-full' ? 'text-caution' : 'text-muted-foreground')}>
          {hint}
        </p>
      </div>
    </div>
  );
}
