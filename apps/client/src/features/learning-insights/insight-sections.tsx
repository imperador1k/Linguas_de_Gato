import { CATEGORY_INFO, INSIGHT_THRESHOLDS, SKILL_AREAS, type CategoryInsight, type SkillArea } from '@ldg/shared';
import { SectionHeading } from '@/components/layout/page-header';
import type { DerivedLearning } from '@/features/progress/use-learning-engine';
import { InsightCard } from './insight-card';

const AREA_LABELS: Record<SkillArea, string> = { grammar: 'Grammar', vocabulary: 'Vocabulary', discourse: 'Organisation and task', accuracy: 'Spelling and punctuation', listening: 'Listening', reading: 'Reading' };

function InsightList({ insights, derived }: { insights: readonly CategoryInsight[]; derived: DerivedLearning }) {
  return (
    <ul className="flex flex-col gap-3">
      {insights.map((insight) => (
        <InsightCard
          key={insight.category}
          insight={insight}
          observations={insight.observationIds.flatMap((id) => derived.byId.get(id) ?? [])}
          allObservations={derived.extraction.observations}
          now={derived.now}
        />
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed px-4 py-6 text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function RecurringErrorsSection({ derived }: { derived: DerivedLearning }) {
  const negatives = derived.insights.filter((insight) => insight.errors > 0);
  const patterns = negatives.filter((insight) => insight.status === 'recurring' || insight.status === 'preliminary');
  const single = negatives.filter((insight) => insight.status === 'insufficient');
  const { excluded } = derived.extraction;

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        A mistake becomes <strong className="font-medium text-foreground">recurring</strong> after at least {INSIGHT_THRESHOLDS.recurringErrors} of them in {INSIGHT_THRESHOLDS.recurringSources} or more pieces of work, the latest within{' '}
        {INSIGHT_THRESHOLDS.recurringRecencyDays} days. From {INSIGHT_THRESHOLDS.preliminaryErrors} mistakes it is shown as <strong className="font-medium text-foreground">preliminary</strong>. One mistake alone is never treated as a weakness. Open any area to see every example and where it came from.
      </p>

      <section aria-labelledby="errors-patterns">
        <SectionHeading id="errors-patterns">Patterns</SectionHeading>
        {patterns.length > 0 ? <InsightList insights={patterns} derived={derived} /> : <Empty>No repeated mistakes yet. As feedback, checked exercises and dictation build up, patterns will appear here with their evidence.</Empty>}
      </section>

      {single.length > 0 ? (
        <section aria-labelledby="errors-single">
          <SectionHeading id="errors-single">Not enough evidence yet</SectionHeading>
          <InsightList insights={single} derived={derived} />
        </section>
      ) : null}

      <section aria-labelledby="errors-excluded" className="rounded-lg border bg-card px-4 py-4 text-sm">
        <h3 id="errors-excluded" className="font-medium">
          Deliberately not counted
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{excluded.recognitionCorrections} speech-recognition fixes you made to Whisper transcripts (the app misheard you; these are not your mistakes).</li>
          <li>{excluded.duplicateCorrections} repeated corrections of the same words within one piece of feedback (counted once).</li>
          <li>{excluded.uncheckedRounds} exercise rounds you have not checked or submitted yet.</li>
          <li>{excluded.acceptedBySecondOpinion} grammar answers accepted on a second opinion.</li>
          <li>{excluded.unratedShortAnswers} short answers you have not rated yet.</li>
          <li>Stylistic suggestions from writing feedback, and feedback that failed validation (never saved).</li>
        </ul>
      </section>
    </div>
  );
}

export function SkillsSection({ derived }: { derived: DerivedLearning }) {
  if (derived.insights.length === 0) {
    return <Empty>Nothing to show yet. Each skill area fills in from checked exercises, assessed recordings and writing, dictation and reviews.</Empty>;
  }
  const strengths = derived.insights.filter((insight) => insight.status === 'strength');
  const improving = derived.insights.filter((insight) => insight.status === 'improving');
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="skills-strengths">
        <SectionHeading id="skills-strengths">Strengths and improvements</SectionHeading>
        {strengths.length + improving.length > 0 ? (
          <InsightList insights={[...improving, ...strengths]} derived={derived} />
        ) : (
          <Empty>
            No strengths or improvements established yet. A strength needs at least {INSIGHT_THRESHOLDS.strengthSuccesses} correct answers from {INSIGHT_THRESHOLDS.strengthSources} or more pieces of work with an error rate of{' '}
            {Math.round(INSIGHT_THRESHOLDS.strengthMaxErrorRate * 100)}% or less; an improvement needs clearly fewer mistakes in the last {INSIGHT_THRESHOLDS.recentWindowDays} days than before.
          </Empty>
        )}
      </section>
      {SKILL_AREAS.map((area) => {
        const insights = derived.insights.filter((insight) => CATEGORY_INFO[insight.category].area === area);
        return (
          <section key={area} aria-labelledby={`skills-${area}`}>
            <SectionHeading id={`skills-${area}`}>{AREA_LABELS[area]}</SectionHeading>
            {insights.length > 0 ? <InsightList insights={insights} derived={derived} /> : <Empty>No evidence in this area yet.</Empty>}
          </section>
        );
      })}
    </div>
  );
}
