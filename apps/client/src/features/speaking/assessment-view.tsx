import {
  ISSUE_CATEGORIES,
  formatTimestamp,
  type AssessmentDimension,
  type AssessmentIssue,
  type AssessmentLevel,
  type IssueCategory,
  type SpeakingAssessment,
} from '@ldg/shared';
import { CircleAlert, CircleCheck, CircleDot, Play } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const LEVELS: Readonly<Record<AssessmentLevel, { label: string; icon: typeof CircleCheck; className: string }>> = {
  strong: { label: 'Strong', icon: CircleCheck, className: 'text-success' },
  developing: { label: 'Developing', icon: CircleDot, className: 'text-brand' },
  needs_attention: { label: 'Needs attention', icon: CircleAlert, className: 'text-destructive' },
};

const CATEGORY_LABELS: Readonly<Record<IssueCategory, string>> = {
  grammar: 'Grammar',
  vocabulary: 'Vocabulary',
  coherence: 'Coherence',
  naturalness: 'Naturalness',
  task: 'Task',
};

/** Icon + word, never colour alone. */
export function LevelLabel({ level }: { level: AssessmentLevel }) {
  const { label, icon: Icon, className } = LEVELS[level];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', className)}>
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </span>
  );
}

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

function IssueItem({ issue, onSeek }: { issue: AssessmentIssue; onSeek?: (ms: number) => void }) {
  return (
    <li className="flex flex-col gap-2.5 rounded-lg border px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium tracking-[0.04em] text-muted-foreground uppercase">
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

export function AssessmentView({ assessment, onSeek }: { assessment: SpeakingAssessment; onSeek?: (ms: number) => void }) {
  const [filter, setFilter] = useState<IssueCategory | 'all'>('all');
  const titleId = useId();
  const counts = Object.fromEntries(ISSUE_CATEGORIES.map((category) => [category, assessment.issues.filter((issue) => issue.category === category).length]));
  const issues = filter === 'all' ? assessment.issues : assessment.issues.filter((issue) => issue.category === filter);
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

          <div className="grid gap-3 md:grid-cols-2">
            <DimensionCard title="Grammar and accuracy" dimension={assessment.grammar} />
            <DimensionCard title="Vocabulary" dimension={assessment.vocabulary} />
            <DimensionCard title="Coherence and organisation" dimension={assessment.coherence} />
            <DimensionCard title="Naturalness" dimension={assessment.naturalness} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Corrections and better expressions</CardTitle>
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
                {issues.map((issue, index) => (
                  <IssueItem key={`${issue.segmentId}-${issue.original}-${index}`} issue={issue} onSeek={onSeek} />
                ))}
              </ol>
            </>
          )}

          {assessment.recurringPatterns.length > 0 ? (
            <div>
              <h3 className="mb-2 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Recurring patterns</h3>
              <ul className="flex flex-col gap-2">
                {assessment.recurringPatterns.map((pattern) => (
                  <li key={pattern.pattern} className="rounded-md bg-muted/60 px-3.5 py-2.5 text-sm">
                    <span className="font-medium">{pattern.pattern}.</span> <span className="text-muted-foreground">{pattern.explanation}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
