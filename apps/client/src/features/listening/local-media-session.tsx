import {
  findActiveCueIndex,
  formatBytes,
  parseSubtitles,
  validateSubtitleFile,
  type AcceptedMediaFile,
} from '@ldg/shared';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { MediaPlayer, SKIP_SECONDS } from './media-player';
import { TranscriptPanel, type LoadedTranscript } from './transcript-panel';
import { TranscriptionCard } from './transcription-card';
import { useMediaPlayer } from './use-media-player';

const NON_SHORTCUT_TARGETS = new Set(['SELECT', 'TEXTAREA']);
const NATIVE_KEY_TARGETS = new Set(['INPUT', 'BUTTON']);

/** Player + transcript for a local file. The object URL lives exactly as long as this session. */
export function LocalMediaSession({ file, accepted }: { file: File; accepted: AcceptedMediaFile }) {
  const { ref, state, controls } = useMediaPlayer();
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<LoadedTranscript | null>(null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const activeIndex = useMemo(
    () => (transcript ? findActiveCueIndex(transcript.cues, state.currentTime * 1000) : -1),
    [transcript, state.currentTime],
  );

  async function importSubtitles(subtitleFile: File) {
    const validation = validateSubtitleFile(subtitleFile);
    if (!validation.ok) {
      setTranscriptError(validation.error.message);
      return;
    }

    try {
      const result = parseSubtitles(await subtitleFile.text(), validation.value);
      if (result.cues.length === 0) {
        setTranscriptError('No subtitle lines were found in this file.');
        return;
      }
      setTranscriptError(null);
      setTranscript({ fileName: subtitleFile.name, cues: result.cues, skippedBlocks: result.skippedBlocks });
    } catch {
      setTranscriptError('This file could not be read.');
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (NON_SHORTCUT_TARGETS.has(target.tagName)) return;
    const nativeTarget = NATIVE_KEY_TARGETS.has(target.tagName);

    switch (event.key) {
      case ' ':
        if (nativeTarget) return;
        controls.togglePlay();
        break;
      case 'k':
      case 'K':
        controls.togglePlay();
        break;
      case 'j':
      case 'J':
        controls.skip(-SKIP_SECONDS);
        break;
      case 'l':
      case 'L':
        controls.skip(SKIP_SECONDS);
        break;
      case 'ArrowLeft':
        if (nativeTarget) return;
        controls.skip(-SKIP_SECONDS);
        break;
      case 'ArrowRight':
        if (nativeTarget) return;
        controls.skip(SKIP_SECONDS);
        break;
      case 'm':
      case 'M':
        controls.toggleMute();
        break;
      case ',':
        controls.stepPlaybackRate(-1);
        break;
      case '.':
        controls.stepPlaybackRate(1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const meta = `${accepted.format.label} · ${formatBytes(file.size)}`;

  return (
    <div
      role="group"
      aria-label="Listening session"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="grid gap-6 outline-none xl:grid-cols-[minmax(0,1fr)_24rem]"
    >
      <div className="min-w-0">
        {objectUrl ? (
          <MediaPlayer src={objectUrl} title={file.name} meta={meta} mediaRef={ref} state={state} controls={controls} />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <TranscriptPanel
          transcript={transcript}
          activeIndex={activeIndex}
          error={transcriptError}
          onImport={(subtitleFile) => void importSubtitles(subtitleFile)}
          onClear={() => {
            setTranscript(null);
            setTranscriptError(null);
          }}
          onSeek={(seconds) => controls.seek(seconds)}
        />
        <TranscriptionCard sourceKind="file" />
      </div>
    </div>
  );
}
