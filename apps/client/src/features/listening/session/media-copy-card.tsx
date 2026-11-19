import { formatBytes, type FileSource } from '@ldg/shared';
import { HardDrive } from 'lucide-react';
import { useId, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { estimateStorage, requestPersistentStorage } from '../storage/listening-storage';

/**
 * Copies of large media would duplicate files the learner already has and eat
 * into the browser quota, so they are opt-in and capped.
 */
export const MAX_STORED_MEDIA_BYTES = 500 * 1024 ** 2;
/** Headroom so a copy never takes the last bytes needed for transcripts and progress. */
const QUOTA_HEADROOM_BYTES = 50 * 1024 ** 2;

export function MediaCopyCard({
  source,
  media,
  persistent,
  onChange,
}: {
  source: FileSource;
  media: Blob | null;
  persistent: boolean;
  onChange: (enabled: boolean) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  // Reflect the click immediately while the (possibly large) write runs.
  const [pending, setPending] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const checkboxId = useId();
  const descriptionId = useId();

  const tooLarge = source.fileSize > MAX_STORED_MEDIA_BYTES;
  const disabledReason = !persistent
    ? 'Browser storage is unavailable, so nothing can be kept after a reload.'
    : tooLarge
      ? `Files over ${formatBytes(MAX_STORED_MEDIA_BYTES)} can't be kept; reconnect the file instead.`
      : !source.mediaStored && !media
        ? 'Reconnect the file first.'
        : null;

  async function toggle(enabled: boolean) {
    setError(null);
    setBusy(true);
    setPending(enabled);
    try {
      if (enabled) {
        const estimate = await estimateStorage();
        if (estimate && estimate.quota - estimate.usage < source.fileSize + QUOTA_HEADROOM_BYTES) {
          setError(
            `Not enough browser storage: about ${formatBytes(Math.max(0, estimate.quota - estimate.usage))} free, ${formatBytes(source.fileSize)} needed.`,
          );
          return;
        }
        // Reduces the chance the browser evicts the copy under storage pressure.
        await requestPersistentStorage();
      }
      if (!(await onChange(enabled))) {
        setError(enabled ? "The copy couldn't be saved." : "The copy couldn't be removed.");
      }
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2">
          <HardDrive aria-hidden="true" className="size-4 text-muted-foreground" />
          Offline copy
        </CardTitle>
        <CardDescription id={descriptionId}>
          {source.mediaStored
            ? `A ${formatBytes(source.fileSize)} copy is kept in this browser, so the session reopens without asking for the file.`
            : 'Transcripts and progress are always saved. Keep a copy of the file too, so it reopens without asking for it after a reload.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <input
            id={checkboxId}
            type="checkbox"
            checked={pending ?? source.mediaStored}
            disabled={busy || (disabledReason !== null && !source.mediaStored)}
            aria-busy={busy || undefined}
            aria-describedby={descriptionId}
            onChange={(event) => void toggle(event.target.checked)}
            className="size-4 accent-[var(--brand)]"
          />
          <label htmlFor={checkboxId} className="text-sm">
            Keep a copy in this browser
          </label>
        </div>
        {disabledReason && !source.mediaStored ? <p className="text-xs text-muted-foreground">{disabledReason}</p> : null}
        {error ? (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        ) : null}
      </CardContent>
    </Card>
  );
}
