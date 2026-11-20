import {
  CATEGORY_INFO,
  GRAMMAR_RECORD_VERSION,
  LEARNING_RECORD_VERSION,
  WRITING_RECORD_VERSION,
  buildTargetedPractice,
  buildTrainingRequest,
  generatedExerciseToTopicDraft,
  trainingOptionsFor,
  type CustomTopic,
  type GrammarSetRecord,
  type LearningCategory,
  type SpeakingGenerationRequest,
  type TrainingOption,
  type TrainingSession,
  type WritingTaskRecord,
} from '@ldg/shared';
import { Sparkles } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { ChoiceGroup, SELECT_CLASS } from '@/components/ui/choice-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { grammarStorage } from '@/features/grammar/storage/grammar-repository';
import { GRAMMAR_TOPIC_LABELS } from '@/features/grammar/grammar-labels';
import { STATUS_LABELS, formatDate } from '@/features/progress/format';
import type { LearningRepository } from '@/features/progress/storage/learning-repository';
import type { DerivedLearning } from '@/features/progress/use-learning-engine';
import { getSpeakingStorage } from '@/features/speaking/storage/speaking-storage';
import { writingStorage } from '@/features/writing/storage/writing-repository';
import { useCapabilities } from '@/hooks/use-capabilities';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { StorageError } from '@/lib/storage/indexed-db';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';

type Level = 'B2' | 'C1' | 'C2';

function optionLabel(option: TrainingOption): string {
  switch (option.module) {
    case 'grammar':
      return `Grammar exercises · ${GRAMMAR_TOPIC_LABELS[option.topic]}`;
    case 'writing':
      return 'Writing task';
    case 'speaking':
      return 'Speaking task';
  }
}

function openPath(session: TrainingSession): string {
  return session.module === 'grammar' ? `/grammar/sets/${session.recordId}` : session.module === 'writing' ? `/writing/tasks/${session.recordId}` : `/speaking/practice/custom/${session.recordId}`;
}

export function TrainingSection({ derived, repository, sessions, initialCategory, onCreated }: { derived: DerivedLearning; repository: LearningRepository; sessions: readonly TrainingSession[]; initialCategory: string | null; onCreated: () => void }) {
  const capabilities = useCapabilities();
  const available = capabilities.status === 'ready' && capabilities.data.exerciseGeneration.available;
  const candidates = useMemo(() => derived.insights.filter((insight) => insight.errors > 0 && trainingOptionsFor(insight.category).length > 0), [derived.insights]);
  const initial = candidates.find((insight) => insight.category === initialCategory)?.category ?? candidates[0]?.category ?? null;
  const [category, setCategory] = useState<LearningCategory | null>(initial);
  const [optionIndex, setOptionIndex] = useState(0);
  const [level, setLevel] = useState<Level>('C1');
  const [count, setCount] = useState(8);
  const [includeExamples, setIncludeExamples] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [created, setCreated] = useState<TrainingSession | null>(null);
  const job = useGenerationJob();
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(running && job.state.phase === 'running' ? job.state.startedAt : null);
  const id = useId();

  const options = category ? trainingOptionsFor(category) : [];
  const option = options[Math.min(optionIndex, options.length - 1)] ?? null;
  const insight = candidates.find((candidate) => candidate.category === category) ?? null;
  const targeted = useMemo(() => (category ? buildTargetedPractice(category, derived.extraction.observations, includeExamples) : null), [category, derived.extraction.observations, includeExamples]);

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-lg border border-dashed px-4 py-6 text-sm leading-relaxed text-muted-foreground">
          Targeted practice needs real mistakes to work from, and none have been recorded yet in an area the exercise generators can practise (grammar, vocabulary, organisation, register or punctuation). Listening, reading and review practice is suggested under Recommendations instead.
        </p>
        <PastSessions sessions={sessions} />
      </div>
    );
  }

  async function generate() {
    if (!category || !option || !targeted) return;
    setSaveError(null);
    setCreated(null);
    const request = buildTrainingRequest(option, { level, questionCount: count, targeted });
    const response = await job.start(request);
    if (!response) return;
    const now = Date.now();
    try {
      let recordId: string;
      let title: string;
      if (response.result.kind === 'grammar' && request.kind === 'grammar') {
        const record: GrammarSetRecord = {
          id: crypto.randomUUID(),
          version: GRAMMAR_RECORD_VERSION,
          set: response.result.set,
          types: request.types,
          discarded: response.result.discarded,
          model: response.model,
          answers: [],
          checkedAt: null,
          reviews: [],
          history: [],
          createdAt: now,
          updatedAt: now,
        };
        await (await grammarStorage.get()).repository.sets.put(record);
        recordId = record.id;
        title = record.set.title;
      } else if (response.result.kind === 'writing' && request.kind === 'writing') {
        const record: WritingTaskRecord = { id: crypto.randomUUID(), version: WRITING_RECORD_VERSION, task: response.result.task, category: request.category, model: response.model, createdAt: now, updatedAt: now };
        await (await writingStorage.get()).repository.tasks.put(record);
        recordId = record.id;
        title = record.task.title;
      } else if (response.result.kind === 'speaking' && request.kind === 'speaking') {
        const draft = generatedExerciseToTopicDraft(response.result.exercise, request as SpeakingGenerationRequest, response.model, response.createdAt);
        const topic: CustomTopic = { id: crypto.randomUUID(), prompt: draft.prompt, generated: draft.generated, createdAt: now };
        await (await getSpeakingStorage()).repository.putTopic(topic);
        recordId = topic.id;
        title = topic.prompt.title;
      } else {
        throw new Error('The server returned a different kind of exercise.');
      }
      const session: TrainingSession = {
        id: crypto.randomUUID(),
        version: LEARNING_RECORD_VERSION,
        category,
        module: option.module,
        level,
        recordId,
        title: title.slice(0, 160),
        includedExamples: targeted.examples.length,
        createdAt: now,
      };
      await repository.training.put(session);
      setCreated(session);
      onCreated();
    } catch (caught) {
      setSaveError(caught instanceof StorageError ? describeStorageFailure(caught) : 'The generated exercise could not be saved, so nothing was added. Try again.');
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Pick a weakness and the app asks the existing Grammar, Writing or Speaking generator for material centred on it. Only the area's name, a one-line description and, if you allow it, up to five of your own mistakes are sent. Nothing
        else from your history leaves the browser.
      </p>

      {!available ? <Notice>{capabilities.status === 'loading' ? 'Checking whether exercise generation is available…' : 'Exercise generation is not available: the server needs a Groq API key. The analysis above still works without it.'}</Notice> : null}

      <div className="flex flex-col gap-5 rounded-lg border bg-card px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-category`}>Weakness to practise</Label>
          <select
            id={`${id}-category`}
            className={SELECT_CLASS}
            value={category ?? ''}
            disabled={running}
            onChange={(event) => {
              setCategory(event.target.value as LearningCategory);
              setOptionIndex(0);
            }}
          >
            {candidates.map((candidate) => (
              <option key={candidate.category} value={candidate.category}>
                {CATEGORY_INFO[candidate.category].label} · {candidate.errors} mistake{candidate.errors === 1 ? '' : 's'} · {STATUS_LABELS[candidate.status].toLowerCase()}
              </option>
            ))}
          </select>
          {insight ? <p className="text-xs leading-relaxed text-muted-foreground">{insight.explanation}</p> : null}
        </div>

        {options.length > 1 ? (
          <ChoiceGroup legend="Practise it in" value={Math.min(optionIndex, options.length - 1)} disabled={running} wide options={options.map((value, index) => ({ value: index, label: optionLabel(value) }))} onChange={setOptionIndex} />
        ) : option ? (
          <p className="text-sm">
            <span className="font-medium">Practised in: </span>
            {optionLabel(option)}
          </p>
        ) : null}

        <div className="grid gap-5 md:grid-cols-2">
          <ChoiceGroup legend="Difficulty" value={level} disabled={running} options={(['B2', 'C1', 'C2'] as const).map((value) => ({ value, label: value }))} onChange={setLevel} />
          {option?.module === 'grammar' ? (
            <ChoiceGroup legend="Number of questions" value={count} disabled={running} options={[4, 8, 12].map((value) => ({ value, label: String(value) }))} onChange={setCount} />
          ) : (
            <p className="text-sm text-muted-foreground">{option?.module === 'writing' ? 'One writing task (about 220 words).' : 'One speaking task (about 2 minutes).'}</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--brand)]" checked={includeExamples} disabled={running} onChange={(event) => setIncludeExamples(event.target.checked)} />
            <span>
              Include examples of my real mistakes
              <span className="block text-xs text-muted-foreground">Up to five recent, distinct mistakes with their corrections. Low-confidence evidence (spelling slips in dictation, review ratings) is never sent.</span>
            </span>
          </label>
          {targeted ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Exactly what will be sent</summary>
              <div className="mt-2 rounded-md bg-muted px-3 py-2.5 text-xs leading-relaxed">
                <p>
                  <span className="font-medium">Focus:</span> {targeted.focus}
                </p>
                <p>
                  <span className="font-medium">Description:</span> {targeted.description}
                </p>
                {targeted.examples.length > 0 ? (
                  <ul className="mt-1 list-disc pl-4">
                    {targeted.examples.map((example) => (
                      <li key={example.original}>
                        “{example.original}” → “{example.corrected}”
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-muted-foreground">No examples.</p>
                )}
                <p className="mt-1 text-muted-foreground">Plus the generator settings (level, {option?.module === 'grammar' ? 'grammar area, number of questions' : 'format and register'}).</p>
              </div>
            </details>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void generate()} disabled={!available || running || !option}>
            <Sparkles aria-hidden="true" />
            {running ? `Generating… ${elapsed}s` : 'Generate targeted practice'}
          </Button>
          {running ? (
            <Button variant="ghost" onClick={job.cancel}>
              Cancel
            </Button>
          ) : null}
        </div>
        <div aria-live="polite">
          {job.state.phase === 'failed' ? <Notice tone="error">{job.state.message}</Notice> : null}
          {job.state.phase === 'cancelled' ? <Notice>Generation cancelled. Nothing was saved.</Notice> : null}
          {saveError ? <Notice tone="error">{saveError}</Notice> : null}
          {created ? (
            <Notice tone="success">
              Saved “{created.title}” in {created.module === 'grammar' ? 'Grammar' : created.module === 'writing' ? 'Writing' : 'Speaking'}.{' '}
              <Link to={openPath(created)} className="font-medium underline">
                Open it now
              </Link>
            </Notice>
          ) : null}
        </div>
      </div>

      <PastSessions sessions={sessions} />
    </div>
  );
}

function PastSessions({ sessions }: { sessions: readonly TrainingSession[] }) {
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  return (
    <section aria-labelledby="training-history">
      <h2 id="training-history" className="mb-3 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        Targeted practice you generated
      </h2>
      <ul className="flex flex-col divide-y rounded-lg border bg-card">
        {sorted.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span className="min-w-0">
              {session.title}
              <span className="text-muted-foreground">
                {' '}
                · {CATEGORY_INFO[session.category as LearningCategory]?.label ?? session.category} · {session.level} · {formatDate(session.createdAt)}
              </span>
            </span>
            <Link to={openPath(session)} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
