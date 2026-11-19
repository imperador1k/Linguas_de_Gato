import { formatBytes, type FileSource } from '@ldg/shared';
import { AudioLines, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import type { WorkspaceTools } from '../session/practice-workspace';
import { NoSpeechError, transcriptFromResult } from './transcribed-session';
import { TranscriptionOptionsFields, useTranscriptionPreferences } from './transcription-options';
import { TranscriptionPrivacyNote, TranscriptionStatus } from './transcription-status';
import { isTranscriptionBusy, useTranscriptionJob } from './use-transcription-job';

/**
 * Automatic transcription for an existing file session. The result goes
 * through the workspace's transcript replacement, so dictation history is
 * protected by the same confirmation as an SRT import.
 */
export function SessionTranscriptionCard({
  source,
  media,
  tools,
}: {
  source: FileSource;
  media: Blob | null;
  tools: WorkspaceTools;
}) {
  const capabilities = useCapabilities();
  const [options, setOptions] = useTranscriptionPreferences();
  const [lastCueCount, setLastCueCount] = useState<number | null>(null);
  // With a transcript already in place, the options stay folded away until asked for.
  const [expanded, setExpanded] = useState(false);
  const job = useTranscriptionJob();
  const titleId = useId();
  const busy = isTranscriptionBusy(job.state);

  let blocked: { badge: string; reason: string } | null = null;
  if (capabilities.status === 'loading') blocked = { badge: 'Checking…', reason: 'Checking what the local server supports.' };
  else if (capabilities.status === 'error') blocked = { badge: 'Server offline', reason: "The local server isn't reachable." };
  else if (!capabilities.data.transcription.available) {
    blocked = { badge: 'Needs setup', reason: 'Add GROQ_API_KEY to apps/server/.env and restart the server.' };
  } else if (source.fileSize > capabilities.data.transcription.maxUploadBytes) {
    blocked = {
      badge: 'Too large',
      reason: `This file is ${formatBytes(source.fileSize)}; the transcription limit is ${formatBytes(
        capabilities.data.transcription.maxUploadBytes,
      )}. Shorten or compress it first; automatic splitting is planned.`,
    };
  } else if (!media) {
    blocked = { badge: 'Needs the file', reason: 'Reconnect the recording above to transcribe it.' };
  }

  const showForm = blocked === null && (!tools.hasTranscript || expanded || job.state.phase !== 'idle');

  async function transcribe() {
    if (!media) return;
    setLastCueCount(null);
    const result = await job.start(media, source.fileName, options);
    if (!result) return;
    try {
      const { summary, content } = transcriptFromResult(result, source.fileName, Date.now());
      tools.replaceTranscript({ summary, content });
      setLastCueCount(content.cues.length);
      setExpanded(false);
      job.reset();
    } catch (error) {
      job.fail(error instanceof NoSpeechError ? error.message : 'The transcript could not be used.');
    }
  }

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle id={titleId} className="flex items-center gap-2">
            <AudioLines aria-hidden="true" className="size-4 text-muted-foreground" />
            Automatic transcript
          </CardTitle>
          <Badge variant={blocked ? 'outline' : 'success'}>{blocked ? blocked.badge : 'Available'}</Badge>
        </div>
        <CardDescription className="mt-1" aria-live="polite">
          {blocked
            ? blocked.reason
            : tools.hasTranscript
              ? 'Generate a new transcript with Whisper. It replaces the current one.'
              : 'Generate a timestamped transcript with Whisper, then read along or start dictation.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {lastCueCount !== null ? (
          <Notice tone="success" role="status">
            Transcript ready: {lastCueCount} {lastCueCount === 1 ? 'line' : 'lines'}.
          </Notice>
        ) : null}

        {showForm ? (
          <>
            <TranscriptionOptionsFields value={options} onChange={setOptions} disabled={busy} compact />
            <TranscriptionPrivacyNote />
            <TranscriptionStatus state={job.state} onCancel={job.cancel} onRetry={() => void transcribe()} />
          </>
        ) : null}

        {busy ? null : showForm || blocked ? (
          <Button variant={blocked ? 'secondary' : 'brand'} className="w-full" disabled={blocked !== null} onClick={() => void transcribe()}>
            <Sparkles aria-hidden="true" />
            {tools.hasTranscript ? 'Transcribe again' : 'Transcribe'}
          </Button>
        ) : (
          <Button variant="secondary" className="w-full" aria-expanded={false} onClick={() => setExpanded(true)}>
            <Sparkles aria-hidden="true" />
            Transcribe again…
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
