import type { AcceptedMediaFile, ListeningSession, YouTubeVideoRef } from '@ldg/shared';
import { FileMusic, SquarePlay } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { MediaDropzone } from './media-dropzone';
import { RecentSessions } from './session/recent-sessions';
import { SourceTabs } from './source-tabs';
import {
  describeStorageError,
  newFileSession,
  newYouTubeSession,
  useListeningStorage,
} from './storage/listening-storage';
import { rememberSessionMedia } from './storage/session-media-cache';
import { TranscriptionCard } from './transcription-card';
import { YouTubeSourceForm } from './youtube-source';

type SourceTabValue = 'file' | 'youtube';

function RightsNote() {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Only import media you own or are authorised to use. YouTube videos are played through YouTube's official player and
      are never downloaded.
    </p>
  );
}

export function ListeningPage() {
  const [tab, setTab] = useState<SourceTabValue>('file');
  const [error, setError] = useState<string | null>(null);
  const storage = useListeningStorage();
  const navigate = useNavigate();

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
    <>
      <PageHeader
        eyebrow="Listening"
        title="Listen closely, line by line."
        description="Bring in a recording you own or a YouTube lesson. Add its transcript to follow along, loop hard passages, and test yourself with dictation."
      />

      {storage?.fallbackReason ? (
        <Notice className="mb-6">{storage.fallbackReason.message} Sessions will last until you close this tab.</Notice>
      ) : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card aria-labelledby="source-title" className="min-w-0">
          <CardHeader>
            <CardTitle id="source-title">Start a session</CardTitle>
            <CardDescription>Your transcript, loop points and dictation progress are saved in this browser.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <SourceTabs
              label="Media source"
              value={tab}
              onChange={setTab}
              tabs={[
                {
                  value: 'file',
                  label: 'Audio or video file',
                  icon: FileMusic,
                  content: (
                    <MediaDropzone
                      onAccept={(file: File, accepted: AcceptedMediaFile) => void start(newFileSession(file, accepted), file)}
                    />
                  ),
                },
                {
                  value: 'youtube',
                  label: 'YouTube',
                  icon: SquarePlay,
                  content: (
                    <div className="flex flex-col gap-6">
                      <YouTubeSourceForm onLoad={(video: YouTubeVideoRef) => void start(newYouTubeSession(video))} />
                      <div
                        aria-hidden="true"
                        className="flex aspect-video items-center justify-center rounded-lg border border-dashed bg-muted/40"
                      >
                        <SquarePlay className="size-8 text-muted-foreground/60" strokeWidth={1.25} />
                      </div>
                    </div>
                  ),
                },
              ]}
            />
            <div className="mt-6 border-t pt-4">
              <RightsNote />
            </div>
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          {storage ? <RecentSessions storage={storage} /> : null}
          <Card>
            <CardHeader>
              <CardTitle>How to practise</CardTitle>
            </CardHeader>
            <CardContent className="pt-3">
              <ol className="flex flex-col gap-3 text-sm leading-relaxed text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground">1. Listen once</span> without the transcript, for gist.
                </li>
                <li>
                  <span className="font-medium text-foreground">2. Loop</span> difficult passages at 0.75× with A-B or
                  "Loop line".
                </li>
                <li>
                  <span className="font-medium text-foreground">3. Dictate</span> a line at a time, then study the
                  differences.
                </li>
                <li>
                  <span className="font-medium text-foreground">4. Listen again</span> at full speed without reading.
                </li>
              </ol>
            </CardContent>
          </Card>
          <TranscriptionCard sourceKind={tab} />
        </div>
      </div>
    </>
  );
}
