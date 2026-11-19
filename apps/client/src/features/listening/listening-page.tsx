import type { AcceptedMediaFile, YouTubeVideoRef } from '@ldg/shared';
import { FileMusic, Replace, SquarePlay } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { LocalMediaSession } from './local-media-session';
import { MediaDropzone } from './media-dropzone';
import { SourceTabs } from './source-tabs';
import { TranscriptionCard } from './transcription-card';
import { YouTubePlayer, YouTubeSourceForm } from './youtube-source';

type SourceTabValue = 'file' | 'youtube';

type ListeningSource =
  | { readonly kind: 'file'; readonly file: File; readonly accepted: AcceptedMediaFile }
  | { readonly kind: 'youtube'; readonly video: YouTubeVideoRef };

function RightsNote() {
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      Only import media you own or are authorised to use. YouTube videos are played through YouTube's official player and
      are never downloaded.
    </p>
  );
}

function YouTubeSession({ video }: { video: YouTubeVideoRef }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0">
        <YouTubePlayer video={video} />
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
            <CardDescription>Synchronised subtitles for YouTube playback are planned for milestone M1.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Notice>
              To practise with a transcript today, use an audio or video file you own and import its SRT or WebVTT
              subtitles.
            </Notice>
          </CardContent>
        </Card>
        <TranscriptionCard sourceKind="youtube" />
      </div>
    </div>
  );
}

export function ListeningPage() {
  const [tab, setTab] = useState<SourceTabValue>('file');
  const [source, setSource] = useState<ListeningSource | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Listening"
        title="Listen closely, line by line."
        description="Bring in a recording you own or a YouTube lesson. Add its transcript to follow along, slow it down, and replay any line."
        actions={
          source ? (
            <Button variant="secondary" onClick={() => setSource(null)}>
              <Replace aria-hidden="true" />
              Change source
            </Button>
          ) : undefined
        }
      />

      {source?.kind === 'file' ? (
        <LocalMediaSession key={`${source.file.name}-${source.file.lastModified}`} file={source.file} accepted={source.accepted} />
      ) : source?.kind === 'youtube' ? (
        <YouTubeSession video={source.video} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card aria-labelledby="source-title" className="min-w-0">
            <CardHeader>
              <CardTitle id="source-title">Choose a source</CardTitle>
              <CardDescription>Local files support transcripts and, later, automatic transcription.</CardDescription>
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
                    content: <MediaDropzone onAccept={(file, accepted) => setSource({ kind: 'file', file, accepted })} />,
                  },
                  {
                    value: 'youtube',
                    label: 'YouTube',
                    icon: SquarePlay,
                    content: (
                      <div className="flex flex-col gap-6">
                        <YouTubeSourceForm onLoad={(video) => setSource({ kind: 'youtube', video })} />
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
                    <span className="font-medium text-foreground">2. Replay</span> difficult passages at 0.75×, line by line.
                  </li>
                  <li>
                    <span className="font-medium text-foreground">3. Read along</span> with the transcript and note new
                    collocations.
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
      )}
    </>
  );
}
