import type { AcceptedMediaFile, ListeningSession, YouTubeVideoRef } from '@ldg/shared';
import { FileMusic, Plus, Sparkles, SquarePlay } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { HelpDisclosure } from '@/components/ui/help-disclosure';
import { Notice } from '@/components/ui/notice';
import { SidePanel } from '@/components/ui/side-panel';
import { useCapabilities } from '@/hooks/use-capabilities';
import { MediaDropzone } from './media-dropzone';
import { SessionLibrary } from './session/session-library';
import { SourceTabs } from './source-tabs';
import { describeStorageError, newFileSession, newYouTubeSession, useListeningStorage, type ListeningStorage } from './storage/listening-storage';
import { rememberSessionMedia } from './storage/session-media-cache';
import { TranscribeNewSession } from './transcription/transcribe-new-session';
import { YouTubeSourceForm } from './youtube-source';

type SourceTabValue = 'transcribe' | 'file' | 'youtube';

function RightsNote() {
  return <p className="text-xs leading-relaxed text-muted-foreground">Only import media you own or are authorised to use. YouTube videos are played through YouTube's official player and are never downloaded or transcribed.</p>;
}

/** "New session": the three ways to bring in media, kept apart from browsing saved sessions. */
function NewSessionPanel({ open, storage, onClose }: { open: boolean; storage: ListeningStorage | null; onClose: () => void }) {
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [chosenTab, setChosenTab] = useState<SourceTabValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [work, setWork] = useState({ dirty: false, busy: false });
  const onTranscribeDirty = useCallback((dirty: boolean, busy: boolean) => setWork({ dirty, busy }), []);

  // Lead with transcription unless it is unavailable. While capabilities load, that tab only shows
  // "Checking…", so falling back to File never moves a drop target from under the learner.
  const transcriptionUnavailable = capabilities.status === 'error' || (capabilities.status === 'ready' && !capabilities.data.transcription.available);
  const tab: SourceTabValue = chosenTab ?? (transcriptionUnavailable ? 'file' : 'transcribe');

  async function start(session: ListeningSession, media?: File) {
    if (!storage) return;
    try {
      await storage.repository.createSession(session);
    } catch (createError) {
      setError(describeStorageError(createError));
      return;
    }
    if (media) rememberSessionMedia(session.id, media);
    navigate(`/listening/session/${session.id}`);
  }

  return (
    <SidePanel open={open} onClose={onClose} dirty={work.dirty} busy={work.busy} title="New session" description="Your transcript, loop points and dictation progress are saved in this browser.">
      {open ? (
        <div className="flex flex-col gap-5">
          {error ? (
            <Notice tone="error" role="alert">
              {error}
            </Notice>
          ) : null}
          <SourceTabs
            label="Media source"
            value={tab}
            onChange={setChosenTab}
            tabs={[
              { value: 'transcribe', label: 'Transcribe', icon: Sparkles, content: <TranscribeNewSession storage={storage} onDirtyChange={onTranscribeDirty} /> },
              {
                value: 'file',
                label: 'File',
                icon: FileMusic,
                content: (
                  <div className="flex flex-col gap-3">
                    <MediaDropzone onAccept={(file: File, accepted: AcceptedMediaFile) => void start(newFileSession(file, accepted), file)} />
                    <p className="text-xs leading-relaxed text-muted-foreground">Opens the recording without transcribing it. Add SRT or WebVTT subtitles in the session, or transcribe it there later.</p>
                  </div>
                ),
              },
              { value: 'youtube', label: 'YouTube', icon: SquarePlay, content: <YouTubeSourceForm onLoad={(video: YouTubeVideoRef) => void start(newYouTubeSession(video))} /> },
            ]}
          />
          <div className="border-t pt-4">
            <RightsNote />
          </div>
        </div>
      ) : null}
    </SidePanel>
  );
}

/**
 * The Listening hub: the session to continue and the library of saved
 * sessions (each with direct links to dictation and questions). Bringing in
 * new media happens in the "New session" panel.
 */
export function ListeningPage() {
  const storage = useListeningStorage();
  const [panel, setPanel] = useState({ open: false, key: 0 });
  const openPanel = () => setPanel((current) => ({ open: true, key: current.key + 1 }));

  return (
    <>
      <PageHeader
        eyebrow="Listening"
        title="Listen closely, line by line."
        description="Bring in a recording you own or a YouTube lesson. Transcribe it or add its subtitles, loop hard passages, and test yourself with dictation."
        actions={
          <Button onClick={openPanel}>
            <Plus aria-hidden="true" />
            New session
          </Button>
        }
      />

      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Sessions will last until you close this tab.</Notice> : null}

      {storage ? (
        <SessionLibrary storage={storage} onNewSession={openPanel} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          Opening your sessions…
        </p>
      )}

      <HelpDisclosure id="listening" title="How to practise" className="mt-10">
        <ol className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">1. Listen once</span> without the transcript, for gist.
          </li>
          <li>
            <span className="font-medium text-foreground">2. Loop</span> difficult passages at 0.75× with A-B or "Loop line".
          </li>
          <li>
            <span className="font-medium text-foreground">3. Dictate</span> a line at a time, then study the differences.
          </li>
          <li>
            <span className="font-medium text-foreground">4. Answer questions</span> on the recording, then listen again at full speed without reading.
          </li>
        </ol>
      </HelpDisclosure>

      <NewSessionPanel key={panel.key} open={panel.open} storage={storage} onClose={() => setPanel((current) => ({ ...current, open: false }))} />
    </>
  );
}
