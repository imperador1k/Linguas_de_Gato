import {
  ISSUE_CATEGORIES,
  formatTimestamp,
  type AssessmentDimension,
  type AssessmentIssue,
  type IssueCategory,
  type SpeakingAssessment,
} from '@ldg/shared';
import { CircleCheck, Play } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LevelLabel } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import type { Highlight } from './issue-highlights';

const CATEGORY_LABELS: Readonly<Record<IssueCategory, string>> = {
  grammar: 'Grammar',
  vocabulary: 'Vocabulary',
  coherence: 'Coherence',
  naturalness: 'Naturalness',
  task: 'Task',
};


function DimensionCard({ title, dimension }: { title: string; dimension: AssessmentDimension }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{title}</h3>
        <LevelLabel level={dimension.level} />
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{dimension.summary}</p>
      {dimension.strengths.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {dimension.strengths.map((strength) => (
            <li key={strength} className="flex gap-2">
              <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>{strength}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const SHOW_ISSUE_EVENT = 'ldg:show-speaking-issue';

export function issueAnchor(index: number): string {
  return `speaking-issue-${index + 1}`;
}

/** Moves focus to a correction from its inline marker in the transcript. */
export function focusIssue(index: number) {
  const target = document.getElementById(issueAnchor(index));
  if (!target) {
    // Hidden by a category filter: the list clears its filter, then focuses it.
    window.dispatchEvent(new CustomEvent<number>(SHOW_ISSUE_EVENT, { detail: index }));
    return;
  }
  target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
}

function IssueItem({ issue, index, onSeek }: { issue: AssessmentIssue; index: number; onSeek?: (ms: number) => void }) {
  return (
    <li id={issueAnchor(index)} tabIndex={-1} className="flex scroll-mt-24 flex-col gap-2.5 rounded-lg border px-4 py-3.5 outline-none focus:border-border-strong focus:ring-3 focus:ring-ring/30">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium tracking-[0.04em] text-muted-foreground uppercase">
          <span className="mr-1.5 font-mono text-foreground tabular-nums">{index + 1}</span>
          {CATEGORY_LABELS[issue.category]} · {issue.subcategory}
          {issue.severity === 'major' ? <span className="text-foreground"> · important</span> : null}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 font-mono text-xs tabular-nums"
          disabled={!onSeek}
          onClick={() => onSeek?.(issue.startMs)}
          aria-label={`Play your recording at ${formatTimestamp(issue.startMs / 1000)}`}
        >
          <Play aria-hidden="true" />
          {formatTimestamp(issue.startMs / 1000)}
        </Button>
      </div>
      <dl className="grid gap-1.5 font-serif text-[1.0625rem] leading-relaxed sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-x-3">
        <dt className="font-sans text-xs text-muted-foreground sm:pt-1">You said</dt>
        <dd lang="en">
          <span className="decoration-destructive/60 decoration-1 line-through">{issue.original}</span>
        </dd>
        <dt className="font-sans text-xs text-muted-foreground sm:pt-1">Correction</dt>
        <dd lang="en" className="font-medium">
          {issue.correction}
        </dd>
        {issue.advancedAlternative ? (
          <>
            <dt className="font-sans text-xs text-muted-foreground sm:pt-1">More natural</dt>
            <dd lang="en" className="italic">
              {issue.advancedAlternative}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="text-sm leading-relaxed text-muted-foreground">{issue.explanation}</p>
    </li>
  );
}

/** A transcript segment with the quoted parts of corrections marked; each mark jumps to its explanation. */
export function HighlightedText({ text, highlights }: { text: string; highlights: readonly Highlight[] }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const highlight of highlights) {
    if (highlight.start > cursor) parts.push(text.slice(cursor, highlight.start));
    parts.push(
      <mark key={highlight.index} className={cn('rounded-sm bg-transparent text-inherit underline decoration-2 underline-offset-4', highlight.major ? 'decoration-destructive/70' : 'decoration-caution/70')}>
        {text.slice(highlight.start, highlight.end)}
        <button
          type="button"
          onClick={() => focusIssue(highlight.index)}
          className="ml-0.5 inline-flex h-5 min-w-5 -translate-y-1.5 items-center justify-center rounded-sm px-1 align-baseline font-mono text-[0.6875rem] text-muted-foreground no-underline hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
          aria-label={`Correction ${highlight.index + 1}`}
        >
          {highlight.index + 1}
        </button>
      </mark>,
    );
    cursor = highlight.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

/**
 * Feedback after the learner's own transcript: what to focus on first, the
 * task, the corrections (each shown once, numbered to match the marks in the
 * transcript) and, folded away, the per-dimension notes.
 */
export function AssessmentView({ assessment, onSeek }: { assessment: SpeakingAssessment; onSeek?: (ms: number) => void }) {
  const [filter, setFilter] = useState<IssueCategory | 'all'>('all');
  const titleId = useId();
  const counts = Object.fromEntries(ISSUE_CATEGORIES.map((category) => [category, assessment.issues.filter((issue) => issue.category === category).length]));
  const indexed = assessment.issues.map((issue, index) => ({ issue, index }));
  const issues = filter === 'all' ? indexed : indexed.filter(({ issue }) => issue.category === filter);
  const major = assessment.issues.filter((issue) => issue.severity === 'major').length;

  useEffect(() => {
    const show = (event: Event) => {
      const index = (event as CustomEvent<number>).detail;
      if (!assessment.issues[index]) return;
      setFilter('all');
      requestAnimationFrame(() => focusIssue(index));
    };
    window.addEventListener(SHOW_ISSUE_EVENT, show);
    return () => window.removeEventListener(SHOW_ISSUE_EVENT, show);
  }, [assessment.issues]);
  const filters: Array<{ value: IssueCategory | 'all'; label: string; count: number }> = [
    { value: 'all', label: 'All', count: assessment.issues.length },
    ...ISSUE_CATEGORIES.filter((category) => (counts[category] ?? 0) > 0).map((category) => ({
      value: category,
      label: CATEGORY_LABELS[category],
      count: counts[category] ?? 0,
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card aria-labelledby={titleId}>
        <CardHeader>
          <CardTitle id={titleId}>Feedback</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5 pt-1">
          <p className="font-serif text-lg leading-relaxed">{assessment.overview}</p>

          {assessment.recurringPatterns.length > 0 || major > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Focus on first</h3>
              <ul className="flex flex-col gap-2">
                {assessment.recurringPatterns.map((pattern) => (
                  <li key={pattern.pattern} className="rounded-md bg-muted/60 px-3.5 py-2.5 text-sm">
                    <span className="font-medium">{pattern.pattern}.</span> <span className="text-muted-foreground">{pattern.explanation}</span>
                  </li>
                ))}
                {major > 0 ? (
                  <li className="rounded-md bg-muted/60 px-3.5 py-2.5 text-sm">
                    <span className="font-medium">
                      {major} important correction{major === 1 ? '' : 's'}
                    </span>{' '}
                    <span className="text-muted-foreground">{major === 1 ? 'is' : 'are'} underlined in red in your transcript and marked “important” below.</span>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 rounded-lg border px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-medium">Task achievement</h3>
              <LevelLabel level={assessment.taskAchievement.level} />
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{assessment.taskAchievement.summary}</p>
            {assessment.taskAchievement.addressedPoints.length + assessment.taskAchievement.missedPoints.length > 0 ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                {assessment.taskAchievement.addressedPoints.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Covered</p>
                    <ul className="flex list-disc flex-col gap-0.5 pl-5">
                      {assessment.taskAchievement.addressedPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {assessment.taskAchievement.missedPoints.length > 0 ? (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Missed or underdeveloped</p>
                    <ul className="flex list-disc flex-col gap-0.5 pl-5">
                      {assessment.taskAchievement.missedPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <details className="group rounded-lg border">
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span>By dimension: grammar, vocabulary, coherence, naturalness</span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs font-normal text-muted-foreground">
                <span className="group-open:hidden">Show</span>
                <span className="hidden group-open:inline">Hide</span>
              </span>
            </summary>
            <div className="grid gap-3 border-t p-3 md:grid-cols-2">
              <DimensionCard title="Grammar and accuracy" dimension={assessment.grammar} />
              <DimensionCard title="Vocabulary" dimension={assessment.vocabulary} />
              <DimensionCard title="Coherence and organisation" dimension={assessment.coherence} />
              <DimensionCard title="Naturalness" dimension={assessment.naturalness} />
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Corrections and better expressions</CardTitle>
          <CardDescription>Numbered to match the marks in your transcript. A correction fixes an error; “more natural” is an optional upgrade.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-1">
          {assessment.issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">No specific corrections: nothing in the transcript needed one.</p>
          ) : (
            <>
              <div role="group" aria-label="Filter corrections" className="flex flex-wrap gap-2">
                {filters.map((option) => (
                  <Button
                    key={option.value}
                    variant={filter === option.value ? 'primary' : 'secondary'}
                    size="sm"
                    aria-pressed={filter === option.value}
                    onClick={() => setFilter(option.value)}
                  >
                    {option.label}
                    <span className="font-mono text-xs tabular-nums opacity-70">{option.count}</span>
                  </Button>
                ))}
              </div>
              <ol className="flex flex-col gap-3">
                {issues.map(({ issue, index }) => (
                  <IssueItem key={`${issue.segmentId}-${issue.original}-${index}`} issue={issue} index={index} onSeek={onSeek} />
                ))}
              </ol>
            </>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Written by an AI model, which can be wrong. Every correction quotes your confirmed transcript; suggestions whose quotes
            didn't match it were withheld
            {assessment.discarded.issues + assessment.discarded.exercises > 0
              ? ` (${assessment.discarded.issues + assessment.discarded.exercises} this time)`
              : ''}
            . Pronunciation isn't assessed: a transcript can't show it.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
