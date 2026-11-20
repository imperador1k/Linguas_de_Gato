import { isNegative, type Confidence, type Exposure, type LearningModule, type LearningObservation } from './observations.js';
import { CATEGORY_INFO, LEARNING_CATEGORIES, type LearningCategory } from './taxonomy.js';

/**
 * Deterministic insights per category. Nothing here is AI: every status is a
 * documented threshold over traceable observations.
 *
 * Status rules (evaluated in this order):
 * - `strength`:     ≥ 6 successes from ≥ 2 sources and an error rate ≤ 20%.
 * - `improving`:    the earlier window (31–120 days ago) had ≥ 3 errors and
 *                   the recent window (last 30 days) shows a clearly lower
 *                   error rate (≥ 5 attempts in each, ≥ 25 points lower) or,
 *                   for feedback-only evidence, ≤ half the errors per
 *                   assessed piece of work.
 * - `recurring`:    ≥ 4 errors from ≥ 2 different sources, the latest within
 *                   60 days.
 * - `preliminary`:  ≥ 2 errors: worth watching, not yet a pattern.
 * - `insufficient`: anything less. One mistake never establishes a weakness.
 */

export const INSIGHT_THRESHOLDS = {
  recurringErrors: 4,
  recurringSources: 2,
  recurringRecencyDays: 60,
  preliminaryErrors: 2,
  strengthSuccesses: 6,
  strengthSources: 2,
  strengthMaxErrorRate: 0.2,
  recentWindowDays: 30,
  earlierWindowDays: 120,
  minAttemptsForRate: 5,
  improvementPoints: 0.25,
} as const;

export type InsightStatus = 'recurring' | 'improving' | 'preliminary' | 'strength' | 'insufficient';
export type Trend = 'improving' | 'worsening' | 'stable' | 'unknown';

export interface CategoryInsight {
  readonly category: LearningCategory;
  readonly status: InsightStatus;
  readonly errors: number;
  readonly successes: number;
  /** Stylistic suggestions in this category: shown for context, never counted. */
  readonly suggestions: number;
  readonly sources: number;
  readonly modules: readonly LearningModule[];
  readonly firstAt: number | null;
  readonly lastErrorAt: number | null;
  readonly recentErrors: number;
  readonly earlierErrors: number;
  /** Error rate when there are enough right/wrong answers to compare; otherwise null. */
  readonly recentErrorRate: number | null;
  readonly earlierErrorRate: number | null;
  readonly trend: Trend;
  readonly highSeverity: number;
  readonly confidence: Confidence;
  /** Most recent evidence first (negatives first, then successes). */
  readonly observationIds: readonly string[];
  readonly explanation: string;
}

const DAY = 86_400_000;

const MODULE_NAMES: Record<LearningModule, string> = { listening: 'Listening', speaking: 'Speaking', writing: 'Writing', grammar: 'Grammar', reading: 'Reading', vocabulary: 'Vocabulary' };

function listModules(modules: readonly LearningModule[]): string {
  const names = modules.map((module) => MODULE_NAMES[module]);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const count = (value: number, singular: string, plural = `${singular}s`) => `${value} ${value === 1 ? singular : plural}`;

function explain(insight: Omit<CategoryInsight, 'explanation'>): string {
  const label = CATEGORY_INFO[insight.category].label.toLowerCase();
  const where = listModules(insight.modules);
  switch (insight.status) {
    case 'recurring':
      return `${count(insight.errors, 'mistake')} with ${label} across ${count(insight.sources, 'piece', 'pieces')} of work in ${where}${insight.recentErrors > 0 ? `, ${insight.recentErrors} of them in the last ${INSIGHT_THRESHOLDS.recentWindowDays} days` : ''}.`;
    case 'improving':
      return `Fewer mistakes with ${label} recently: ${insight.recentErrors} in the last ${INSIGHT_THRESHOLDS.recentWindowDays} days against ${insight.earlierErrors} before.`;
    case 'preliminary':
      return `${count(insight.errors, 'mistake')} with ${label} so far in ${where}. Not enough yet to call it a pattern.`;
    case 'strength':
      return `${count(insight.successes, 'correct answer')} on ${label} in ${where}, with ${count(insight.errors, 'mistake')}.`;
    case 'insufficient':
      return insight.errors === 1 ? `One mistake with ${label} so far: not enough evidence.` : `Not enough evidence about ${label} yet.`;
  }
}

function confidenceOf(errors: readonly LearningObservation[], sources: number): Confidence {
  const high = errors.filter((observation) => observation.confidence === 'high').length;
  if (errors.length >= 5 && sources >= 3 && high >= errors.length / 2) return 'high';
  if (errors.length >= INSIGHT_THRESHOLDS.recurringErrors && sources >= 2) return 'medium';
  return 'low';
}

/** Errors per assessed piece of work, for feedback-based evidence that has no "correct" counterpart. */
function perExposure(count: number, exposures: readonly Exposure[], modules: ReadonlySet<LearningModule>, from: number, to: number): number | null {
  const relevant = exposures.filter((exposure) => modules.has(exposure.module) && exposure.at >= from && exposure.at < to).length;
  return relevant >= 2 ? count / relevant : null;
}

export function computeInsights(observations: readonly LearningObservation[], exposures: readonly Exposure[], now: number): CategoryInsight[] {
  const byCategory = new Map<LearningCategory, LearningObservation[]>();
  for (const observation of observations) {
    const list = byCategory.get(observation.category) ?? [];
    list.push(observation);
    byCategory.set(observation.category, list);
  }

  const recentFrom = now - INSIGHT_THRESHOLDS.recentWindowDays * DAY;
  const earlierFrom = now - INSIGHT_THRESHOLDS.earlierWindowDays * DAY;
  const insights: CategoryInsight[] = [];

  for (const category of LEARNING_CATEGORIES) {
    const all = (byCategory.get(category) ?? []).slice().sort((a, b) => b.occurredAt - a.occurredAt);
    if (all.length === 0) continue;
    const errors = all.filter(isNegative);
    const successes = all.filter((observation) => observation.kind === 'correct');
    const suggestions = all.filter((observation) => observation.kind === 'suggestion').length;
    if (errors.length === 0 && successes.length === 0) {
      // Only suggestions: listed for context, never a weakness.
      const partial = { category, status: 'insufficient' as const, errors: 0, successes: 0, suggestions, sources: 0, modules: [...new Set(all.map((o) => o.module))], firstAt: all.at(-1)?.occurredAt ?? null, lastErrorAt: null, recentErrors: 0, earlierErrors: 0, recentErrorRate: null, earlierErrorRate: null, trend: 'unknown' as const, highSeverity: 0, confidence: 'low' as const, observationIds: all.slice(0, 20).map((o) => o.id) };
      insights.push({ ...partial, explanation: `${suggestions} stylistic suggestion${suggestions === 1 ? '' : 's'}, no errors.` });
      continue;
    }

    const errorSources = new Set(errors.map((observation) => observation.sourceRecordId)).size;
    const successSources = new Set(successes.map((observation) => observation.sourceRecordId)).size;
    const modules = [...new Set([...errors, ...successes].map((observation) => observation.module))];
    const window = (list: readonly LearningObservation[], from: number, to: number) => list.filter((observation) => observation.occurredAt >= from && observation.occurredAt < to);
    const recentNegatives = window(errors, recentFrom, now + 1);
    const earlierNegatives = window(errors, earlierFrom, recentFrom);
    const recentAttempts = recentNegatives.length + window(successes, recentFrom, now + 1).length;
    const earlierAttempts = earlierNegatives.length + window(successes, earlierFrom, recentFrom).length;
    const recentErrorRate = recentAttempts >= INSIGHT_THRESHOLDS.minAttemptsForRate ? recentNegatives.length / recentAttempts : null;
    const earlierErrorRate = earlierAttempts >= INSIGHT_THRESHOLDS.minAttemptsForRate ? earlierNegatives.length / earlierAttempts : null;

    let trend: Trend = 'unknown';
    if (recentErrorRate !== null && earlierErrorRate !== null) {
      const difference = earlierErrorRate - recentErrorRate;
      trend = difference >= INSIGHT_THRESHOLDS.improvementPoints ? 'improving' : difference <= -INSIGHT_THRESHOLDS.improvementPoints ? 'worsening' : 'stable';
    } else if (successes.length === 0) {
      // Feedback-only evidence: compare errors per assessed piece of work.
      const moduleSet = new Set(errors.map((observation) => observation.module));
      const recentPer = perExposure(recentNegatives.length, exposures, moduleSet, recentFrom, now + 1);
      const earlierPer = perExposure(earlierNegatives.length, exposures, moduleSet, earlierFrom, recentFrom);
      if (recentPer !== null && earlierPer !== null && earlierNegatives.length >= 3) {
        trend = recentPer <= earlierPer / 2 ? 'improving' : recentPer >= earlierPer * 2 && recentNegatives.length >= 3 ? 'worsening' : 'stable';
      }
    }

    const errorRate = errors.length + successes.length > 0 ? errors.length / (errors.length + successes.length) : 1;
    const lastErrorAt = errors[0]?.occurredAt ?? null;
    let status: InsightStatus;
    if (successes.length >= INSIGHT_THRESHOLDS.strengthSuccesses && successSources >= INSIGHT_THRESHOLDS.strengthSources && errorRate <= INSIGHT_THRESHOLDS.strengthMaxErrorRate) status = 'strength';
    else if (trend === 'improving' && earlierNegatives.length >= 3) status = 'improving';
    else if (
      errors.length >= INSIGHT_THRESHOLDS.recurringErrors &&
      errorSources >= INSIGHT_THRESHOLDS.recurringSources &&
      lastErrorAt !== null &&
      lastErrorAt >= now - INSIGHT_THRESHOLDS.recurringRecencyDays * DAY
    )
      status = 'recurring';
    else if (errors.length >= INSIGHT_THRESHOLDS.preliminaryErrors) status = 'preliminary';
    else status = 'insufficient';

    const partial = {
      category,
      status,
      errors: errors.length,
      successes: successes.length,
      suggestions,
      sources: errorSources,
      modules,
      firstAt: all.at(-1)?.occurredAt ?? null,
      lastErrorAt,
      recentErrors: recentNegatives.length,
      earlierErrors: earlierNegatives.length,
      recentErrorRate,
      earlierErrorRate,
      trend,
      highSeverity: errors.filter((observation) => observation.severity === 'high').length,
      confidence: confidenceOf(errors, errorSources),
      observationIds: [...errors, ...successes, ...all.filter((o) => o.kind === 'suggestion')].slice(0, 30).map((observation) => observation.id),
    };
    insights.push({ ...partial, explanation: explain(partial) });
  }

  const order: Record<InsightStatus, number> = { recurring: 0, preliminary: 1, improving: 2, strength: 3, insufficient: 4 };
  return insights.sort((a, b) => order[a.status] - order[b.status] || b.errors - a.errors || b.successes - a.successes);
}

/** Error counts per bucket for a category, for a small trend sparkline (ascending time). */
export function errorTimeline(observations: readonly LearningObservation[], category: LearningCategory, now: number, weeks = 12): number[] {
  const counts = Array.from({ length: weeks }, () => 0);
  for (const observation of observations) {
    if (observation.category !== category || !isNegative(observation)) continue;
    const weeksAgo = Math.floor((now - observation.occurredAt) / (7 * DAY));
    if (weeksAgo >= 0 && weeksAgo < weeks) counts[weeks - 1 - weeksAgo] = (counts[weeks - 1 - weeksAgo] ?? 0) + 1;
  }
  return counts;
}
