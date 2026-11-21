import {
  CATEGORY_INFO,
  LEARNING_RECORD_VERSION,
  buildTargetedPractice,
  extractObservations,
  isNegative,
  trainingOptionsFor,
  type LearningCategory,
  type LearningObservation,
  type TargetedPractice,
  type TrainingModule,
} from '@ldg/shared';
import { Crosshair } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { learningStorage } from '@/features/progress/storage/learning-repository';
import { practisePathIn } from './practise-links';

export { optionFor, practisePath } from './practise-links';

/**
 * Personalized training inside each module's own creation panel (M7.3).
 * "Practise this" links carry `?practise=<category>`; the module opens its
 * panel pre-filled from the category's training option and attaches the
 * same bounded profile as M6: one area's name and description and, only if
 * the learner keeps the box ticked, up to five of their own mistakes.
 * The learning history itself never leaves the browser.
 */

const MODULE_LABELS: Record<TrainingModule, string> = { grammar: 'Grammar', writing: 'Writing', speaking: 'Speaking' };

export interface TargetedContext {
  readonly category: LearningCategory;
  readonly module: TrainingModule;
  readonly includeExamples: boolean;
  /** The bounded profile to send, or null while observations load. */
  readonly profile: TargetedPractice | null;
}

/** Loads the learner's observations (locally) and builds the bounded profile for one category. */
export function useTargetedPractice(category: LearningCategory | null, module: TrainingModule) {
  const [observations, setObservations] = useState<readonly LearningObservation[] | null>(null);
  const [includeExamples, setIncludeExamples] = useState(true);

  useEffect(() => {
    if (!category) return;
    let active = true;
    void learningStorage
      .get()
      .then((storage) => storage.repository.loadSnapshot())
      .then(
        (data) => active && setObservations(data ? extractObservations(data.snapshot).observations : []),
        () => active && setObservations([]),
      );
    return () => {
      active = false;
    };
  }, [category]);

  const profile = useMemo(() => (category && observations ? buildTargetedPractice(category, observations, includeExamples) : null), [category, observations, includeExamples]);
  const mistakes = useMemo(() => (category && observations ? observations.filter((observation) => observation.category === category && isNegative(observation)).length : 0), [category, observations]);
  const context: TargetedContext | null = category ? { category, module, includeExamples, profile } : null;
  return { context, mistakes, includeExamples, setIncludeExamples };
}

/** Records a generated targeted exercise in the M6 training log (recommendation damping and history). */
export async function logTrainingSession(context: TargetedContext, record: { id: string; title: string; level: 'B2' | 'C1' | 'C2' }): Promise<void> {
  try {
    const storage = await learningStorage.get();
    await storage.repository.training.put({
      id: crypto.randomUUID(),
      version: LEARNING_RECORD_VERSION,
      category: context.category,
      module: context.module,
      level: record.level,
      recordId: record.id,
      title: record.title.slice(0, 160),
      includedExamples: context.profile?.examples.length ?? 0,
      createdAt: Date.now(),
    });
  } catch {
    // The log only tunes recommendations; failing to write it must not undo the saved exercise.
  }
}

/** The top of a module panel in targeted mode: what is being practised, what will be sent, and the other modules. */
export function TargetedPracticeNotice({ category, module, mistakes, profile, includeExamples, onIncludeExamplesChange }: { category: LearningCategory; module: TrainingModule; mistakes: number; profile: TargetedPractice | null; includeExamples: boolean; onIncludeExamplesChange: (value: boolean) => void }) {
  const id = useId();
  const info = CATEGORY_INFO[category];
  const others = trainingOptionsFor(category).filter((option) => option.module !== module);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-lg border border-border-strong bg-card px-4 py-3.5">
      <h3 id={id} className="flex items-center gap-2 text-sm font-medium">
        <Crosshair aria-hidden="true" className="size-4 text-muted-foreground" />
        Targeted practice: {info.label}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Based on {mistakes} mistake{mistakes === 1 ? '' : 's'} in your work with {info.description}. The settings below are pre-filled for it; change anything you like.
      </p>
      <label className="flex items-start gap-2.5 text-sm">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--brand)]" checked={includeExamples} onChange={(event) => onIncludeExamplesChange(event.target.checked)} />
        <span>
          Include examples of my real mistakes
          <span className="block text-xs text-muted-foreground">Up to five recent, distinct mistakes with their corrections. Low-confidence evidence is never sent.</span>
        </span>
      </label>
      {profile ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Exactly what will be sent</summary>
          <div className="mt-2 rounded-md bg-muted px-3 py-2.5 text-xs leading-relaxed">
            <p>
              <span className="font-medium">Focus:</span> {profile.focus}
            </p>
            <p>
              <span className="font-medium">Description:</span> {profile.description}
            </p>
            {profile.examples.length > 0 ? (
              <ul className="mt-1 list-disc pl-4">
                {profile.examples.map((example) => (
                  <li key={example.original}>
                    “{example.original}” → “{example.corrected}”
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-muted-foreground">No examples.</p>
            )}
            <p className="mt-1 text-muted-foreground">Plus the settings in this panel. Nothing else from your history is sent.</p>
          </div>
        </details>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          Reading your mistakes…
        </p>
      )}
      {others.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Also possible in{' '}
          {others.map((option, index) => (
            <span key={option.module}>
              {index > 0 ? ' or ' : ''}
              <Link to={practisePathIn(option.module, category)} className="underline underline-offset-2 hover:text-foreground">
                {MODULE_LABELS[option.module]}
              </Link>
            </span>
          ))}
          .
        </p>
      ) : null}
    </section>
  );
}
