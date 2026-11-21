import { CATEGORY_INFO, errorTimeline, trainingOptionsFor, type CategoryInsight, type LearningObservation } from '@ldg/shared';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router';
import { Sparkline } from '@/features/progress/activity-chart';
import { CONFIDENCE_LABELS, EVIDENCE_LABELS, KIND_LABELS, MODULE_LABELS, STATUS_LABELS, TREND_LABELS, formatDate } from '@/features/progress/format';
import { Badge } from '@/components/ui/badge';

// A recurring pattern is something to work on, not an error in itself: caution, not red.
const STATUS_VARIANT = { recurring: 'caution', preliminary: 'outline', improving: 'success', strength: 'success', insufficient: 'neutral' } as const;

export function EvidenceList({ observations }: { observations: readonly LearningObservation[] }) {
  if (observations.length === 0) return <p className="text-sm text-muted-foreground">No examples recorded.</p>;
  return (
    <ul className="flex flex-col divide-y rounded-md border">
      {observations.map((observation) => (
        <li key={observation.id} className="flex flex-col gap-1.5 px-3 py-2.5 text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant={observation.kind === 'correct' ? 'success' : observation.kind === 'suggestion' ? 'neutral' : 'destructive'}>{KIND_LABELS[observation.kind]}</Badge>
            <span>{MODULE_LABELS[observation.module]}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(observation.occurredAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{EVIDENCE_LABELS[observation.evidence]}</span>
            <span aria-hidden="true">·</span>
            <span>{CONFIDENCE_LABELS[observation.confidence].toLowerCase()}</span>
          </div>
          {observation.original || observation.corrected ? (
            <p className="leading-relaxed">
              {observation.original ? <span className={observation.kind === 'correct' ? '' : 'line-through decoration-destructive/60'}>{observation.original}</span> : null}
              {observation.original && observation.corrected && observation.kind !== 'correct' ? <span className="text-muted-foreground"> → </span> : null}
              {observation.corrected && observation.kind !== 'correct' ? <span className="font-medium">{observation.corrected}</span> : null}
            </p>
          ) : null}
          {observation.note ? <p className="text-muted-foreground">{observation.note}</p> : null}
          <Link to={observation.sourcePath} className="inline-flex w-fit items-center gap-1 text-xs text-brand hover:underline">
            Open “{observation.sourceLabel}”
            <ArrowUpRight aria-hidden="true" className="size-3" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function InsightCard({ insight, observations, allObservations, now }: { insight: CategoryInsight; observations: readonly LearningObservation[]; allObservations: readonly LearningObservation[]; now: number }) {
  const info = CATEGORY_INFO[insight.category];
  const timeline = errorTimeline(allObservations, insight.category, now, 12);
  const trainable = trainingOptionsFor(insight.category).length > 0 && insight.errors > 0;
  return (
    <li className="rounded-lg border bg-card">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{info.label}</h3>
              <Badge variant={STATUS_VARIANT[insight.status]}>{STATUS_LABELS[insight.status]}</Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{insight.explanation}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
            {insight.errors > 0 ? <Sparkline values={timeline} label={`Mistakes per week over the last 12 weeks: ${timeline.join(', ')}`} /> : null}
            <span className="group-open:hidden">Show evidence</span>
            <span className="hidden group-open:inline">Hide evidence</span>
          </div>
        </summary>
        <div className="flex flex-col gap-3 border-t px-4 py-3.5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Mistakes</dt>
              <dd className="tabular-nums">
                {insight.errors}
                {insight.highSeverity > 0 ? ` (${insight.highSeverity} serious)` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Correct answers</dt>
              <dd className="tabular-nums">{insight.successes}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pieces of work</dt>
              <dd className="tabular-nums">{insight.sources}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last mistake</dt>
              <dd>{insight.lastErrorAt ? formatDate(insight.lastErrorAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last 30 days / before</dt>
              <dd className="tabular-nums">
                {insight.recentErrors} / {insight.earlierErrors}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Trend</dt>
              <dd>{TREND_LABELS[insight.trend]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Evidence</dt>
              <dd>{CONFIDENCE_LABELS[insight.confidence]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Modules</dt>
              <dd>{insight.modules.map((module) => MODULE_LABELS[module]).join(', ') || '—'}</dd>
            </div>
          </dl>
          {insight.suggestions > 0 ? <p className="text-xs text-muted-foreground">{insight.suggestions} stylistic suggestion(s) in this area are listed below but never counted as mistakes.</p> : null}
          <p className="text-xs text-muted-foreground">{info.description}</p>
          <EvidenceList observations={observations} />
          {trainable ? (
            <Link to={`/progress/training?category=${insight.category}`} className="w-fit text-sm font-medium text-brand hover:underline">
              Practise {info.label.toLowerCase()} with targeted exercises
            </Link>
          ) : null}
        </div>
      </details>
    </li>
  );
}
