import { formatBytes, formatSpokenDuration, formatTimestamp } from '@ldg/shared';
import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { TranscriptionJobState } from './use-transcription-job';

function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}

/**
 * Upload progress is real (bytes sent). Processing has no measurable
 * progress, so it shows an indeterminate bar and elapsed time only.
 */
export function TranscriptionStatus({
  state,
  onCancel,
  onRetry,
}: {
  state: TranscriptionJobState;
  onCancel: () => void;
  onRetry?: () => void;
}) {
  const elapsed = useElapsedSeconds(state.phase === 'processing' ? state.startedAt : null);

  if (state.phase === 'uploading' || state.phase === 'processing') {
    const uploading = state.phase === 'uploading';
    const percent = uploading && state.total ? Math.min(100, Math.round((state.loaded / state.total) * 100)) : null;
    return (
      <div className="rounded-md border bg-muted/40 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div role="status" aria-live="polite" className="min-w-0 text-sm">
            {uploading ? (
              <>
                <p className="font-medium">Uploading to the local server…</p>
                <p className="mt-0.5 text-muted-foreground tabular-nums">
                  {state.total ? `${formatBytes(state.loaded)} of ${formatBytes(state.total)} · ${percent}%` : formatBytes(state.loaded)}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Transcribing with Whisper…</p>
                <p className="mt-0.5 text-muted-foreground">
                  <span className="font-mono tabular-nums" aria-hidden="true">
                    {formatTimestamp(elapsed)}
                  </span>
                  <span className="sr-only">{formatSpokenDuration(elapsed)}</span> elapsed · longer recordings take longer
                </p>
              </>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X aria-hidden="true" />
            Cancel
          </Button>
        </div>
        <progress
          className="mt-3 h-1.5 w-full accent-[var(--brand)]"
          aria-label={uploading ? 'Upload progress' : 'Transcription in progress'}
          {...(percent !== null ? { value: percent, max: 100 } : {})}
        />
      </div>
    );
  }

  if (state.phase === 'failed') {
    return (
      <Notice tone="error" role="alert">
        <p>{state.message}</p>
        {onRetry ? (
          <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </Notice>
    );
  }

  if (state.phase === 'cancelled') {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Transcription cancelled. Nothing was saved.
      </p>
    );
  }

  return null;
}

export function TranscriptionPrivacyNote({ className }: { className?: string }) {
  return (
    <p className={className ?? 'text-xs leading-relaxed text-muted-foreground'}>
      Your recording is sent through this app's local server to <span className="font-medium text-foreground">Groq</span> for
      transcription. The server keeps it only in a temporary file that is deleted when the request ends. Groq's own data
      retention is governed by your Groq account settings and policies, not by this app.
    </p>
  );
}
