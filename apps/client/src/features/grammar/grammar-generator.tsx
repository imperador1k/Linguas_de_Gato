import {
  GRAMMAR_LEVELS,
  GRAMMAR_QUESTION_TYPES,
  GRAMMAR_RECORD_VERSION,
  GRAMMAR_TOPICS,
  type GrammarLevel,
  type GrammarQuestionType,
  type GrammarSetRecord,
  type GrammarTopic,
  type TargetedPractice,
} from '@ldg/shared';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckGroup, ChoiceGroup, SELECT_CLASS } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { PrivacyNote } from '@/components/ui/privacy-note';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { LEVEL_DESCRIPTIONS } from '../speaking/generation-labels';
import { GRAMMAR_TOPIC_LABELS, QUESTION_TYPE_LABELS } from './grammar-labels';
import type { GrammarRepository } from './storage/grammar-repository';

const COUNTS = [4, 6, 8, 10, 12] as const;

export interface GrammarGeneratorInitial {
  readonly topic?: GrammarTopic;
  readonly focus?: string | null;
  readonly level?: GrammarLevel;
}

/**
 * Settings for a new exercise set. Generating writes the questions, checks
 * them and saves the set in one step (there is nothing to edit before
 * answering), then the set opens. Nothing is sent until "Generate" is pressed.
 */
export function GrammarGenerator({
  repository,
  onCreated,
  initial,
  targetedPractice = null,
  onDirtyChange,
}: {
  repository: GrammarRepository;
  onCreated: (record: GrammarSetRecord) => void;
  initial?: GrammarGeneratorInitial;
  /** Personalized training: the bounded profile from the learner's mistakes. */
  targetedPractice?: TargetedPractice | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const job = useGenerationJob();
  const [level, setLevel] = useState<GrammarLevel>(initial?.level ?? 'C1');
  const [topic, setTopic] = useState<GrammarTopic>(initial?.topic ?? 'conditionals');
  const [types, setTypes] = useState<GrammarQuestionType[]>(['multiple_choice', 'gap_fill', 'transformation', 'error_correction']);
  const [count, setCount] = useState<number>(8);
  const [focus, setFocus] = useState(initial?.focus ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);
  const id = useId();

  useEffect(() => onDirtyChange?.(running), [running, onDirtyChange]);

  async function generate() {
    setSaveError(null);
    const response = await job.start({ kind: 'grammar', level, topic, types, questionCount: count, focus: focus.trim() || null, avoidTitles: [], ...(targetedPractice ? { targetedPractice } : {}) });
    if (!response || response.result.kind !== 'grammar') return;
    const now = Date.now();
    const record: GrammarSetRecord = {
      id: crypto.randomUUID(),
      version: GRAMMAR_RECORD_VERSION,
      set: response.result.set,
      types,
      discarded: response.result.discarded,
      model: response.model,
      answers: [],
      checkedAt: null,
      reviews: [],
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      await repository.sets.put(record);
      onCreated(record);
    } catch (caught) {
      setSaveError(describeStorageFailure(caught));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-topic`}>Grammar area</Label>
          <select id={`${id}-topic`} value={topic} disabled={running} onChange={(event) => setTopic(event.target.value as GrammarTopic)} className={SELECT_CLASS}>
            {GRAMMAR_TOPICS.map((value) => (
              <option key={value} value={value}>
                {GRAMMAR_TOPIC_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <ChoiceGroup legend="Target level" value={level} disabled={running} options={GRAMMAR_LEVELS.map((value) => ({ value, label: value }))} onChange={setLevel} />
          <p className="text-xs text-muted-foreground">{LEVEL_DESCRIPTIONS[level]}</p>
        </div>
      </div>
      <CheckGroup
        legend="Question types"
        values={types}
        disabled={running}
        options={GRAMMAR_QUESTION_TYPES.map((value) => ({ value, label: QUESTION_TYPE_LABELS[value].label, hint: QUESTION_TYPE_LABELS[value].hint }))}
        onChange={setTypes}
      />
      {types.length === 0 ? <p className="-mt-3 text-xs text-destructive">Choose at least one type.</p> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <ChoiceGroup legend="Number of questions" value={count} disabled={running} options={COUNTS.map((value) => ({ value, label: <span className="tabular-nums">{value}</span> }))} onChange={setCount} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-focus`}>Narrower focus (optional)</Label>
          <Input id={`${id}-focus`} value={focus} maxLength={200} disabled={running} placeholder="e.g. mixed conditionals about regrets" onChange={(event) => setFocus(event.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Questions with more than one plausible answer are removed unless every correct answer is accepted.</p>
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
          <Button onClick={() => void generate()} disabled={types.length === 0}>
            <Sparkles aria-hidden="true" />
            Generate
          </Button>
        )}
      </div>
      {job.state.phase === 'failed' ? (
        <Notice tone="error" role="alert">
          {job.state.message}
        </Notice>
      ) : null}
      {saveError ? (
        <Notice tone="error" role="alert">
          {saveError}
        </Notice>
      ) : null}
      {job.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Generation cancelled. Nothing was saved.</p> : null}
      <PrivacyNote>Your settings are sent to Groq to write the questions; scoring happens in this browser against the answer key.</PrivacyNote>
    </div>
  );
}
