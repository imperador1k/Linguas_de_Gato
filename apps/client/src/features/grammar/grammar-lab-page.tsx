import {
  GRAMMAR_LEVELS,
  GRAMMAR_QUESTION_TYPES,
  GRAMMAR_RECORD_VERSION,
  GRAMMAR_TOPICS,
  scoreGrammarSet,
  type GrammarLevel,
  type GrammarQuestionType,
  type GrammarSetRecord,
  type GrammarTopic,
} from '@ldg/shared';
import { LoaderCircle, ShieldCheck, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckGroup, ChoiceGroup, SELECT_CLASS } from '@/components/ui/choice-group';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { LEVEL_DESCRIPTIONS } from '../speaking/generation-labels';
import { dateFormatter, GRAMMAR_TOPIC_LABELS, QUESTION_TYPE_LABELS } from './grammar-labels';
import { grammarStorage, type GrammarRepository } from './storage/grammar-repository';

const COUNTS = [4, 6, 8, 10, 12] as const;

function describeProgress(record: GrammarSetRecord): string {
  const last = record.history.at(-1);
  if (record.checkedAt === null) {
    const { answered, total } = scoreGrammarSet(record);
    if (answered > 0) return `In progress · ${answered}/${total} answered`;
  }
  if (!last) return `Not started · ${record.set.questions.length} questions`;
  const best = Math.max(...record.history.map((round) => round.correct));
  return `Last ${last.correct}/${last.total}${record.history.length > 1 ? ` · best ${best}/${last.total} · ${record.history.length} rounds` : ''}`;
}

function Generator({ repository, onCreated }: { repository: GrammarRepository; onCreated: (record: GrammarSetRecord) => void }) {
  const job = useGenerationJob();
  const [level, setLevel] = useState<GrammarLevel>('C1');
  const [topic, setTopic] = useState<GrammarTopic>('conditionals');
  const [types, setTypes] = useState<GrammarQuestionType[]>(['multiple_choice', 'gap_fill', 'transformation', 'error_correction']);
  const [count, setCount] = useState<number>(8);
  const [focus, setFocus] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);
  const id = useId();

  async function generate() {
    setSaveError(null);
    const response = await job.start({ kind: 'grammar', level, topic, types, questionCount: count, focus: focus.trim() || null, avoidTitles: [] });
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
      <div className="grid gap-5 md:grid-cols-2">
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
      <div className="grid gap-5 md:grid-cols-2">
        <ChoiceGroup legend="Number of questions" value={count} disabled={running} options={COUNTS.map((value) => ({ value, label: <span className="font-mono tabular-nums">{value}</span> }))} onChange={setCount} />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-focus`}>Narrower focus (optional)</Label>
          <Input id={`${id}-focus`} value={focus} maxLength={200} disabled={running} placeholder="e.g. mixed conditionals about regrets" onChange={(event) => setFocus(event.target.value)} />
        </div>
      </div>
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
            Generate exercise
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
      {job.state.phase === 'cancelled' ? <p className="text-sm text-muted-foreground">Generation cancelled.</p> : null}
    </div>
  );
}

export function GrammarLabPage() {
  const storage = grammarStorage.use();
  const capabilities = useCapabilities();
  const navigate = useNavigate();
  const [sets, setSets] = useState<GrammarSetRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GrammarSetRecord | null>(null);
  const ids = { generate: useId(), sets: useId() };
  const available = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;

  const refresh = useCallback(async () => {
    if (!storage) return;
    try {
      setSets((await storage.repository.sets.list()).sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (caught) {
      setError(describeStorageFailure(caught));
      setSets([]);
    }
  }, [storage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <PageHeader
        eyebrow="Grammar"
        title="Precise structures, clear rules."
        description="Focused practice on the B2–C2 structures that make writing and speech precise. Answers are checked against a verified key, with the rule and the reasons behind every option."
      />

      {storage?.fallbackReason ? <Notice className="mb-6">{storage.fallbackReason.message} Your exercises will last until you close this tab.</Notice> : null}
      {error ? (
        <Notice tone="error" role="alert" className="mb-6">
          {error}
        </Notice>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card aria-labelledby={ids.generate} className="min-w-0">
          <CardHeader>
            <CardTitle id={ids.generate}>New exercise</CardTitle>
            <CardDescription>Questions with more than one plausible answer are removed unless every correct answer is accepted.</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {capabilities.status === 'ready' && !available ? (
              <Notice>
                Generating exercises needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
              </Notice>
            ) : storage ? (
              <Generator repository={storage.repository} onCreated={(record) => navigate(`/grammar/sets/${record.id}`)} />
            ) : null}
          </CardContent>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card aria-labelledby={ids.sets}>
            <CardHeader>
              <CardTitle id={ids.sets}>Your exercises</CardTitle>
              <CardDescription>{storage?.persistent === false ? 'Kept until you close this tab.' : 'Answers and results are saved in this browser.'}</CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
              {sets === null ? null : sets.length === 0 ? (
                <p className="text-sm text-muted-foreground">Generated exercises and your results appear here.</p>
              ) : (
                <ul className="flex flex-col divide-y rounded-lg border" aria-label="Saved grammar exercises">
                  {sets.map((record) => (
                    <li key={record.id} className="flex items-center gap-2 px-3 py-1.5">
                      <Link to={`/grammar/sets/${record.id}`} className="min-w-0 flex-1 rounded-md px-1 py-1.5 hover:bg-accent/40">
                        <span className="block truncate text-sm font-medium">{record.set.title}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <Badge variant="outline" className="px-2 py-0">
                            {record.set.level}
                          </Badge>
                          {describeProgress(record)} · {dateFormatter.format(record.createdAt)}
                        </span>
                      </Link>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete exercise ${record.set.title}`} onClick={() => setPendingDelete(record)}>
                        <Trash aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <p className="flex gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Your settings are sent to Groq to write the questions. Scoring happens in this browser against the answer key. An optional AI second opinion on an open answer
              sends the question and your answer to Groq, and never changes your score. Levels are practice targets, not an official CEFR assessment.
            </span>
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this exercise?"
        description="Its questions, your answers and the history of your results are removed from this browser."
        confirmLabel="Delete exercise"
        destructive
        onConfirm={() => {
          const record = pendingDelete;
          setPendingDelete(null);
          if (record && storage) void storage.repository.sets.delete(record.id).then(refresh, (caught: unknown) => setError(describeStorageFailure(caught)));
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
