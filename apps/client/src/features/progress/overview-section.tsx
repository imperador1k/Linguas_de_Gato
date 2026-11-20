import { METRIC_DEFINITIONS, RANGE_PRESETS, activitySeries, computeMetrics, rangeFor, type LearningSnapshot, type RangePreset } from '@ldg/shared';
import { useMemo, type ReactNode } from 'react';
import { SectionHeading } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { ActivityChart } from './activity-chart';
import { formatDuration, formatRatio, plural } from './format';

const RANGE_LABELS: Record<RangePreset, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' };

/** One metric: its value, how many items it rests on, and its definition, always one click away. */
export function Metric({ label, value, detail, definition, kind }: { label: string; value: ReactNode; detail?: ReactNode; definition: string; kind?: 'measured' | 'estimated' }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        {kind === 'measured' ? <Badge variant="success">Measured</Badge> : kind === 'estimated' ? <Badge variant="outline">Estimate</Badge> : null}
      </div>
      <p className="text-2xl font-medium tabular-nums">{value}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">How is this counted?</summary>
        <p className="mt-1 leading-relaxed text-muted-foreground">{definition}</p>
      </details>
    </div>
  );
}

export function OverviewSection({ snapshot, now, preset, onPreset }: { snapshot: LearningSnapshot; now: number; preset: RangePreset; onPreset: (value: RangePreset) => void }) {
  const range = rangeFor(preset, now);
  const metrics = useMemo(() => computeMetrics(snapshot, range), [snapshot, range.from, range.to]);
  const series = useMemo(() => activitySeries(snapshot, range, now), [snapshot, range.from, range.to, now]);
  const { listening, speaking, writing, grammar, reading, vocabulary } = metrics.modules;
  const totalDays = range.from === null ? null : Math.round((range.to - range.from) / 86_400_000);
  const weekly = series.length > 1 && (series[1]?.start ?? 0) - (series[0]?.start ?? 0) > 2 * 86_400_000;

  return (
    <div className="flex flex-col gap-8">
      <ChoiceGroup legend="Period" value={preset} options={RANGE_PRESETS.map((value) => ({ value, label: RANGE_LABELS[value] }))} onChange={onPreset} />

      {metrics.events === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
          No practice recorded {preset === 'all' ? 'yet' : `in the last ${RANGE_LABELS[preset]}`}. Figures appear here as you complete dictation, exercises, recordings, texts and reviews.
        </p>
      ) : null}

      <section aria-labelledby="overview-activity" className="flex flex-col gap-3">
        <SectionHeading id="overview-activity" className="mb-0">
          Activity
        </SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Active study days" value={metrics.activeDays} detail={totalDays ? `out of ${totalDays} days` : 'since your first activity'} definition={METRIC_DEFINITIONS.activeDays} />
          <Metric label="Completed exercises" value={metrics.completedExercises} detail={`${plural(metrics.events, 'practice action')} in total`} definition={METRIC_DEFINITIONS.completedExercises} />
          <Metric label="Speaking recorded" value={formatDuration(speaking.recordedMs)} detail={`${speaking.attempts} recording${speaking.attempts === 1 ? '' : 's'}`} definition={METRIC_DEFINITIONS.recordedTime} kind="measured" />
          <Metric
            label="Timed writing"
            value={formatDuration(writing.timedMs)}
            detail={`timer used in ${writing.timedSubmissions} of ${writing.submissions} submissions`}
            definition={METRIC_DEFINITIONS.timedWriting}
            kind="measured"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          There is no total study time: the app measures only recordings and the optional writing timer, and never guesses the rest.
        </p>
        <div className="rounded-lg border bg-card px-4 py-4">
          <h3 className="mb-2 text-sm font-medium">Practice actions per {weekly ? 'week' : 'day'}</h3>
          <ActivityChart buckets={series} weekly={weekly} />
        </div>
      </section>

      <section aria-labelledby="overview-results" className="flex flex-col gap-3">
        <SectionHeading id="overview-results" className="mb-0">
          Results by module
        </SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric
            label="Dictation accuracy"
            value={listening.meanDictationAccuracy === null ? 'No data' : `${Math.round(listening.meanDictationAccuracy * 100)}%`}
            detail={`${plural(listening.dictationAttempts, 'attempt')} on ${plural(listening.linesPractised, 'line')}`}
            definition={METRIC_DEFINITIONS.dictationAccuracy}
          />
          <Metric
            label="Listening comprehension"
            value={formatRatio(listening.comprehension)}
            detail={`${listening.comprehension.correct} of ${listening.comprehension.total} answers · ${plural(listening.comprehensionSetsChecked, 'set')}`}
            definition={METRIC_DEFINITIONS.comprehension}
          />
          <Metric
            label="Grammar accuracy"
            value={formatRatio(grammar.answers)}
            detail={`${grammar.answers.correct} of ${grammar.answers.total} questions · ${plural(grammar.roundsChecked, 'round')}`}
            definition={METRIC_DEFINITIONS.grammarAccuracy}
          />
          <Metric
            label="Reading comprehension"
            value={formatRatio(reading.comprehension)}
            detail={`${reading.comprehension.correct} of ${reading.comprehension.total} answers · ${plural(reading.comprehensionSetsChecked, 'set')}`}
            definition={METRIC_DEFINITIONS.comprehension}
          />
          <Metric
            label="Texts finished"
            value={reading.textsFinished}
            detail={`${reading.textsAdded} added · about ${reading.estimatedReadingMinutes} min of reading`}
            definition={`${METRIC_DEFINITIONS.estimatedReading} Texts count as finished when you mark them so.`}
            kind="estimated"
          />
          <Metric
            label="Writing feedback"
            value={plural(writing.verifiedErrors, 'error')}
            detail={`${writing.assessed} of ${writing.submissions} submissions assessed · ${writing.words} words · ${plural(writing.suggestions, 'suggestion')} kept apart`}
            definition={METRIC_DEFINITIONS.verifiedErrors}
          />
          <Metric
            label="Speaking feedback"
            value={plural(speaking.verifiedErrors, 'error')}
            detail={`${speaking.assessed} of ${speaking.attempts} recordings assessed`}
            definition={`${METRIC_DEFINITIONS.verifiedErrors} Corrections you made to the Whisper transcript are recognition fixes, not your mistakes, and are never counted.`}
          />
          <Metric
            label="Vocabulary reviews"
            value={vocabulary.reviews}
            detail={`${vocabulary.reviewsRemembered} remembered · ${plural(vocabulary.entriesSaved, 'expression')} and ${plural(vocabulary.meaningsSaved, 'meaning')} saved`}
            definition={METRIC_DEFINITIONS.vocabularyReviews}
          />
          <Metric
            label="Vocabulary practice"
            value={formatRatio(vocabulary.practiceObjective)}
            detail={`${vocabulary.practiceObjective.correct} of ${vocabulary.practiceObjective.total} objective answers · ${plural(vocabulary.practiceRoundsChecked, 'round')}`}
            definition={METRIC_DEFINITIONS.practiceAccuracy}
          />
        </div>
        <p className="text-xs text-muted-foreground">There is no combined score and no CEFR level here: these figures describe your practice, they do not certify a level.</p>
      </section>
    </div>
  );
}
