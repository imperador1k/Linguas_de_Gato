import { formatBytes, type FileSource } from '@ldg/shared';
import { CircleAlert, CircleCheck, HardDrive } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useKeepChoice } from '@/components/ui/keep-media-option';
import { Notice } from '@/components/ui/notice';
import { requestPersistentStorage } from '../storage/listening-storage';
import type { MediaIssue } from '../storage/session-media-cache';
import type { MediaOutcome } from './use-listening-session';

export const ISSUE_TEXT: Record<MediaIssue, string> = {
  quota: 'Storage limit reached: the audio could not be saved in this browser. Free space in Settings & data, then try again.',
  'write-failed': 'The audio could not be saved in this browser.',
  'copy-missing': 'The saved copy of this audio is missing from this browser (it may have been cleared). Choose the file again to restore it.',
};

/**
 * Right under the player: whether this audio will still be here after a
 * reload, and the one action that changes it. Never says "saved" unless the
 * session's stored copy exists (the flag is reconciled on load).
 */
export function MediaCopyBar({
  source,
  media,
  persistent,
  issue,
  onKeep,
  onRemove,
}: {
  source: FileSource;
  media: Blob;
  persistent: boolean;
  issue: MediaIssue | null;
  onKeep: () => Promise<MediaOutcome>;
  onRemove: () => Promise<MediaOutcome>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { plan } = useKeepChoice(source.mediaStored ? null : media.size, persistent);

  async function keep() {
    setBusy(true);
    setError(null);
    // Reduces the chance the browser evicts the copy under storage pressure.
    await requestPersistentStorage();
    const outcome = await onKeep();
    if (!outcome.ok) setError(ISSUE_TEXT[outcome.issue ?? 'write-failed']);
    setBusy(false);
  }

  async function remove() {
    setConfirmRemove(false);
    setBusy(true);
    setError(null);
    const outcome = await onRemove();
    if (!outcome.ok) setError("The saved copy couldn't be removed.");
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {source.mediaStored ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3.5 py-2.5 text-sm">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Audio saved in this browser</span>
            <span className="text-muted-foreground"> · {formatBytes(source.fileSize)} · plays after a reload</span>
          </p>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>
            Remove copy
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-caution/40 bg-caution-subtle px-3.5 py-2.5 text-sm">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-caution" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">Audio not saved</span>
            <span className="text-muted-foreground"> · after a reload you'll need to choose {source.fileName} again</span>
          </p>
          {plan?.allowed ? (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void keep()}>
              <HardDrive aria-hidden="true" />
              {busy ? 'Saving…' : 'Keep a copy'}
            </Button>
          ) : null}
        </div>
      )}
      {!source.mediaStored && plan && !plan.allowed ? (
        <p className="text-xs text-muted-foreground">
          {plan.blocker === 'storage-full'
            ? `Storage limit reached: about ${formatBytes(plan.freeBytes ?? 0)} free, ${formatBytes(media.size)} needed.`
            : plan.blocker === 'too-large'
              ? 'This file is too large to keep in the browser.'
              : "This browser isn't keeping data for this site, so the audio can't be kept."}
        </p>
      ) : null}
      {error ?? (issue && issue !== 'copy-missing' && !source.mediaStored ? ISSUE_TEXT[issue] : null) ? (
        <Notice tone="error" role="alert">
          {error ?? (issue ? ISSUE_TEXT[issue] : '')}
        </Notice>
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove the saved audio?"
        description="The transcript and your progress stay. After a reload you'll need to choose the original file again."
        confirmLabel="Remove copy"
        destructive
        onConfirm={() => void remove()}
        onCancel={() => setConfirmRemove(false)}
      />
    </div>
  );
}
