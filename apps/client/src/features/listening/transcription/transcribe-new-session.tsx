import { formatBytes, formatTimestamp, type AcceptedMediaFile } from '@ldg/shared';
import { AudioLines, FileAudio, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import { MediaDropzone } from '../media-dropzone';
import { describeStorageError, type ListeningStorage } from '../storage/listening-storage';
import { rememberSessionMedia } from '../storage/session-media-cache';
import { NoSpeechError, createTranscribedSession } from './transcribed-session';
import { TranscriptionOptionsFields, useTranscriptionPreferences } from './transcription-options';
import { TranscriptionPrivacyNote, TranscriptionStatus } from './transcription-status';
import { isTranscriptionBusy, useTranscriptionJob } from './use-transcription-job';

/** Reads the duration from the file's metadata in the browser; null if it can't be read. */
function useMediaDuration(file: File | null): number | null {
  const [duration, setDuration] = useState<number | null>(null);
  useEffect(() => {
    setDuration(null);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const probe = document.createElement('audio');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => setDuration(Number.isFinite(probe.duration) ? probe.duration : null);
    probe.src = url;
    return () => {
      probe.removeAttribute('src');
      probe.load();
      URL.revokeObjectURL(url);
    };
  }, [file]);
  return duration;
}

function Unavailable({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AudioLines aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <div className="max-w-sm text-sm leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

/**
 * Upload → transcribe → a new persistent session with the transcript, opened
 * straight away so the learner can read along or start dictation.
 */
export function TranscribeNewSession({ storage, onDirtyChange }: { storage: ListeningStorage | null; onDirtyChange?: (dirty: boolean, busy: boolean) => void }) {
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [selection, setSelection] = useState<{ file: File; accepted: AcceptedMediaFile } | null>(null);
  const [options, setOptions] = useTranscriptionPreferences();
  const job = useTranscriptionJob();
  const duration = useMediaDuration(selection?.file ?? null);
  const busy = isTranscriptionBusy(job.state);
  // A chosen file or a running upload is work the creation panel must not drop silently.
  useEffect(() => onDirtyChange?.(busy || selection !== null, busy), [busy, selection, onDirtyChange]);

  if (capabilities.status === 'loading') {
    return (
      <p role="status" className="py-12 text-center text-sm text-muted-foreground">
        Checking what the local server supports…
      </p>
    );
  }
  if (capabilities.status === 'error') {
    return (
      <Unavailable>
        <p>The local server isn't reachable, so automatic transcription can't run.</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={capabilities.retry}>
          Check again
        </Button>
      </Unavailable>
    );
  }
  const { transcription } = capabilities.data;
  if (!transcription.available) {
    return (
      <Unavailable>
        <p>
          Automatic transcription needs a Groq API key. Add <code className="font-mono text-xs text-foreground">GROQ_API_KEY</code> to{' '}
          <code className="font-mono text-xs text-foreground">apps/server/.env</code> and restart the server.
        </p>
        <p className="mt-2">You can still import SRT or WebVTT subtitles in the other tab.</p>
      </Unavailable>
    );
  }

  async function transcribe() {
    if (!selection || !storage) return;
    const result = await job.start(selection.file, selection.file.name, options);
    if (!result) return;
    try {
      const session = await createTranscribedSession(storage.repository, selection.file, selection.accepted, result);
      rememberSessionMedia(session.id, selection.file);
      navigate(`/listening/session/${session.id}?transcribed=1`);
    } catch (error) {
      job.fail(error instanceof NoSpeechError ? error.message : `The transcript couldn't be saved. ${describeStorageError(error)}`);
    }
  }

  if (!selection) {
    return (
      <div className="flex flex-col gap-4">
        <MediaDropzone
          purpose="transcription"
          maxBytes={transcription.maxUploadBytes}
          prompt="Drag a recording to transcribe"
          note="sent to Groq only when you click Transcribe"
          onAccept={(file, accepted) => {
            job.reset();
            setSelection({ file, accepted });
          }}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Longer recordings must be shortened or compressed below {formatBytes(transcription.maxUploadBytes)} for now; automatic
          splitting of long audio is planned.
        </p>
      </div>
    );
  }

  const { file, accepted } = selection;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4 rounded-lg border px-4 py-3.5">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-md bg-muted">
          <FileAudio aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {accepted.format.label} · {formatBytes(file.size)}
            {duration !== null ? ` · ${formatTimestamp(duration)}` : ''}
          </p>
        </div>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelection(null)}>
          Change
        </Button>
      </div>

      {!accepted.format.playable ? (
        <Notice>
          {accepted.format.label} files usually can't be played in the browser. The transcript will be created, but playback,
          replay and dictation audio may not work. Converting to MP3 or MP4 first is recommended.
        </Notice>
      ) : null}

      <TranscriptionOptionsFields value={options} onChange={setOptions} disabled={busy} />

      <TranscriptionPrivacyNote />

      {job.state.phase === 'uploading' || job.state.phase === 'processing' || job.state.phase === 'failed' || job.state.phase === 'cancelled' ? (
        <TranscriptionStatus state={job.state} onCancel={job.cancel} onRetry={() => void transcribe()} />
      ) : null}

      {!busy ? (
        <div>
          <Button variant="brand" size="lg" disabled={!storage} onClick={() => void transcribe()}>
            <Sparkles aria-hidden="true" />
            Transcribe
          </Button>
        </div>
      ) : null}
    </div>
  );
}
