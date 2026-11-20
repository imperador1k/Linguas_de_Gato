import {
  appendDictationAttempt,
  clamp,
  cueIndexForSegmentId,
  findActiveCueIndex,
  findReplayCueIndex,
  parseSubtitles,
  segmentPlaybackRange,
  summarizeDictation,
  summarizeLine,
  validateSubtitleFile,
  type LineProgress,
  type ListeningQuestion,
  type SubtitleCue,
  type TextComparison,
  type TimeRange,
  type TranscriptSummary,
} from '@ldg/shared';
import { BookOpenText, CircleCheck, ListChecks, PencilLine, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { cn } from '@/lib/utils';
import { useCapabilities } from '@/hooks/use-capabilities';
import { DictationLineList } from '../dictation/dictation-line-list';
import { ExerciseSetGenerator } from '../exercises/exercise-set-generator';
import { ExerciseSetList } from '../exercises/exercise-set-list';
import { ExerciseSetView } from '../exercises/exercise-set-view';
import { useExerciseMode } from '../exercises/use-exercise-mode';
import { DictationPanel } from '../dictation/dictation-panel';
import type { Playback } from '../playback/playback';
import { useBoundedPlayback, type BoundedPlaybackApi } from '../playback/use-bounded-playback';
import { useListeningShortcuts } from '../playback/use-listening-shortcuts';
import { PracticeBar } from '../practice-bar';
import type { TranscriptContent } from '../storage/listening-repository';
import { TranscriptPanel } from '../transcript-panel';
import { describeTranscriptSource } from '../transcription/transcribed-session';
import type { ListeningSessionApi, LoadedSession } from './use-listening-session';

type Mode = 'read' | 'dictation' | 'exercises';
const MODES: readonly Mode[] = ['read', 'dictation', 'exercises'];

export interface TranscriptChange {
  readonly content: TranscriptContent | null;
  readonly summary: TranscriptSummary | null;
}

/** Lets sidebar cards (e.g. automatic transcription) reuse the workspace's replace-with-confirmation flow. */
export interface WorkspaceTools {
  readonly hasTranscript: boolean;
  replaceTranscript(change: TranscriptChange): void;
}

const SAVE_INTERVAL_MS = 5000;

function ModeSwitch({ mode, transcriptAvailable, onChange }: { mode: Mode; transcriptAvailable: boolean; onChange: (mode: Mode) => void }) {
  const options: Array<{ value: Mode; label: string; icon: typeof BookOpenText; needs: string }> = [
    { value: 'read', label: 'Read along', icon: BookOpenText, needs: '' },
    { value: 'dictation', label: 'Dictation', icon: PencilLine, needs: 'Add a transcript to practise dictation' },
    { value: 'exercises', label: 'Comprehension', icon: ListChecks, needs: 'Add a transcript to generate comprehension exercises' },
  ];
  return (
    <div role="group" aria-label="Practice mode" className="inline-flex max-w-full rounded-lg border bg-card p-1">
      {options.map(({ value, label, icon: Icon, needs }) => {
        const selected = mode === value;
        const disabled = value !== 'read' && !transcriptAvailable;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            title={disabled ? needs : undefined}
            onClick={() => onChange(value)}
            className={cn(
              'inline-flex h-9 min-w-0 items-center gap-2 rounded-md px-2.5 text-sm transition-colors duration-150 disabled:opacity-50 sm:px-3',
              selected ? 'bg-primary font-medium text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SaveStatus({ persistent, saveError }: { persistent: boolean; saveError: string | null }) {
  if (saveError) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-destructive">
        <TriangleAlert aria-hidden="true" className="size-4" />
        Not saved
      </p>
    );
  }
  return persistent ? (
    <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <CircleCheck aria-hidden="true" className="size-4 text-success" />
      Saved in this browser
    </p>
  ) : (
    <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
      <TriangleAlert aria-hidden="true" className="size-4" />
      Not saved after you close this tab
    </p>
  );
}

/** Which line "replay" and "loop line" should act on right now. */
function useReplayTarget(cues: readonly SubtitleCue[] | null, practice: BoundedPlaybackApi, getTimeMs: () => number) {
  const lastSegment = useRef<{ cueIndex: number; range: TimeRange } | null>(null);

  const remember = useCallback((cueIndex: number, range: TimeRange) => {
    lastSegment.current = { cueIndex, range };
  }, []);

  const resolve = useCallback((): number => {
    if (!cues || cues.length === 0) return -1;
    const { bounded } = practice;
    if (bounded && 'cueIndex' in bounded) return bounded.cueIndex;
    const timeMs = getTimeMs();
    // Right after a replay, the padded tail can overlap the next cue; stay on the replayed line.
    const last = lastSegment.current;
    if (last && timeMs >= last.range.startMs && timeMs <= last.range.endMs + 250) return last.cueIndex;
    return findReplayCueIndex(cues, timeMs);
  }, [cues, practice, getTimeMs]);

  return { resolve, remember };
}

export function PracticeWorkspace({
  api,
  data,
  playback,
  player,
  sidebar,
  restorePosition,
}: {
  api: ListeningSessionApi;
  data: LoadedSession;
  playback: Playback;
  /** Rendered as a function so the player can show the active loop. */
  player: (loop: TimeRange | null) => ReactNode;
  sidebar?: ReactNode | ((tools: WorkspaceTools) => ReactNode);
  /** Seek to the saved position once ready (YouTube handles this at creation instead). */
  restorePosition: boolean;
}) {
  const { session, cues, dictation } = data;
  const { state, controls } = playback;
  const { updateSession } = api;
  const [searchParams, setSearchParams] = useSearchParams();
  const [autoPlayLine, setAutoPlayLine] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<TranscriptChange | null>(null);

  const hasCues = cues !== null && cues.length > 0;
  const requestedMode = searchParams.get('mode');
  const mode: Mode = hasCues && MODES.includes(requestedMode as Mode) ? (requestedMode as Mode) : 'read';
  const capabilities = useCapabilities();
  const generationAvailable = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const exerciseMode = useExerciseMode(session.id, cues);
  const lineParam = Number.parseInt(searchParams.get('line') ?? '1', 10);
  const selectedIndex = hasCues ? clamp(Number.isFinite(lineParam) ? lineParam - 1 : 0, 0, cues.length - 1) : 0;
  const durationMs = state.duration > 0 ? state.duration * 1000 : undefined;

  const setParams = useCallback(
    (next: { mode?: Mode; line?: number }) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next.mode) {
            if (next.mode === 'read') params.delete('mode');
            else params.set('mode', next.mode);
          }
          if (next.line !== undefined) params.set('line', String(next.line + 1));
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const onLoopChange = useCallback(
    (loop: TimeRange | null) => {
      void updateSession((current) => ({ ...current, loop }), { reflectInState: false });
    },
    [updateSession],
  );

  const practice = useBoundedPlayback(playback, { initialLoop: session.loop, onLoopChange });
  const getTimeMs = useCallback(() => controls.getCurrentTime() * 1000, [controls]);
  const replayTarget = useReplayTarget(cues, practice, getTimeMs);

  const playLine = useCallback(
    (index: number) => {
      const cue = cues?.[index];
      if (!cue) return;
      const range = segmentPlaybackRange(cue, { durationMs });
      replayTarget.remember(index, range);
      practice.playSegment(range, index);
    },
    [cues, durationMs, practice, replayTarget],
  );

  /** Plays the passage a comprehension question quotes (timestamps come from the verified evidence). */
  const playEvidence = useCallback(
    (question: ListeningQuestion) => {
      const cueIndex = cueIndexForSegmentId(question.segmentIds[0] ?? '') ?? 0;
      const range = segmentPlaybackRange({ startMs: question.startMs, endMs: question.endMs ?? question.startMs + 8000 }, { durationMs });
      practice.playSegment(range, cueIndex);
    },
    [durationMs, practice],
  );

  const replayLine = useCallback(() => {
    playLine(mode === 'dictation' ? selectedIndex : replayTarget.resolve());
  }, [mode, playLine, replayTarget, selectedIndex]);

  const toggleLineLoop = useCallback(() => {
    if (practice.bounded?.mode === 'loop' && practice.bounded.source === 'line') {
      practice.clear();
      return;
    }
    const index = mode === 'dictation' ? selectedIndex : replayTarget.resolve();
    const cue = cues?.[index];
    if (cue) practice.loopLine(segmentPlaybackRange(cue, { durationMs }), index);
  }, [cues, durationMs, mode, practice, replayTarget, selectedIndex]);

  const clearLoop = useCallback(() => {
    if (!practice.bounded && practice.pointA === null) return false;
    practice.clear();
    return true;
  }, [practice]);

  const onKeyDown = useListeningShortcuts(controls, {
    replayLine: hasCues ? replayLine : undefined,
    setPointA: practice.setPointA,
    setPointB: practice.setPointB,
    clearLoop,
  });

  // --- Playback position: restore once, then save periodically and on pause/leave.
  const stateRef = useRef(state);
  stateRef.current = state;
  const restored = useRef(!restorePosition);

  useEffect(() => {
    if (restored.current || !state.ready || state.duration <= 0) return;
    restored.current = true;
    const { positionSeconds, playbackRate } = session.playback;
    // Reopening at the very end would just show a finished recording.
    if (positionSeconds > 0 && positionSeconds < state.duration - 1) controls.seek(positionSeconds);
    if (playbackRate !== state.playbackRate) controls.setPlaybackRate(playbackRate);
  }, [state.ready, state.duration, state.playbackRate, session.playback, controls]);

  const savePlayback = useCallback(() => {
    const current = stateRef.current;
    if (!current.ready || !restored.current) return;
    void updateSession(
      (stored) => ({
        ...stored,
        playback: { positionSeconds: Math.max(0, current.currentTime), playbackRate: current.playbackRate },
      }),
      { reflectInState: false },
    );
  }, [updateSession]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (stateRef.current.playing) savePlayback();
    }, SAVE_INTERVAL_MS);
    window.addEventListener('pagehide', savePlayback);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', savePlayback);
      savePlayback();
    };
  }, [savePlayback]);

  useEffect(() => {
    if (!state.playing) savePlayback();
  }, [state.playing, state.playbackRate, savePlayback]);

  useEffect(() => {
    if (state.duration <= 0) return;
    if (session.durationSeconds !== null && Math.abs(session.durationSeconds - state.duration) < 1) return;
    const duration = state.duration;
    void updateSession((stored) => ({ ...stored, durationSeconds: duration }));
  }, [state.duration, session.durationSeconds, updateSession]);

  // --- Transcript import, generation and removal (dictation history depends on cue identities).
  function applyTranscriptChange(change: TranscriptChange) {
    setPendingChange(null);
    setTranscriptError(null);
    practice.clear();
    void api.replaceTranscript(session, change.summary, change.content);
    setParams(change.content ? { line: 0 } : { mode: 'read', line: 0 });
  }

  function requestTranscriptChange(change: TranscriptChange) {
    if (dictation.length > 0) setPendingChange(change);
    else applyTranscriptChange(change);
  }

  async function importSubtitles(file: File) {
    const validation = validateSubtitleFile(file);
    if (!validation.ok) {
      setTranscriptError(validation.error.message);
      return;
    }
    try {
      const result = parseSubtitles(await file.text(), validation.value);
      if (result.cues.length === 0) {
        setTranscriptError('No subtitle lines were found in this file.');
        return;
      }
      requestTranscriptChange({
        content: { cues: result.cues },
        summary: { fileName: file.name, format: result.format, cueCount: result.cues.length, skippedBlocks: result.skippedBlocks },
      });
    } catch {
      setTranscriptError('This file could not be read.');
    }
  }

  // --- Dictation progress.
  const progress = useMemo(() => {
    const map = new Map<string, LineProgress>();
    if (!cues) return map;
    const byCue = new Map(dictation.map((record) => [record.cueId, record]));
    for (const cue of cues) {
      const line = summarizeLine(byCue.get(cue.id), cue.text);
      if (line) map.set(cue.id, line);
    }
    return map;
  }, [cues, dictation]);
  const summary = useMemo(() => summarizeDictation(cues ?? [], dictation), [cues, dictation]);

  function submitAttempt(cue: SubtitleCue, answer: string, comparison: TextComparison) {
    const existing = dictation.find((record) => record.cueId === cue.id);
    const record = appendDictationAttempt(existing, {
      sessionId: session.id,
      cueId: cue.id,
      referenceText: cue.text,
      attempt: {
        submittedAt: Date.now(),
        answer,
        wordErrorRate: comparison.wordErrorRate,
        accuracy: comparison.accuracy,
        referenceWords: comparison.counts.referenceWords,
      },
    });
    void api.saveDictation(record);
  }

  function selectLine(index: number, options: { autoPlay: boolean } = { autoPlay: false }) {
    // Replays and loops of the previous line stop; an A-B loop is the learner's and stays.
    if (practice.bounded && 'cueIndex' in practice.bounded) practice.clear();
    setAutoPlayLine(options.autoPlay);
    setParams({ line: index });
  }

  const activeIndex = useMemo(
    () => (cues ? findActiveCueIndex(cues, state.currentTime * 1000) : -1),
    [cues, state.currentTime],
  );
  const loop = practice.bounded?.mode === 'loop' ? practice.bounded.range : null;
  const selectedCue = hasCues ? cues[selectedIndex] : undefined;
  const tools: WorkspaceTools = { hasTranscript: hasCues, replaceTranscript: requestTranscriptChange };

  return (
    <div role="group" aria-label="Listening session" tabIndex={-1} onKeyDown={onKeyDown} className="flex flex-col gap-6 outline-none">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ModeSwitch
          mode={mode}
          transcriptAvailable={hasCues}
          onChange={(next) => {
            // A one-off line replay belongs to the old view; A-B and line loops are kept.
            if (practice.bounded?.mode === 'segment') practice.clear();
            setAutoPlayLine(false);
            setParams({ mode: next });
          }}
        />
        <SaveStatus persistent={api.persistent} saveError={api.saveError} />
      </div>

      {api.saveError ? (
        <Notice tone="error" role="alert">
          {api.saveError} You can keep practising; recent changes may be lost on reload.
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {player(loop)}
          <PracticeBar
            practice={practice}
            ready={state.ready}
            canReplayLine={hasCues}
            onReplayLine={replayLine}
            onToggleLineLoop={toggleLineLoop}
          />
          {mode === 'dictation' && selectedCue && cues ? (
            <DictationPanel
              key={selectedCue.id}
              cue={selectedCue}
              index={selectedIndex}
              total={cues.length}
              progress={progress.get(selectedCue.id) ?? null}
              ready={state.ready}
              autoPlay={autoPlayLine}
              onPlayLine={() => playLine(selectedIndex)}
              onNavigate={selectLine}
              onSubmit={(answer, comparison) => submitAttempt(selectedCue, answer, comparison)}
            />
          ) : null}
          {mode === 'exercises' && cues ? (
            <>
              {exerciseMode.error ? (
                <Notice tone="error" role="alert">
                  {exerciseMode.error}
                </Notice>
              ) : null}
              {!exerciseMode.loaded ? null : exerciseMode.active ? (
                <ExerciseSetView
                  key={exerciseMode.active.id}
                  set={exerciseMode.active}
                  stale={exerciseMode.isStale(exerciseMode.active.transcriptFingerprint)}
                  canPlay={state.ready}
                  onChange={(update) => exerciseMode.active && exerciseMode.update(exerciseMode.active.id, update)}
                  onPlay={playEvidence}
                />
              ) : (
                <ExerciseSetGenerator
                  sessionId={session.id}
                  cues={cues}
                  available={generationAvailable}
                  onCreated={(set) => {
                    void exerciseMode.add(set);
                    exerciseMode.select(set.id);
                  }}
                  onCancel={exerciseMode.sets && exerciseMode.sets.length > 0 ? () => exerciseMode.select(exerciseMode.sets?.[0]?.id ?? null) : undefined}
                />
              )}
            </>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {mode === 'exercises' && cues ? (
            <ExerciseSetList
              sets={exerciseMode.sets ?? []}
              activeId={exerciseMode.activeId}
              onSelect={(id) => exerciseMode.select(id)}
              onNew={() => exerciseMode.select(null)}
              onDelete={(id) => void exerciseMode.remove(id)}
            />
          ) : mode === 'dictation' && cues ? (
            <DictationLineList
              cues={cues}
              progress={progress}
              summary={summary}
              selectedIndex={selectedIndex}
              onSelect={(index) => selectLine(index)}
            />
          ) : (
            <TranscriptPanel
              transcript={
                cues && session.transcript
                  ? { fileName: describeTranscriptSource(session.transcript), cues, skippedBlocks: session.transcript.skippedBlocks }
                  : null
              }
              activeIndex={activeIndex}
              error={transcriptError}
              onImport={(file) => void importSubtitles(file)}
              onClear={() => requestTranscriptChange({ content: null, summary: null })}
              onSeek={(seconds) => {
                practice.clear();
                controls.seek(seconds);
              }}
            />
          )}
          {typeof sidebar === 'function' ? sidebar(tools) : sidebar}
        </div>
      </div>

      <ConfirmDialog
        open={pendingChange !== null}
        title={pendingChange?.content ? 'Replace the transcript?' : 'Remove the transcript?'}
        description={`Dictation history for this session (${summary.practisedLines} ${summary.practisedLines === 1 ? 'line' : 'lines'}) will be cleared, because it belongs to the current transcript lines.`}
        confirmLabel={pendingChange?.content ? 'Replace' : 'Remove'}
        destructive
        onConfirm={() => pendingChange && applyTranscriptChange(pendingChange)}
        onCancel={() => setPendingChange(null)}
      />
    </div>
  );
}
