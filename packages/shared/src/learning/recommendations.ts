import type { RecommendationState, TrainingSession } from '../contracts/learning.js';
import { dueEntries } from '../domain/vocabulary.js';
import type { CategoryInsight } from './insights.js';
import { isNegative, type LearningObservation, type LearningSnapshot } from './observations.js';
import { trainingOptionsFor } from './training.js';
import { CATEGORY_INFO, type LearningCategory, type SkillArea } from './taxonomy.js';

/**
 * Deterministic recommendations. Priority =
 *   status base (recurring 3, preliminary 1.2; +0.8 when worsening)
 *   × skill importance (discourse 1.1, grammar and vocabulary 1, listening
 *     and reading 0.9, spelling and punctuation 0.6)
 *   × evidence confidence (high 1, medium 0.85, low 0.6)
 *   × recency of the latest mistake (≤ 14 days 1, ≤ 60 days 0.7, older 0.4)
 *   × frequency (0.5 + 0.5 · min(1, log2(1 + errors) / log2(9)))
 *   × 0.4 if the learner generated targeted training for it in the last 7 days.
 * Improving categories and strengths get no recommendation. A dismissed or
 * completed recommendation stays hidden until newer evidence appears.
 */

export type RecommendationAction =
  | { readonly type: 'train'; readonly category: LearningCategory }
  | { readonly type: 'open'; readonly path: string; readonly label: string };

export interface Recommendation {
  readonly id: string;
  readonly category: LearningCategory | null;
  readonly title: string;
  readonly rationale: string;
  readonly nextStep: string;
  readonly action: RecommendationAction;
  readonly priority: number;
  readonly preliminary: boolean;
  /** Newest evidence behind it; acting on it records this, so newer evidence can bring it back. */
  readonly evidenceAt: number | null;
  readonly observationIds: readonly string[];
  /** True when it was dismissed or completed earlier and new evidence appeared since. */
  readonly returned: boolean;
}

export interface RecommendationResult {
  readonly active: Recommendation[];
  readonly hidden: Array<{ readonly recommendation: Recommendation; readonly state: RecommendationState }>;
}

const DAY = 86_400_000;
const IMPORTANCE: Record<SkillArea, number> = { discourse: 1.1, grammar: 1, vocabulary: 1, listening: 0.9, reading: 0.9, accuracy: 0.6 };
const CONFIDENCE = { high: 1, medium: 0.85, low: 0.6 } as const;

function recency(lastAt: number | null, now: number): number {
  if (lastAt === null) return 0.4;
  const days = (now - lastAt) / DAY;
  return days <= 14 ? 1 : days <= 60 ? 0.7 : 0.4;
}

/** The source with the most mistakes in this category: where to practise. */
function busiestSource(observations: readonly LearningObservation[], category: LearningCategory): LearningObservation | null {
  const counts = new Map<string, { count: number; observation: LearningObservation }>();
  for (const observation of observations) {
    if (observation.category !== category || !isNegative(observation)) continue;
    const current = counts.get(observation.sourcePath);
    counts.set(observation.sourcePath, { count: (current?.count ?? 0) + 1, observation: current?.observation ?? observation });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.observation ?? null;
}

function actionFor(category: LearningCategory, observations: readonly LearningObservation[], dueCount: number): { action: RecommendationAction; nextStep: string } | null {
  const label = CATEGORY_INFO[category].label.toLowerCase();
  if (trainingOptionsFor(category).length > 0) {
    return { action: { type: 'train', category }, nextStep: `Generate targeted practice on ${label} from your own mistakes.` };
  }
  const source = busiestSource(observations, category);
  switch (category) {
    case 'listening_recognition':
    case 'spelling':
      return source ? { action: { type: 'open', path: source.sourcePath, label: 'Practise dictation' }, nextStep: `Redo dictation in “${source.sourceLabel}”, replaying each line before you type.` } : null;
    case 'listening_comprehension':
      return source ? { action: { type: 'open', path: source.sourcePath, label: 'Open comprehension' }, nextStep: `Answer a new comprehension set for “${source.sourceLabel}” after listening twice.` } : null;
    case 'reading_comprehension':
    case 'reading_inference':
    case 'vocabulary_in_context':
      return source ? { action: { type: 'open', path: source.sourcePath, label: 'Open the text' }, nextStep: `Generate a new question set for “${source.sourceLabel}” and use “Show in text” to check each answer.` } : null;
    case 'vocabulary_retention':
      return dueCount > 0
        ? { action: { type: 'open', path: '/vocabulary/review', label: 'Review now' }, nextStep: `Review your ${dueCount} due expression${dueCount === 1 ? '' : 's'}, then practise the ones you forgot.` }
        : { action: { type: 'open', path: '/vocabulary', label: 'Practise vocabulary' }, nextStep: 'Select the expressions you forget most and generate practice with them.' };
    default:
      return null;
  }
}

export function recommendationId(category: LearningCategory | 'vocabulary-due'): string {
  return `rec:${category}`;
}

export function computeRecommendations(
  insights: readonly CategoryInsight[],
  observations: readonly LearningObservation[],
  snapshot: Pick<LearningSnapshot, 'vocabularyEntries'>,
  states: readonly RecommendationState[],
  trainingSessions: readonly TrainingSession[],
  now: number,
): RecommendationResult {
  const stateById = new Map(states.map((state) => [state.id, state]));
  const due = dueEntries([...snapshot.vocabularyEntries], now);
  const candidates: Recommendation[] = [];

  for (const insight of insights) {
    if (insight.status !== 'recurring' && insight.status !== 'preliminary') continue;
    const resolved = actionFor(insight.category, observations, due.length);
    if (!resolved) continue;
    const info = CATEGORY_INFO[insight.category];
    const recentTraining = trainingSessions.filter((session) => session.category === insight.category && session.createdAt >= now - 7 * DAY).sort((a, b) => b.createdAt - a.createdAt)[0];
    const base = (insight.status === 'recurring' ? 3 : 1.2) + (insight.trend === 'worsening' ? 0.8 : 0);
    const frequency = 0.5 + 0.5 * Math.min(1, Math.log2(1 + insight.errors) / Math.log2(9));
    const priority = base * IMPORTANCE[info.area] * CONFIDENCE[insight.confidence] * recency(insight.lastErrorAt, now) * frequency * (recentTraining ? 0.4 : 1);
    const practised = recentTraining ? ` You generated targeted practice for this on ${new Date(recentTraining.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.` : '';
    candidates.push({
      id: recommendationId(insight.category),
      category: insight.category,
      title: insight.status === 'recurring' ? `Work on ${info.label.toLowerCase()}` : `Keep an eye on ${info.label.toLowerCase()}`,
      rationale: `${insight.explanation}${insight.trend === 'worsening' ? ' Recent work shows more mistakes than before.' : ''}${practised}`,
      nextStep: resolved.nextStep,
      action: resolved.action,
      priority: Math.round(priority * 1000) / 1000,
      preliminary: insight.status === 'preliminary',
      evidenceAt: insight.lastErrorAt,
      observationIds: insight.observationIds,
      returned: false,
    });
  }

  if (due.length > 0) {
    const oldestDue = due[0]?.review.dueAt ?? now;
    const newestDue = due.at(-1)?.review.dueAt ?? now;
    candidates.push({
      id: recommendationId('vocabulary-due'),
      category: null,
      title: `Review ${due.length} expression${due.length === 1 ? '' : 's'}`,
      rationale: `${due.length} saved expression${due.length === 1 ? ' is' : 's are'} due for review${now - oldestDue > DAY ? `, the oldest for ${Math.floor((now - oldestDue) / DAY)} days` : ''}.`,
      nextStep: 'Recall each meaning from its sentence before revealing it.',
      action: { type: 'open', path: '/vocabulary/review', label: 'Review now' },
      priority: Math.round(Math.min(3, 1 + due.length / 10) * 1000) / 1000,
      preliminary: false,
      // Something newly due after the learner acted brings the review back.
      evidenceAt: newestDue,
      observationIds: [],
      returned: false,
    });
  }

  const active: Recommendation[] = [];
  const hidden: RecommendationResult['hidden'] = [];
  for (const candidate of candidates) {
    const state = stateById.get(candidate.id);
    if (!state) {
      active.push(candidate);
      continue;
    }
    // Newer evidence than when the learner acted brings it back.
    const newer = candidate.evidenceAt !== null && candidate.evidenceAt > (state.evidenceAt ?? Number.NEGATIVE_INFINITY);
    if (newer) active.push({ ...candidate, returned: true });
    else hidden.push({ recommendation: candidate, state });
  }
  return { active: active.sort((a, b) => b.priority - a.priority), hidden };
}
