import { MEDIA_FORMATS, formatBytes, type FileSource, type YouTubeSource } from '@ldg/shared';
import { useEffect, useMemo, useState } from 'react';
import { MediaPlayer } from '../media-player';
import { TranscriptionCard } from '../transcription-card';
import { SessionTranscriptionCard } from '../transcription/session-transcription-card';
import { useMediaPlayer } from '../use-media-player';
import { useYouTubePlayer } from '../youtube/use-youtube-player';
import { YouTubeSessionPlayer } from '../youtube/youtube-session-player';
import { MediaCopyCard } from './media-copy-card';
import { MediaReconnect } from './media-reconnect';
import { PracticeWorkspace } from './practice-workspace';
import type { ListeningSessionApi, LoadedSession } from './use-listening-session';

/** Object URL for a Blob, revoked when the Blob changes or the view unmounts. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function LocalSessionView({
  api,
  data,
  source,
}: {
  api: ListeningSessionApi;
  data: LoadedSession;
  source: FileSource;
}) {
  const { ref, state, controls } = useMediaPlayer();
  const objectUrl = useObjectUrl(data.media);
  const playback = useMemo(() => ({ state, controls }), [state, controls]);
  const label = MEDIA_FORMATS.find((format) => format.extension === source.formatExtension)?.label ?? source.formatExtension;
  const meta = `${label} · ${formatBytes(source.fileSize)}`;

  return (
    <PracticeWorkspace
      api={api}
      data={data}
      playback={playback}
      restorePosition
      player={(loop) =>
        objectUrl ? (
          <MediaPlayer
            src={objectUrl}
            title={source.fileName}
            meta={meta}
            mediaRef={ref}
            state={state}
            controls={controls}
            loop={loop}
          />
        ) : (
          <MediaReconnect source={source} onAttach={api.attachMedia} />
        )
      }
      sidebar={(tools) => (
        <>
          <SessionTranscriptionCard source={source} media={data.media} tools={tools} />
          <MediaCopyCard
            source={source}
            media={data.media}
            persistent={api.persistent}
            onChange={(enabled) => api.setMediaCopy(enabled, data.media)}
          />
        </>
      )}
    />
  );
}

export function YouTubeSessionView({
  api,
  data,
  source,
}: {
  api: ListeningSessionApi;
  data: LoadedSession;
  source: YouTubeSource;
}) {
  const video = useMemo(
    () => ({ videoId: source.videoId, ...(source.startSeconds !== undefined ? { startSeconds: source.startSeconds } : {}) }),
    [source.videoId, source.startSeconds],
  );
  const youtube = useYouTubePlayer(video, data.session.playback);
  const { state, controls } = youtube;
  const playback = useMemo(() => ({ state, controls }), [state, controls]);

  return (
    <PracticeWorkspace
      api={api}
      data={data}
      playback={playback}
      restorePosition={false}
      player={(loop) => (
        <YouTubeSessionPlayer
          video={video}
          containerRef={youtube.containerRef}
          status={youtube.status}
          state={state}
          controls={controls}
          loop={loop}
          onRetry={youtube.retry}
        />
      )}
      sidebar={<TranscriptionCard sourceKind="youtube" />}
    />
  );
}
