import { formatBytes, type AcceptedMediaFile } from '@ldg/shared';
import { FileAudio, FileVideo } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { KeepMediaOption, useKeepChoice } from '@/components/ui/keep-media-option';
import { Notice } from '@/components/ui/notice';
import { MediaDropzone } from './media-dropzone';
import { describeStorageError, newFileSession, type ListeningStorage } from './storage/listening-storage';
import { createSessionWithMedia } from './storage/session-media';

/**
 * The File tab: choose a recording, decide whether to keep a copy (on by
 * default for reasonably sized files), then open it. No transcription; the
 * session page offers subtitles or transcription afterwards.
 */
export function OpenFileSession({ storage, onDirtyChange }: { storage: ListeningStorage | null; onDirtyChange?: (dirty: boolean) => void }) {
  const navigate = useNavigate();
  const [selection, setSelection] = useState<{ file: File; accepted: AcceptedMediaFile } | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepChoice = useKeepChoice(selection?.file.size ?? null, storage?.repository.persistent ?? true);

  useEffect(() => onDirtyChange?.(selection !== null), [selection, onDirtyChange]);

  async function open() {
    if (!storage || !selection) return;
    setOpening(true);
    setError(null);
    try {
      const { session } = await createSessionWithMedia(storage.repository, newFileSession(selection.file, selection.accepted), { media: selection.file, keep: keepChoice.keep });
      onDirtyChange?.(false);
      navigate(`/listening/session/${session.id}`);
    } catch (caught) {
      setError(describeStorageError(caught));
      setOpening(false);
    }
  }

  if (!selection) {
    return (
      <div className="flex flex-col gap-3">
        <MediaDropzone onAccept={(file, accepted) => setSelection({ file, accepted })} />
        <p className="text-xs leading-relaxed text-muted-foreground">Opens the recording without transcribing it. Add SRT or WebVTT subtitles in the session, or transcribe it there later.</p>
      </div>
    );
  }

  const { file, accepted } = selection;
  const Icon = accepted.kind === 'video' ? FileVideo : FileAudio;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4 rounded-lg border px-4 py-3.5">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {accepted.format.label} · {formatBytes(file.size)}
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={opening} onClick={() => setSelection(null)}>
          Change
        </Button>
      </div>
      {keepChoice.plan ? <KeepMediaOption plan={keepChoice.plan} size={file.size} checked={keepChoice.keep} onChange={keepChoice.setKeep} disabled={opening} /> : null}
      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <div>
        <Button size="lg" disabled={!storage || opening} onClick={() => void open()}>
          {opening ? 'Opening…' : 'Open session'}
        </Button>
      </div>
    </div>
  );
}
