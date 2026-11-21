import { LEARNING_RECORD_VERSION, type Recommendation, type RecommendationState } from '@ldg/shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { SectionHeading } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { formatDate } from '@/features/progress/format';
import type { LearningRepository } from '@/features/progress/storage/learning-repository';
import type { DerivedLearning } from '@/features/progress/use-learning-engine';
import { describeStorageFailure } from '@/lib/storage/feature-storage';
import { EvidenceList } from './insight-card';

function RecommendationCard({ recommendation, derived, busy, onAct }: { recommendation: Recommendation; derived: DerivedLearning; busy: boolean; onAct: (status: RecommendationState['status']) => void }) {
  const evidence = recommendation.observationIds.slice(0, 8).flatMap((id) => derived.byId.get(id) ?? []);
  const action = recommendation.action;
  return (
    <li className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{recommendation.title}</h3>
        {recommendation.preliminary ? <Badge variant="outline">Preliminary</Badge> : null}
        {recommendation.returned ? <Badge variant="neutral">Back: new evidence</Badge> : null}
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">{recommendation.rationale}</p>
      <p className="text-sm leading-relaxed">
        <span className="font-medium">Next step: </span>
        {recommendation.nextStep}
      </p>
      {evidence.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Why this? See {evidence.length} example{evidence.length === 1 ? '' : 's'}</summary>
          <div className="mt-2">
            <EvidenceList observations={evidence} />
          </div>
        </details>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {action.type === 'train' ? (
          <Link to={`/progress/training?category=${action.category}`} className={buttonVariants({ size: 'sm' })}>
            Practise this
          </Link>
        ) : (
          <Link to={action.path} className={buttonVariants({ size: 'sm' })}>
            {action.label}
          </Link>
        )}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAct('completed')}>
          Mark as done
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAct('dismissed')}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

export function RecommendationsSection({ derived, repository, onChanged }: { derived: DerivedLearning; repository: LearningRepository; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { active, hidden } = derived.recommendations;

  async function act(recommendation: Recommendation, status: RecommendationState['status']) {
    setBusy(true);
    setError(null);
    try {
      await repository.recommendations.put({ id: recommendation.id, version: LEARNING_RECORD_VERSION, status, evidenceAt: recommendation.evidenceAt, updatedAt: Date.now() });
      onChanged();
    } catch (caught) {
      setError(describeStorageFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  async function restore(id: string) {
    setBusy(true);
    try {
      await repository.recommendations.delete(id);
      onChanged();
    } catch (caught) {
      setError(describeStorageFailure(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Ordered by how often and how recently a mistake appears, how solid the evidence is, how central the skill is, and whether you have practised it in the last week. Done or dismissed items come back only if new mistakes appear after you acted.
      </p>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <section aria-labelledby="recommendations-active">
        <SectionHeading id="recommendations-active">Suggested next steps</SectionHeading>
        {active.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {active.map((recommendation) => (
              <RecommendationCard key={recommendation.id} recommendation={recommendation} derived={derived} busy={busy} onAct={(status) => void act(recommendation, status)} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
            {hidden.length > 0 ? 'Nothing new to suggest: you have acted on every current recommendation.' : 'No recommendations yet. They appear once your work shows a repeated mistake or expressions are due for review.'}
          </p>
        )}
      </section>
      {hidden.length > 0 ? (
        <section aria-labelledby="recommendations-hidden">
          <SectionHeading id="recommendations-hidden">Done or dismissed</SectionHeading>
          <ul className="flex flex-col divide-y rounded-lg border bg-card">
            {hidden.map(({ recommendation, state }) => (
              <li key={recommendation.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span>
                  {recommendation.title}
                  <span className="text-muted-foreground">
                    {' '}
                    · {state.status === 'completed' ? 'done' : 'dismissed'} on {formatDate(state.updatedAt)}
                  </span>
                </span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void restore(recommendation.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
