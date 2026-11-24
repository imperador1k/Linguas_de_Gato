import { contextForms, facetViews, type FacetAttempt, type FacetStatus, type FacetView, type VocabularyEntry, type VocabularySense } from '@ldg/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { FACET_LABELS, STATUS_TEXT } from './trainer/trainer-labels';
import { dateFormatter, describeDue } from './vocabulary-labels';

const STATUS_BADGE: Record<FacetStatus, 'success' | 'neutral' | 'destructive' | 'outline' | 'brand'> = {
  untested: 'outline',
  difficult: 'destructive',
  learning: 'neutral',
  established: 'brand',
  secure: 'success',
};

function statusText(view: FacetView): string {
  if (!view.supported) return 'Not available';
  if (view.status === 'established' || view.status === 'secure') return `${FACET_LABELS[view.facet].achieved}${view.status === 'secure' ? ' · secure' : ''}`;
  return STATUS_TEXT[view.status];
}

/**
 * One line per sense: the three directions and where each stands. Text, not
 * just colour, carries the state.
 */
export function FacetChips({ entry, sense, now, className }: { entry: VocabularyEntry; sense: VocabularySense; now: number; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label="What you have shown">
      {facetViews(entry, sense, now).map((view) => (
        <li key={view.facet}>
          <Badge variant={view.supported ? STATUS_BADGE[view.status] : 'outline'} className={cn('gap-1 px-1.5 py-0 text-[0.6875rem]', !view.supported && 'opacity-60')}>
            <span className="font-medium">{FACET_LABELS[view.facet].short}</span>
            <span aria-hidden="true">·</span>
            <span>{view.due ? 'Due' : statusText(view)}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

const OUTCOME_MARK: Record<FacetAttempt['outcome'], { mark: string; label: string }> = {
  correct: { mark: '✓', label: 'correct' },
  almost: { mark: '~', label: 'almost' },
  wrong_form: { mark: 'f', label: 'wrong form' },
  incorrect: { mark: '✗', label: 'incorrect' },
  skipped: { mark: '–', label: 'not known' },
};

function Attempts({ attempts }: { attempts: readonly FacetAttempt[] }) {
  const recent = attempts.slice(-8);
  if (recent.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      <span>Recent:</span>
      {recent.map((attempt, index) => {
        const info = OUTCOME_MARK[attempt.outcome];
        const label = `${info.label}${attempt.hints > 0 ? ` with ${attempt.hints} hint${attempt.hints === 1 ? '' : 's'}` : ''}, ${dateFormatter.format(attempt.at)}`;
        return (
          <span key={`${attempt.at}-${index}`} title={label} className={cn('inline-flex size-5 items-center justify-center rounded-sm border font-mono', attempt.outcome === 'correct' && attempt.hints === 0 ? 'border-success/40 text-success' : attempt.outcome === 'correct' ? 'border-border-strong' : 'border-destructive/40 text-destructive')}>
            <span aria-hidden="true">{info.mark}</span>
            <span className="sr-only">{label}</span>
          </span>
        );
      })}
    </p>
  );
}

const UNSUPPORTED: Record<FacetView['facet'], string> = {
  recognition: 'Add a Portuguese translation to practise this direction.',
  recall: 'Add a Portuguese translation to practise this direction.',
  context: 'Add an example sentence that contains the word (or one of its listed forms).',
};

/** The evidence for one sense, per direction: status, schedule, recent answers and forms used. */
export function SenseKnowledge({ entry, sense, now }: { entry: VocabularyEntry; sense: VocabularySense; now: number }) {
  return (
    <div className="flex flex-col gap-3">
      {facetViews(entry, sense, now).map((view) => {
        const knowledge = sense.knowledge?.[view.facet];
        const forms = view.facet === 'context' ? contextForms(knowledge) : null;
        return (
          <div key={view.facet} className="flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{FACET_LABELS[view.facet].label}</p>
              <Badge variant={view.supported ? STATUS_BADGE[view.status] : 'outline'}>{statusText(view)}</Badge>
            </div>
            {!view.supported ? (
              <p className="text-xs text-muted-foreground">{UNSUPPORTED[view.facet]}</p>
            ) : view.dueAt !== null ? (
              <p className={cn('text-xs', view.due ? 'font-medium text-foreground' : 'text-muted-foreground')}>{describeDue(view.dueAt, now)}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Not tested in this direction yet.</p>
            )}
            {knowledge ? <Attempts attempts={knowledge.attempts} /> : null}
            {forms && forms.produced.length > 0 ? <p className="text-xs text-muted-foreground">Used correctly: {forms.produced.join(', ')}</p> : null}
            {forms && forms.missed.length > 0 ? <p className="text-xs text-muted-foreground">Still to get right: {forms.missed.join(', ')}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
