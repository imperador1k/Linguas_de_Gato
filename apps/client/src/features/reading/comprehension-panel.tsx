import {
  READING_LEVELS,
  READING_QUESTION_TYPES,
  READING_RECORD_VERSION,
  readingOutcome,
  summarizeReadingResults,
  withReadingAnswer,
  type ReadingAnswer,
  type ReadingLevel,
  type ReadingQuestion,
  type ReadingQuestionSet,
  type ReadingQuestionType,
  type ReadingTextRecord,
} from '@ldg/shared';
import { CircleCheck, CircleDashed, CircleX, Eye, LoaderCircle, Plus, RotateCcw, Sparkles, Trash } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckGroup, ChoiceGroup, FIELD_CLASS } from '@/components/ui/choice-group';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { useElapsedSeconds } from '@/lib/use-elapsed-seconds';
import { useGenerationJob } from '@/lib/use-generation-job';
import { cn } from '@/lib/utils';
import { QUESTION_TYPE_LABELS } from './reading-labels';
import { listQuestionSets, type ReadingRepository } from './storage/reading-repository';

export interface EvidenceTarget {
  readonly paragraphIndex: number;
  readonly start: number | null;
  readonly end: number | null;
}

const OUTCOME = {
  correct: { label: 'Correct', icon: CircleCheck, className: 'text-success' },
  partly: { label: 'Partly right', icon: CircleDashed, className: 'text-caution' },
  incorrect: { label: 'Not quite', icon: CircleX, className: 'text-destructive' },
  unanswered: { label: 'Not answered', icon: CircleDashed, className: 'text-muted-foreground' },
  unrated: { label: 'Compare your answer', icon: CircleDashed, className: 'text-muted-foreground' },
} as const;

function Generator({ text, repository, onCreated, onCancel }: { text: ReadingTextRecord; repository: ReadingRepository; onCreated: (set: ReadingQuestionSet) => void; onCancel?: () => void }) {
  const job = useGenerationJob();
  const [level, setLevel] = useState<ReadingLevel>(text.level ?? 'C1');
  const [types, setTypes] = useState<ReadingQuestionType[]>(['main_idea', 'detail', 'inference', 'author_intention', 'vocabulary_in_context']);
  const [count, setCount] = useState(6);
  const [error, setError] = useState<string | null>(null);
  const running = job.state.phase === 'running';
  const elapsed = useElapsedSeconds(job.state.phase === 'running' ? job.state.startedAt : null);

  async function generate() {
    setError(null);
    const response = await job.start({ kind: 'reading_questions', level, questionCount: count, types, title: text.title, paragraphs: text.paragraphs });
    if (!response || response.result.kind !== 'reading_questions') return;
    const now = Date.now();
    const set: ReadingQuestionSet = {
      id: crypto.randomUUID(),
      version: READING_RECORD_VERSION,
      textId: text.id,
      level,
      types,
      questions: response.result.questions,
      discarded: response.result.discarded,
      model: response.model,
      answers: [],
      submittedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await repository.questionSets.put(set);
      onCreated(set);
    } catch (caught) {
      setError(describeStorageFailure(caught));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <ChoiceGroup legend="Target level" value={level} disabled={running} options={READING_LEVELS.map((value) => ({ value, label: value }))} onChange={setLevel} />
      <CheckGroup
        legend="Question types"
        values={types}
        disabled={running}
        options={READING_QUESTION_TYPES.map((value) => ({ value, label: QUESTION_TYPE_LABELS[value].label, hint: QUESTION_TYPE_LABELS[value].hint }))}
        onChange={setTypes}
      />
      <ChoiceGroup legend="Number of questions" value={count} disabled={running} options={[4, 6, 8, 10].map((value) => ({ value, label: <span className="font-mono tabular-nums">{value}</span> }))} onChange={setCount} />
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
              Generate questions
            </Button>
            {onCancel ? (
              <Button variant="ghost" onClick={onCancel}>
                Back
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
      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <p className="text-xs text-muted-foreground">The text is sent to Groq. Every question must quote the text; questions whose evidence can't be found, or whose answer just copies a sentence, are left out.</p>
    </div>
  );
}

function QuestionCard({
  question,
  number,
  answer,
  submitted,
  onAnswer,
  onShowEvidence,
}: {
  question: ReadingQuestion;
  number: number;
  answer: ReadingAnswer | undefined;
  submitted: boolean;
  onAnswer: (answer: ReadingAnswer) => void;
  onShowEvidence: (target: EvidenceTarget) => void;
}) {
  const id = useId();
  const outcome = readingOutcome(question, answer);
  const Outcome = OUTCOME[outcome];
  const shortText = answer?.format === 'short_answer' ? answer.text : '';
  const [draft, setDraft] = useState(shortText);
  useEffect(() => setDraft(shortText), [shortText]);

  return (
    <li className="flex flex-col gap-3 rounded-lg border px-4 py-4" aria-labelledby={`${id}-q`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">Q{number}</span>
        <Badge variant="neutral">{QUESTION_TYPE_LABELS[question.type].label}</Badge>
        {submitted ? (
          <span className={cn('ml-auto inline-flex items-center gap-1 font-medium', Outcome.className)}>
            <Outcome.icon aria-hidden="true" className="size-4" />
            {Outcome.label}
          </span>
        ) : null}
      </div>
      <p id={`${id}-q`} className="leading-relaxed font-medium">
        {question.question}
      </p>
      {question.format === 'multiple_choice' ? (
        <fieldset disabled={submitted} aria-labelledby={`${id}-q`} className="flex flex-col gap-2">
          {question.options.map((option, index) => {
            const selected = answer?.format === 'multiple_choice' && answer.selectedIndex === index;
            const isKey = submitted && index === question.correctOptionIndex;
            return (
              <label
                key={option}
                className={cn(
                  'flex items-start gap-3 rounded-md border px-3.5 py-2.5 text-sm leading-relaxed has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                  !submitted && (selected ? 'cursor-pointer border-foreground bg-accent/60' : 'cursor-pointer border-input hover:border-border-strong'),
                  isKey && 'border-success bg-success-subtle',
                  submitted && selected && !isKey && 'border-destructive bg-destructive-subtle',
                )}
              >
                <input type="radio" name={`${id}-o`} checked={selected} onChange={() => onAnswer({ format: 'multiple_choice', questionId: question.id, selectedIndex: index })} className="mt-1 size-4 accent-[var(--brand)]" />
                <span className="min-w-0 flex-1">
                  {option}
                  {isKey ? <span className="mt-0.5 block text-xs font-medium text-success">Correct answer</span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-a`} className="sr-only">
            Your answer to question {number}
          </label>
          <AutoGrowTextarea
            id={`${id}-a`}
            value={draft}
            disabled={submitted}
            maxLength={1000}
            placeholder="Answer in your own words"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => draft !== shortText && onAnswer({ format: 'short_answer', questionId: question.id, text: draft, selfAssessment: null })}
            className={FIELD_CLASS}
          />
          {submitted ? (
            <div className="flex flex-col gap-2 rounded-md bg-muted/50 px-3.5 py-3">
              <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Accepted answers</p>
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
                {question.acceptedAnswers.map((accepted) => (
                  <li key={accepted}>{accepted}</li>
                ))}
              </ul>
              {shortText.trim() !== '' ? (
                <div role="group" aria-label={`How well did you answer question ${number}?`} className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-sm">How did you do?</span>
                  {(['correct', 'partly', 'incorrect'] as const).map((value) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={answer?.format === 'short_answer' && answer.selfAssessment === value ? 'primary' : 'secondary'}
                      aria-pressed={answer?.format === 'short_answer' && answer.selfAssessment === value}
                      onClick={() => onAnswer({ format: 'short_answer', questionId: question.id, text: shortText, selfAssessment: value })}
                    >
                      {value === 'correct' ? 'Got it' : value === 'partly' ? 'Partly' : 'Missed it'}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      {submitted ? (
        <div className="flex flex-col gap-2.5">
          <p className="text-sm leading-relaxed">
            <span className="font-medium">Why: </span>
            {question.explanation}
          </p>
          <figure className="rounded-md border-l-2 border-brand bg-muted/50 px-3.5 py-2.5">
            <figcaption className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              From paragraph {question.paragraphIndex + 1}
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onShowEvidence({ paragraphIndex: question.paragraphIndex, start: question.start, end: question.end })}>
                <Eye aria-hidden="true" />
                Show in text
              </Button>
            </figcaption>
            <blockquote className="font-serif text-[0.9375rem] leading-relaxed">“{question.evidenceQuote}”</blockquote>
          </figure>
        </div>
      ) : null}
    </li>
  );
}

/** Comprehension questions for a text: generate, answer, check, review with evidence, retry, delete. */
export function ComprehensionPanel({ text, repository, available, onShowEvidence }: { text: ReadingTextRecord; repository: ReadingRepository; available: boolean; onShowEvidence: (target: EvidenceTarget) => void }) {
  const [sets, setSets] = useState<ReadingQuestionSet[] | null>(null);
  const [activeId, setActiveId] = useState<string | null | 'new'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'check' | 'retry' | 'delete' | null>(null);
  const setsRef = useRef<ReadingQuestionSet[]>([]);

  const replaceSets = (next: ReadingQuestionSet[]) => {
    setsRef.current = next;
    setSets(next);
  };

  useEffect(() => {
    let active = true;
    listQuestionSets(repository, text.id).then(
      (loaded) => active && replaceSets(loaded),
      (caught: unknown) => {
        if (!active) return;
        setError(describeStorageFailure(caught));
        replaceSets([]);
      },
    );
    return () => {
      active = false;
    };
  }, [repository, text.id]);

  const update = useCallback(
    (id: string, change: (set: ReadingQuestionSet) => ReadingQuestionSet) => {
      const current = setsRef.current.find((set) => set.id === id);
      if (!current) return;
      const next = change(current);
      if (next === current) return;
      replaceSets(setsRef.current.map((set) => (set.id === id ? next : set)));
      repository.questionSets.put(next).catch((caught: unknown) => setError(describeStorageFailure(caught)));
    },
    [repository],
  );

  if (sets === null) return null;
  const active = activeId === 'new' ? null : (sets.find((set) => set.id === activeId) ?? sets[0] ?? null);

  if (!active) {
    if (!available) {
      return (
        <Notice>
          Generating questions needs a Groq API key in <code className="font-mono text-xs">apps/server/.env</code>.
        </Notice>
      );
    }
    return (
      <Generator
        text={text}
        repository={repository}
        onCreated={(set) => {
          replaceSets([set, ...setsRef.current]);
          setActiveId(set.id);
        }}
        onCancel={sets.length > 0 ? () => setActiveId(sets[0]?.id ?? null) : undefined}
      />
    );
  }

  const submitted = active.submittedAt !== null;
  const summary = summarizeReadingResults(active);
  const byQuestion = new Map(active.answers.map((answer) => [answer.questionId, answer]));
  const unanswered = summary.total - summary.answered;

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Notice tone="error" role="alert">
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="brand">AI-generated</Badge>
        <Badge variant="outline">{active.level}</Badge>
        <span className="text-xs text-muted-foreground">{active.questions.length} questions</span>
        <div className="ml-auto flex gap-1">
          {available ? (
            <Button variant="ghost" size="sm" onClick={() => setActiveId('new')}>
              <Plus aria-hidden="true" />
              New set
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" aria-label="Delete this question set" onClick={() => setConfirm('delete')}>
            <Trash aria-hidden="true" />
          </Button>
        </div>
      </div>
      {sets.length > 1 ? (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Set</span>
          <select value={active.id} onChange={(event) => setActiveId(event.target.value)} className="h-9 rounded-md border border-input bg-card px-2 text-sm">
            {sets.map((set, index) => (
              <option key={set.id} value={set.id}>
                {sets.length - index}. {set.level} · {set.questions.length} questions{set.submittedAt ? ' · checked' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {submitted ? (
        <div className="rounded-lg border px-4 py-3">
          <p className="font-medium">
            {summary.unrated > 0 ? `Rate your short answers (${summary.unrated} left)` : `${summary.correct} correct${summary.partly ? `, ${summary.partly} partly` : ''} of ${summary.total}`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">Use “Show in text” to reread the passage each answer comes from.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You can look back at the text while answering. Answers are saved as you go; explanations appear when you check.</p>
      )}
      <ol className="flex flex-col gap-3">
        {active.questions.map((question, index) => (
          <QuestionCard
            key={`${active.id}-${question.id}`}
            question={question}
            number={index + 1}
            answer={byQuestion.get(question.id)}
            submitted={submitted}
            onAnswer={(answer) => update(active.id, (current) => withReadingAnswer(current, answer, Date.now()))}
            onShowEvidence={onShowEvidence}
          />
        ))}
      </ol>
      {active.discarded > 0 ? <p className="text-xs text-muted-foreground">{active.discarded} generated question{active.discarded === 1 ? ' was' : 's were'} left out because the evidence or answer didn't check out against the text.</p> : null}
      <div>
        {submitted ? (
          <Button variant="secondary" onClick={() => setConfirm('retry')}>
            <RotateCcw aria-hidden="true" />
            Answer again
          </Button>
        ) : (
          <Button onClick={() => (unanswered > 0 ? setConfirm('check') : update(active.id, (current) => ({ ...current, submittedAt: Date.now(), updatedAt: Date.now() })))}>Check answers</Button>
        )}
      </div>

      <ConfirmDialog
        open={confirm === 'check'}
        title="Check your answers now?"
        description={`${unanswered} question${unanswered === 1 ? ' has' : 's have'} no answer yet. Answers are locked once checked.`}
        confirmLabel="Check answers"
        onConfirm={() => {
          setConfirm(null);
          update(active.id, (current) => ({ ...current, submittedAt: Date.now(), updatedAt: Date.now() }));
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'retry'}
        title="Answer these questions again?"
        description="Your answers and results for this set will be cleared."
        confirmLabel="Start again"
        onConfirm={() => {
          setConfirm(null);
          update(active.id, (current) => ({ ...current, answers: [], submittedAt: null, updatedAt: Date.now() }));
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete this question set?"
        description="Its questions and your answers are removed from this browser."
        confirmLabel="Delete set"
        destructive
        onConfirm={() => {
          setConfirm(null);
          repository.questionSets.delete(active.id).then(
            () => {
              replaceSets(setsRef.current.filter((set) => set.id !== active.id));
              setActiveId(null);
            },
            (caught: unknown) => setError(describeStorageFailure(caught)),
          );
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
