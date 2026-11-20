import {
  GENERATION_LEVELS,
  LISTENING_GENERATION_LIMITS,
  LISTENING_QUESTION_TYPES,
  LISTENING_SET_RECORD_VERSION,
  prepareListeningTranscript,
  transcriptFingerprint,
  type GenerationLevel,
  type ListeningExerciseSet,
  type ListeningQuestionType,
  type SubtitleCue,
} from '@ldg/shared';
import { LoaderCircle, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { useGenerationJob } from '@/lib/use-generation-job';
import { cn } from '@/lib/utils';
import { QUESTION_TYPE_LABELS } from './exercise-labels';

const QUESTION_COUNTS = [4, 6, 8, 10] as const;

function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000));
}

const chipClass = (selected: boolean) =>
  cn(
    'flex cursor-pointer flex-col rounded-md border px-3.5 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
    selected ? 'border-foreground bg-accent/60' : 'border-input hover:border-border-strong',
  );

/**
 * Settings and the explicit "Generate exercises" action. Only the saved
 * transcript of this session is sent, and only when the learner presses the
 * button.
 */
export function ExerciseSetGenerator({
  sessionId,
  cues,
  available,
  onCreated,
  onCancel,
}: {
  sessionId: string;
  cues: readonly SubtitleCue[];
  /** Whether the server has exercise generation configured. */
  available: boolean;
  onCreated: (set: ListeningExerciseSet) => void;
  /** Present when there are saved sets to go back to. */
  onCancel?: (() => void) | undefined;
}) {
  const job = useGenerationJob();
  const [level, setLevel] = useState<GenerationLevel>('C1');
  const [count, setCount] = useState<number>(6);
  const [types, setTypes] = useState<ListeningQuestionType[]>([...LISTENING_QUESTION_TYPES]);
  const prepared = useMemo(() => prepareListeningTranscript(cues), [cues]);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);
  const name = useId();
  const tooShort = prepared.wordCount < LISTENING_GENERATION_LIMITS.minWords;

  function toggleType(type: ListeningQuestionType) {
    setTypes((current) => (current.includes(type) ? current.filter((value) => value !== type) : LISTENING_QUESTION_TYPES.filter((value) => value === type || current.includes(value))));
  }

  async function generate() {
    const response = await job.start({ kind: 'listening', level, questionCount: count, types, segments: prepared.segments });
    if (!response || response.result.kind !== 'listening') return;
    const now = Date.now();
    onCreated({
      id: crypto.randomUUID(),
      version: LISTENING_SET_RECORD_VERSION,
      sessionId,
      level,
      types,
      questions: response.result.questions,
      discarded: response.result.discarded,
      transcriptFingerprint: transcriptFingerprint(cues),
      truncated: prepared.truncated,
      model: response.model,
      answers: [],
      submittedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles aria-hidden="true" className="size-4 text-brand" />
          Comprehension exercises
        </CardTitle>
        <CardDescription>
          Questions written from this session's transcript, on the main ideas, details and implications of what you heard. Listen first;
          the transcript stays hidden while you answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-1">
        {!available ? (
          <Notice>
            Exercise generation needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
          </Notice>
        ) : tooShort ? (
          <Notice>
            The transcript is too short for meaningful questions: at least {LISTENING_GENERATION_LIMITS.minWords} words are needed (it has{' '}
            {prepared.wordCount}).
          </Notice>
        ) : (
          <>
            <fieldset disabled={running} className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Target level</legend>
              <div className="grid grid-cols-3 gap-2 sm:flex">
                {GENERATION_LEVELS.map((value) => (
                  <label key={value} className={cn(chipClass(level === value), 'items-center sm:min-w-20')}>
                    <input type="radio" name={`${name}-level`} className="sr-only" checked={level === value} onChange={() => setLevel(value)} />
                    <span className="text-sm font-medium">{value}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset disabled={running} className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Question types</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {LISTENING_QUESTION_TYPES.map((type) => (
                  <label key={type} className={chipClass(types.includes(type))}>
                    <input type="checkbox" className="sr-only" checked={types.includes(type)} onChange={() => toggleType(type)} />
                    <span className="text-sm font-medium">{QUESTION_TYPE_LABELS[type].label}</span>
                    <span className="mt-0.5 text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[type].description}</span>
                  </label>
                ))}
              </div>
              {types.length === 0 ? <p className="mt-2 text-xs text-destructive">Choose at least one type.</p> : null}
            </fieldset>

            <fieldset disabled={running} className="min-w-0">
              <legend className="mb-2 text-sm font-medium">Number of questions</legend>
              <div className="grid grid-cols-4 gap-2 sm:flex">
                {QUESTION_COUNTS.map((value) => (
                  <label key={value} className={cn(chipClass(count === value), 'items-center sm:min-w-16')}>
                    <input type="radio" name={`${name}-count`} className="sr-only" checked={count === value} onChange={() => setCount(value)} />
                    <span className="font-mono text-sm font-medium tabular-nums">{value}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {prepared.truncated ? (
              <Notice>This transcript is long, so questions will cover roughly its first {Math.round(prepared.wordCount / 150)} minutes.</Notice>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <>
                  <Button disabled>
                    <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                    Generating…
                  </Button>
                  <Button variant="ghost" onClick={job.cancel}>
                    Cancel
                  </Button>
                  <span role="status" className="text-sm text-muted-foreground tabular-nums">
                    Writing and checking questions · {elapsed}s
                  </span>
                </>
              ) : (
                <>
                  <Button onClick={() => void generate()} disabled={types.length === 0}>
                    <Sparkles aria-hidden="true" />
                    Generate exercises
                  </Button>
                  {onCancel ? (
                    <Button variant="ghost" onClick={onCancel}>
                      Back to saved sets
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            {job.state.phase === 'failed' ? (
              <Notice tone="error" role="alert">
                {job.state.message}
              </Notice>
            ) : null}
            {job.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Generation cancelled.</p> : null}
          </>
        )}
        <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Generating sends this session's transcript text (not the audio) through the local server to Groq. Every question must quote
            the transcript; questions whose evidence can't be found are discarded. Levels are practice targets, not an official CEFR
            assessment.
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
