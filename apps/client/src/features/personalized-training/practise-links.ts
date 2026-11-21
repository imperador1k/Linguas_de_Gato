import { LEARNING_CATEGORIES, trainingOptionsFor, type LearningCategory, type TrainingModule, type TrainingOption } from '@ldg/shared';

/*
 * "Practise this" routing (M7.3). A weakness opens the creation panel of the
 * first module whose generator can practise it, as `/<module>?practise=<category>`.
 * Categories no generator covers (listening, reading, vocabulary review) keep
 * their recommendation's own link instead.
 */

export function isLearningCategory(value: string | null | undefined): value is LearningCategory {
  return (LEARNING_CATEGORIES as readonly string[]).includes(value ?? '');
}

/** Where "Practise this" goes for a category, or null when no module generator covers it. */
export function practisePath(category: LearningCategory): string | null {
  const option = trainingOptionsFor(category)[0];
  return option ? practisePathIn(option.module, category) : null;
}

export function practisePathIn(module: TrainingModule, category: LearningCategory): string {
  return `/${module}?practise=${category}`;
}

/** The training option a given module offers for a category, if any. */
export function optionFor<M extends TrainingModule>(category: LearningCategory, module: M): Extract<TrainingOption, { module: M }> | null {
  return (trainingOptionsFor(category).find((option) => option.module === module) as Extract<TrainingOption, { module: M }> | undefined) ?? null;
}

/** Reads a `?practise=` value for one module: the category only if that module can practise it. */
export function practiseCategoryFor(raw: string | null, module: TrainingModule): LearningCategory | null {
  return isLearningCategory(raw) && optionFor(raw, module) ? raw : null;
}
