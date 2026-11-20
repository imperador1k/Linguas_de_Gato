import type { RangePreset } from '@ldg/shared';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/page-header';
import { Notice } from '@/components/ui/notice';
import { DataSection } from '@/features/data-management/data-section';
import { RecurringErrorsSection, SkillsSection } from '@/features/learning-insights/insight-sections';
import { RecommendationsSection } from '@/features/learning-insights/recommendations-section';
import { TrainingSection } from '@/features/personalized-training/training-section';
import { cn } from '@/lib/utils';
import { OverviewSection } from './overview-section';
import { useLearningEngine } from './use-learning-engine';

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'skills', label: 'Skills' },
  { id: 'errors', label: 'Recurring errors' },
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'training', label: 'Personalized training' },
  { id: 'data', label: 'Data & backups' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/**
 * The Personal Learning area. Every figure is derived on demand from the
 * records in this browser; the only server call is the optional, explicit
 * generation of targeted practice.
 */
export function ProgressPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const section: SectionId = SECTIONS.some((candidate) => candidate.id === requested) ? (requested as SectionId) : 'overview';
  const [preset, setPreset] = useState<RangePreset>('30d');
  const engine = useLearningEngine();
  const { state, derived, storage } = engine;
  const activeLabel = SECTIONS.find((candidate) => candidate.id === section)?.label ?? '';

  let body: React.ReactNode;
  if (section === 'data') {
    body = <DataSection onChanged={engine.reload} />;
  } else if (state.phase === 'loading' || !storage) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        Reading your practice history…
      </p>
    );
  } else if (state.phase === 'memory') {
    body = <Notice tone="error">This browser isn't letting the app save data, so there is no history to analyse. Practice in this tab is kept only until it closes.</Notice>;
  } else if (state.phase === 'error') {
    body = <Notice tone="error">{state.message}</Notice>;
  } else if (derived) {
    switch (section) {
      case 'overview':
        body = <OverviewSection snapshot={state.data.snapshot} now={derived.now} preset={preset} onPreset={setPreset} />;
        break;
      case 'skills':
        body = <SkillsSection derived={derived} />;
        break;
      case 'errors':
        body = <RecurringErrorsSection derived={derived} />;
        break;
      case 'recommendations':
        body = <RecommendationsSection derived={derived} repository={storage.repository} onChanged={engine.reload} />;
        break;
      case 'training':
        body = <TrainingSection key={params.get('category') ?? ''} derived={derived} repository={storage.repository} sessions={state.data.trainingSessions} initialCategory={params.get('category')} onCreated={engine.reload} />;
        break;
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Personal learning" title="Progress" description="Where your practice goes and which mistakes keep coming back, with the evidence behind every figure. No points, no streaks, no invented scores." />
      <nav aria-label="Progress sections" className="-mx-1 mb-8 overflow-x-auto">
        <ul className="flex min-w-max gap-1 px-1 pb-1">
          {SECTIONS.map((candidate) => (
            <li key={candidate.id}>
              <Link
                to={`/progress?section=${candidate.id}`}
                aria-current={candidate.id === section ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  setParams({ section: candidate.id });
                }}
                className={cn(
                  'inline-flex h-9 items-center rounded-md px-3 text-sm whitespace-nowrap focus-visible:outline-2 focus-visible:outline-ring',
                  candidate.id === section ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {candidate.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {state.phase === 'ready' && state.data.unreadable > 0 && section !== 'data' ? (
        <Notice className="mb-6">{state.data.unreadable} saved record(s) could not be read (outdated or damaged) and are left out of these figures. They are kept as they are.</Notice>
      ) : null}
      <section aria-label={activeLabel}>{body}</section>
    </div>
  );
}
