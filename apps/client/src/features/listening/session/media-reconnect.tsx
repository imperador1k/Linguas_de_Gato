import { formatBytes, type FileSource } from '@ldg/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeepMediaOption, useKeepChoice } from '@/components/ui/keep-media-option';
import { Notice } from '@/components/ui/notice';
import { MediaDropzone } from '../media-dropzone';
import type { MediaIssue } from '../storage/session-media-cache';
import { ISSUE_TEXT } from './media-copy-bar';
import type { MediaOutcome } from './use-listening-session';

/**
 * Shown when a file session has no playable media: the copy was never kept,
 * or it is missing. The transcript and progress are intact. Choosing the file
 * again can also keep a copy, so this is the last time it is asked for.
 */
export function MediaReconnect({
  source,
  persistent,
  issue,
  onAttach,
}: {
  source: FileSource;
  persistent: boolean;
  issue: MediaIssue | null;
  onAttach: (file: File, keep: boolean) => Promise<MediaOutcome>;
}) {
  const [mismatch, setMismatch] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keepChoice = useKeepChoice(source.fileSize, persistent);

  async function attach(file: File) {
    setMismatch(null);
    setError(null);
    const outcome = await onAttach(file, keepChoice.keep);
    // The file still plays this visit; only the copy failed.
    if (!outcome.ok) setError(ISSUE_TEXT[outcome.issue ?? 'write-failed']);
  }

  function accept(file: File) {
    // Name and size identify the original; the modification time is a hint but changes when files are copied.
    if (file.name === source.fileName && file.size === source.fileSize) void attach(file);
    else setMismatch(file);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reconnect the recording</CardTitle>
        <CardDescription>
          {issue === 'copy-missing' ? ISSUE_TEXT['copy-missing'] : 'Your transcript and progress are saved, but this audio was not kept in the browser.'} Choose{' '}
          <span className="font-medium text-foreground">{source.fileName}</span> ({formatBytes(source.fileSize)}) to keep practising.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mismatch ? (
          <Notice tone="error" role="alert">
            <p>
              <span className="font-medium">{mismatch.name}</span> ({formatBytes(mismatch.size)}) doesn't match the original file. Timings may not line up with the transcript.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void attach(mismatch)}>
                Use it anyway
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMismatch(null)}>
                Choose another file
              </Button>
            </div>
          </Notice>
        ) : (
          // Sessions can hold any transcribable format (a superset of the playable ones).
          <MediaDropzone onAccept={accept} prompt="Drop the original file here" purpose="transcription" />
        )}
        {keepChoice.plan ? (
          <KeepMediaOption plan={keepChoice.plan} size={source.fileSize} checked={keepChoice.keep} onChange={keepChoice.setKeep} label="Keep a copy this time" forgetsTo="you'll be asked for the file again after a reload" />
        ) : null}
        {error ? (
          <Notice tone="error" role="alert">
            {error}
          </Notice>
        ) : null}
      </CardContent>
    </Card>
  );
}
