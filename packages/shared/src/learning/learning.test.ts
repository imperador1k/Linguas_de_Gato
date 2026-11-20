import { describe, expect, it } from 'vitest';
import { generationRequestSchema } from '../contracts/exercise-generation.js';
import { BACKUP_STORES } from '../contracts/backup.js';
import {
  DAY,
  NOW,
  SESSION,
  dictation,
  emptySnapshot,
  grammarSet,
  listeningSet,
  practiceSet,
  readingSet,
  readingText,
  speakingAttempt,
  vocabularyEntry,
  writingAttempt,
} from './fixtures.test-helpers.js';
import { INSIGHT_THRESHOLDS, computeInsights, errorTimeline } from './insights.js';
import { activitySeries, computeMetrics, localDateKey, rangeFor } from './metrics.js';
import { extractObservations, isNegative, type LearningSnapshot } from './observations.js';
import { computeRecommendations, recommendationId } from './recommendations.js';
import { categorizeGrammarTopic, categorizeSpeakingIssue, categorizeText, categorizeWritingCorrection } from './taxonomy.js';
import { MAX_PROFILE_EXAMPLES, buildTargetedPractice, buildTrainingRequest, trainingOptionsFor } from './training.js';

const snapshot = (overrides: Partial<LearningSnapshot>): LearningSnapshot => ({ ...emptySnapshot(), ...overrides });

describe('fixtures are valid stored records', () => {
  it('pass the schemas used by the app and the backup', () => {
    expect(BACKUP_STORES.speakingAttempts.schema.safeParse(speakingAttempt('a', NOW, [{ category: 'grammar', subcategory: 'preposition', original: 'depends of' }])).success).toBe(true);
    expect(BACKUP_STORES.writingAttempts.schema.safeParse(writingAttempt('w', NOW, [{ kind: 'error', category: 'grammar', original: 'more better' }])).success).toBe(true);
    expect(BACKUP_STORES.grammarSets.schema.safeParse(grammarSet('g', NOW, 'conditionals', ['right', 'wrong'])).success).toBe(true);
    expect(BACKUP_STORES.readingQuestionSets.schema.safeParse(readingSet('r', 't', NOW, [{ type: 'detail', right: true }])).success).toBe(true);
    expect(BACKUP_STORES.listeningExercises.schema.safeParse(listeningSet('l', NOW, [true])).success).toBe(true);
    expect(BACKUP_STORES.vocabularyPracticeSets.schema.safeParse(practiceSet('p', NOW, 'e1', ['right'], 'correct')).success).toBe(true);
  });
});

describe('taxonomy normalisation', () => {
  it('maps free-text labels to canonical categories, specific rules first', () => {
    expect(categorizeText('verb tense')).toBe('verb_tenses');
    expect(categorizeText('Preposition after "depend"')).toBe('prepositions');
    expect(categorizeText('phrasal verb particle')).toBe('phrasal_verbs');
    expect(categorizeText('strong collocation')).toBe('collocations');
    expect(categorizeText('comparative')).toBe('comparatives');
    expect(categorizeText('something unrelated')).toBeNull();
  });

  it('normalises speaking issues, keeping task and coherence issues in their own areas', () => {
    expect(categorizeSpeakingIssue({ category: 'grammar', subcategory: 'agreement' })).toBe('subject_verb_agreement');
    expect(categorizeSpeakingIssue({ category: 'grammar', subcategory: 'odd label' })).toBe('grammar_other');
    expect(categorizeSpeakingIssue({ category: 'task', subcategory: 'verb tense' })).toBe('task_achievement');
    expect(categorizeSpeakingIssue({ category: 'coherence', subcategory: 'argument development' })).toBe('coherence');
    expect(categorizeSpeakingIssue({ category: 'coherence', subcategory: 'verb tense' })).toBe('coherence');
    expect(categorizeSpeakingIssue({ category: 'vocabulary', subcategory: 'collocation' })).toBe('collocations');
  });

  it('normalises writing corrections and grammar topics', () => {
    expect(categorizeWritingCorrection({ category: 'grammar', explanation: 'Use the present perfect tense here.' })).toBe('verb_tenses');
    expect(categorizeWritingCorrection({ category: 'grammar', explanation: 'Something else.' })).toBe('grammar_other');
    expect(categorizeWritingCorrection({ category: 'word_choice', explanation: 'The wrong preposition.' })).toBe('prepositions');
    expect(categorizeWritingCorrection({ category: 'word_choice', explanation: 'Imprecise.' })).toBe('vocabulary_precision');
    expect(categorizeWritingCorrection({ category: 'cohesion', explanation: 'Use a linking word.' })).toBe('linking_devices');
    expect(categorizeWritingCorrection({ category: 'spelling', explanation: '' })).toBe('spelling');
    expect(categorizeGrammarTopic('articles_and_prepositions', 'the')).toBe('articles');
    expect(categorizeGrammarTopic('articles_and_prepositions', 'on')).toBe('prepositions');
    expect(categorizeGrammarTopic('inversion', null)).toBe('inversion');
  });
});

describe('extracting observations', () => {
  it('extracts verified speaking issues with traceability and excludes recognition corrections', () => {
    const { observations, excluded, exposures } = extractObservations(
      snapshot({ speakingAttempts: [speakingAttempt('a1', NOW - DAY, [{ category: 'grammar', subcategory: 'preposition', original: 'depends of', correction: 'depends on' }], 2)] }),
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      id: 'speaking:a1:issue:0',
      module: 'speaking',
      sourceRecordId: 'a1',
      sourcePath: '/speaking/attempts/a1',
      category: 'prepositions',
      kind: 'error',
      original: 'depends of',
      corrected: 'depends on',
      evidence: 'verified_quote',
      confidence: 'high',
      severity: 'high',
    });
    expect(excluded.recognitionCorrections).toBe(2);
    expect(exposures).toEqual([{ module: 'speaking', recordId: 'a1', at: NOW - DAY }]);
  });

  it('merges duplicate corrections within one assessment', () => {
    const attempt = speakingAttempt('a1', NOW, [
      { category: 'grammar', subcategory: 'preposition', original: 'depends of' },
      { category: 'grammar', subcategory: 'preposition', original: 'Depends of ' },
    ]);
    const result = extractObservations(snapshot({ speakingAttempts: [attempt] }));
    expect(result.observations).toHaveLength(1);
    expect(result.excluded.duplicateCorrections).toBe(1);
  });

  it('keeps writing suggestions apart from errors', () => {
    const { observations } = extractObservations(
      snapshot({
        writingAttempts: [
          writingAttempt('w1', NOW, [
            { kind: 'error', category: 'grammar', original: 'more better', explanation: 'Comparative form.' },
            { kind: 'suggestion', category: 'word_choice', original: 'a lot of' },
          ]),
        ],
      }),
    );
    expect(observations.map((o) => [o.kind, o.category])).toEqual(
      expect.arrayContaining([
        ['error', 'comparatives'],
        ['suggestion', 'vocabulary_precision'],
      ]),
    );
    expect(observations.filter(isNegative)).toHaveLength(1);
  });

  it('uses only checked grammar rounds, and respects accepting second opinions', () => {
    const { observations, excluded } = extractObservations(
      snapshot({
        grammarSets: [
          grammarSet('checked', NOW, 'articles_and_prepositions', ['right', 'wrong', 'wrong', 'blank']),
          grammarSet('unchecked', null, 'conditionals', ['wrong']),
          grammarSet('reviewed', NOW, 'conditionals', ['wrong'], 'acceptable'),
        ],
      }),
    );
    const checked = observations.filter((o) => o.sourceRecordId === 'checked');
    expect(checked.map((o) => [o.kind, o.category])).toEqual(
      expect.arrayContaining([
        ['correct', 'prepositions'],
        ['incorrect', 'articles'],
        ['incorrect', 'prepositions'],
      ]),
    );
    expect(checked).toHaveLength(3);
    expect(observations.some((o) => o.sourceRecordId === 'unchecked' || o.sourceRecordId === 'reviewed')).toBe(false);
    expect(excluded.uncheckedRounds).toBe(1);
    expect(excluded.acceptedBySecondOpinion).toBe(1);
  });

  it('diffs only the latest dictation attempt per line, capped, with spelling slips kept low-confidence', () => {
    const { observations } = extractObservations(
      snapshot({
        listeningSessions: [SESSION],
        dictation: [
          dictation('1', 'The weather is lovely today', [
            { at: NOW - 2 * DAY, answer: 'The whether is lovly' },
            { at: NOW - DAY, answer: 'The weather is lovly today' },
          ]),
          dictation('2', 'One two three', [{ at: NOW, answer: 'One two three' }]),
          dictation('3', 'a b c d e f g h', [{ at: NOW, answer: 'z y x w v u t s' }]),
        ],
      }),
    );
    const line1 = observations.filter((o) => o.id.includes(':1:'));
    expect(line1).toHaveLength(1);
    expect(line1[0]).toMatchObject({ category: 'spelling', original: 'lovly', corrected: 'lovely', confidence: 'low', kind: 'incorrect' });
    expect(observations.find((o) => o.id.includes(':2:'))).toMatchObject({ kind: 'correct', category: 'listening_recognition' });
    expect(observations.filter((o) => o.id.includes(':3:'))).toHaveLength(4);
  });

  it('extracts checked comprehension, reading, vocabulary practice, AI rubric and review evidence', () => {
    const { observations, excluded } = extractObservations(
      snapshot({
        listeningSessions: [SESSION],
        listeningExerciseSets: [listeningSet('l1', NOW, [true, false]), listeningSet('l2', null, [false])],
        readingTexts: [readingText('t1', null)],
        readingQuestionSets: [readingSet('r1', 't1', NOW, [{ type: 'inference', right: false }, { type: 'vocabulary_in_context', right: true }, { type: 'detail', right: false }])],
        vocabularyEntries: [vocabularyEntry('e1', NOW - 5 * DAY, [{ at: NOW - DAY, rating: 'again' }, { at: NOW, rating: 'good' }])],
        vocabularyPracticeSets: [practiceSet('p1', NOW, 'e1', ['wrong'], 'incorrect'), practiceSet('p2', NOW, 'e1', ['right'])],
      }),
    );
    const by = (module: string) => observations.filter((o) => o.module === module).map((o) => [o.kind, o.category]);
    expect(by('listening')).toEqual(expect.arrayContaining([['correct', 'listening_comprehension'], ['incorrect', 'listening_comprehension']]));
    expect(by('reading')).toEqual(expect.arrayContaining([['incorrect', 'reading_inference'], ['correct', 'vocabulary_in_context'], ['incorrect', 'reading_comprehension']]));
    expect(by('vocabulary')).toEqual(
      expect.arrayContaining([
        ['incorrect', 'vocabulary_retention'],
        ['incorrect', 'vocabulary_precision'],
        ['correct', 'vocabulary_retention'],
      ]),
    );
    expect(observations.find((o) => o.evidence === 'ai_rubric')).toMatchObject({ confidence: 'medium' });
    expect(observations.find((o) => o.evidence === 'review_rating' && o.kind === 'incorrect')).toMatchObject({ confidence: 'low' });
    expect(excluded.uncheckedRounds).toBe(1);
  });

  it('produces stable ids, so the same records never yield duplicate evidence', () => {
    const data = snapshot({ speakingAttempts: [speakingAttempt('a1', NOW, [{ category: 'grammar', subcategory: 'tense', original: 'I go yesterday' }])] });
    expect(extractObservations(data).observations.map((o) => o.id)).toEqual(extractObservations(data).observations.map((o) => o.id));
  });

  it('treats an empty history as no evidence at all', () => {
    expect(extractObservations(emptySnapshot())).toEqual({
      observations: [],
      exposures: [],
      excluded: { recognitionCorrections: 0, uncheckedRounds: 0, acceptedBySecondOpinion: 0, unratedShortAnswers: 0, duplicateCorrections: 0 },
    });
  });
});

describe('metrics', () => {
  const data = snapshot({
    listeningSessions: [SESSION],
    dictation: [dictation('1', 'a b', [{ at: NOW - 2 * DAY, answer: 'a b' }, { at: NOW - 40 * DAY, answer: 'a' }])],
    speakingAttempts: [speakingAttempt('a1', NOW - DAY, []), speakingAttempt('a2', NOW - 60 * DAY, [])],
    writingAttempts: [writingAttempt('w1', NOW - DAY, [{ kind: 'error', category: 'grammar', original: 'x' }, { kind: 'suggestion', category: 'word_choice', original: 'y' }], 600_000), writingAttempt('w2', NOW - 3 * DAY, [])],
    grammarSets: [grammarSet('g1', NOW - DAY, 'conditionals', ['right', 'wrong', 'blank'])],
    readingTexts: [readingText('t1', NOW - DAY), readingText('t2', null)],
    vocabularyEntries: [vocabularyEntry('e1', NOW - DAY, [{ at: NOW - DAY, rating: 'again' }, { at: NOW, rating: 'easy' }])],
  });

  it('counts only measured time, separately from estimates', () => {
    const metrics = computeMetrics(data, rangeFor('7d', NOW));
    expect(metrics.modules.speaking).toMatchObject({ attempts: 1, recordedMs: 45_000, assessed: 1 });
    expect(metrics.modules.writing).toMatchObject({ submissions: 2, timedMs: 600_000, timedSubmissions: 1, verifiedErrors: 1, suggestions: 1 });
    expect(metrics.modules.reading).toMatchObject({ textsFinished: 1, estimatedReadingMinutes: 2 });
  });

  it('reports accuracies with their denominators and no combined score', () => {
    const metrics = computeMetrics(data, rangeFor('7d', NOW));
    expect(metrics.modules.grammar.answers).toEqual({ correct: 1, total: 3 });
    expect(metrics.modules.listening).toMatchObject({ dictationAttempts: 1, meanDictationAccuracy: 1 });
    expect(metrics.modules.vocabulary).toMatchObject({ reviews: 2, reviewsRemembered: 1 });
    expect(Object.keys(metrics)).not.toContain('score');
  });

  it('applies date ranges and counts distinct active days', () => {
    const week = computeMetrics(data, rangeFor('7d', NOW));
    const all = computeMetrics(data, rangeFor('all', NOW));
    expect(all.modules.speaking.attempts).toBe(2);
    expect(all.modules.listening.dictationAttempts).toBe(2);
    expect(week.activeDays).toBe(new Set([NOW - DAY, NOW - 2 * DAY, NOW - 3 * DAY, NOW].map(localDateKey)).size);
    expect(all.activeDays).toBeGreaterThan(week.activeDays);
    expect(computeMetrics(emptySnapshot(), rangeFor('all', NOW))).toMatchObject({ activeDays: 0, events: 0, completedExercises: 0 });
  });

  it('builds a series with empty buckets kept', () => {
    const series = activitySeries(data, rangeFor('7d', NOW), NOW);
    expect(series.length).toBeGreaterThanOrEqual(7);
    expect(series.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(computeMetrics(data, rangeFor('7d', NOW)).events);
    expect(series.some((bucket) => bucket.total === 0)).toBe(true);
  });
});

describe('insights', () => {
  const prepositionErrors = (count: number, sources: number, daysAgo = 2) =>
    Array.from({ length: sources }, (_, index) =>
      speakingAttempt(
        `a${daysAgo}-${index}`,
        NOW - (daysAgo + index) * DAY,
        Array.from({ length: Math.ceil(count / sources) }, (_, item) => ({ category: 'grammar' as const, subcategory: 'preposition', original: `wrong preposition ${index}-${item}` })),
      ),
    );

  it('needs repeated evidence from several sources before calling something recurring', () => {
    const one = extractObservations(snapshot({ speakingAttempts: prepositionErrors(1, 1) }));
    expect(computeInsights(one.observations, one.exposures, NOW)[0]).toMatchObject({ category: 'prepositions', status: 'insufficient' });

    const two = extractObservations(snapshot({ speakingAttempts: prepositionErrors(2, 1) }));
    expect(computeInsights(two.observations, two.exposures, NOW)[0]).toMatchObject({ status: 'preliminary' });

    const singleSource = extractObservations(snapshot({ speakingAttempts: prepositionErrors(6, 1) }));
    expect(computeInsights(singleSource.observations, singleSource.exposures, NOW)[0]?.status).toBe('preliminary');

    const recurring = extractObservations(snapshot({ speakingAttempts: prepositionErrors(4, 2) }));
    const insight = computeInsights(recurring.observations, recurring.exposures, NOW)[0];
    expect(insight).toMatchObject({ status: 'recurring', errors: 4, sources: 2, modules: ['speaking'] });
    expect(insight?.explanation).toContain('4 mistakes with prepositions across 2 pieces of work in Speaking');
    expect(insight?.observationIds).toHaveLength(4);
  });

  it('does not count old evidence as recurring and never counts suggestions', () => {
    const old = extractObservations(snapshot({ speakingAttempts: prepositionErrors(4, 2, INSIGHT_THRESHOLDS.recurringRecencyDays + 5) }));
    expect(computeInsights(old.observations, old.exposures, NOW)[0]?.status).toBe('preliminary');

    const suggestions = extractObservations(
      snapshot({ writingAttempts: [1, 2, 3, 4, 5].map((index) => writingAttempt(`w${index}`, NOW - index * DAY, [{ kind: 'suggestion', category: 'word_choice', original: `phrase ${index}` }])) }),
    );
    const insight = computeInsights(suggestions.observations, suggestions.exposures, NOW)[0];
    expect(insight).toMatchObject({ category: 'vocabulary_precision', status: 'insufficient', errors: 0, suggestions: 5 });
  });

  it('recognises strengths from repeated success', () => {
    const sets = [grammarSet('g1', NOW - DAY, 'conditionals', ['right', 'right', 'right', 'right']), grammarSet('g2', NOW - 2 * DAY, 'conditionals', ['right', 'right', 'right', 'wrong'])];
    const result = extractObservations(snapshot({ grammarSets: sets }));
    expect(computeInsights(result.observations, result.exposures, NOW)[0]).toMatchObject({ category: 'conditionals', status: 'strength', successes: 7, errors: 1 });
  });

  it('detects improvement from error rates across windows', () => {
    const earlier = [grammarSet('old1', NOW - 50 * DAY, 'inversion', ['wrong', 'wrong', 'wrong', 'right']), grammarSet('old2', NOW - 45 * DAY, 'inversion', ['wrong', 'right', 'wrong', 'wrong'])];
    const recent = [grammarSet('new1', NOW - 5 * DAY, 'inversion', ['right', 'right', 'right', 'wrong']), grammarSet('new2', NOW - 2 * DAY, 'inversion', ['right', 'right', 'right', 'right'])];
    const result = extractObservations(snapshot({ grammarSets: [...earlier, ...recent] }));
    const insight = computeInsights(result.observations, result.exposures, NOW)[0];
    expect(insight).toMatchObject({ category: 'inversion', trend: 'improving', status: 'improving' });
    expect(insight?.earlierErrorRate).toBeCloseTo(0.75);
    expect(insight?.recentErrorRate).toBeCloseTo(0.125);
  });

  it('builds a weekly error timeline', () => {
    const result = extractObservations(snapshot({ speakingAttempts: prepositionErrors(4, 2) }));
    const timeline = errorTimeline(result.observations, 'prepositions', NOW, 4);
    expect(timeline.reduce((sum, value) => sum + value, 0)).toBe(4);
    expect(timeline.at(-1)).toBeGreaterThan(0);
  });
});

describe('recommendations', () => {
  const recurringData = () => {
    const attempts = [0, 1, 2].map((index) =>
      speakingAttempt(`a${index}`, NOW - (index + 1) * DAY, [
        { category: 'grammar', subcategory: 'preposition', original: `prep ${index}a` },
        { category: 'grammar', subcategory: 'preposition', original: `prep ${index}b` },
      ]),
    );
    const listening = [dictation('1', 'one two three four five', [{ at: NOW - DAY, answer: 'one too three for five' }]), dictation('2', 'six seven eight', [{ at: NOW - 2 * DAY, answer: 'sticks seven ate' }])];
    return snapshot({ speakingAttempts: attempts, listeningSessions: [SESSION], dictation: listening, vocabularyEntries: [vocabularyEntry('e1', NOW - 5 * DAY, [], NOW - 2 * DAY)] });
  };

  it('ranks recurring issues first and points each to a supported action', () => {
    const data = recurringData();
    const { observations, exposures } = extractObservations(data);
    const insights = computeInsights(observations, exposures, NOW);
    const { active } = computeRecommendations(insights, observations, data, [], [], NOW);
    expect(active[0]).toMatchObject({ id: recommendationId('prepositions'), action: { type: 'train', category: 'prepositions' }, preliminary: false });
    const listening = active.find((rec) => rec.category === 'listening_recognition');
    expect(listening?.action).toMatchObject({ type: 'open', path: '/listening/session/s1?mode=dictation' });
    expect(active.find((rec) => rec.id === recommendationId('vocabulary-due'))?.action).toMatchObject({ type: 'open', path: '/vocabulary/review' });
    expect(active.every((rec) => rec.observationIds.length > 0 || rec.category === null)).toBe(true);
  });

  it('lowers priority after recent targeted training and hides dismissed items until new evidence appears', () => {
    const data = recurringData();
    const { observations, exposures } = extractObservations(data);
    const insights = computeInsights(observations, exposures, NOW);
    const before = computeRecommendations(insights, observations, data, [], [], NOW).active.find((rec) => rec.category === 'prepositions');
    const trained = computeRecommendations(insights, observations, data, [], [{ id: 't', version: 1, category: 'prepositions', module: 'grammar', level: 'C1', recordId: 'g', title: 't', includedExamples: 0, createdAt: NOW - DAY }], NOW).active.find(
      (rec) => rec.category === 'prepositions',
    );
    expect(trained!.priority).toBeLessThan(before!.priority);
    expect(trained!.rationale).toContain('You generated targeted practice');

    const state = { id: recommendationId('prepositions'), version: 1 as const, status: 'dismissed' as const, evidenceAt: before!.evidenceAt, updatedAt: NOW };
    const dismissed = computeRecommendations(insights, observations, data, [state], [], NOW);
    expect(dismissed.active.some((rec) => rec.category === 'prepositions')).toBe(false);
    expect(dismissed.hidden[0]?.state.status).toBe('dismissed');

    const newer = { ...data, speakingAttempts: [...data.speakingAttempts, speakingAttempt('later', NOW, [{ category: 'grammar', subcategory: 'preposition', original: 'new prep error' }])] };
    const updated = extractObservations(newer);
    const back = computeRecommendations(computeInsights(updated.observations, updated.exposures, NOW), updated.observations, newer, [state], [], NOW);
    expect(back.active.find((rec) => rec.category === 'prepositions')).toMatchObject({ returned: true });
  });

  it('makes no recommendation without evidence', () => {
    expect(computeRecommendations([], [], emptySnapshot(), [], [], NOW)).toEqual({ active: [], hidden: [] });
  });
});

describe('personalized training', () => {
  it('only offers modules whose generators can target the category', () => {
    expect(trainingOptionsFor('prepositions').map((option) => option.module)).toEqual(['grammar', 'writing']);
    expect(trainingOptionsFor('coherence').map((option) => option.module)).toEqual(['writing', 'speaking']);
    expect(trainingOptionsFor('listening_recognition')).toEqual([]);
    expect(trainingOptionsFor('vocabulary_retention')).toEqual([]);
  });

  it('builds a bounded profile with at most five distinct, confident real examples', () => {
    const attempts = Array.from({ length: 4 }, (_, index) =>
      speakingAttempt(`a${index}`, NOW - index * DAY, [
        { category: 'grammar', subcategory: 'preposition', original: `wrong ${index}`, correction: `right ${index}` },
        { category: 'grammar', subcategory: 'preposition', original: `other ${index}`, correction: `fixed ${index}` },
      ]),
    );
    const { observations } = extractObservations(snapshot({ speakingAttempts: attempts }));
    const profile = buildTargetedPractice('prepositions', observations, true);
    expect(profile.examples).toHaveLength(MAX_PROFILE_EXAMPLES);
    expect(new Set(profile.examples.map((example) => example.original)).size).toBe(MAX_PROFILE_EXAMPLES);
    expect(buildTargetedPractice('prepositions', observations, false).examples).toEqual([]);
    expect(JSON.stringify(profile).length).toBeLessThan(2_000);
  });

  it('builds valid requests for the existing generators', () => {
    const targeted = { focus: 'Prepositions', description: 'Dependent prepositions.', examples: [{ original: 'depends of', corrected: 'depends on' }] };
    for (const option of [...trainingOptionsFor('prepositions'), ...trainingOptionsFor('coherence')]) {
      const request = buildTrainingRequest(option, { level: 'C1', questionCount: 8, targeted });
      expect(generationRequestSchema.safeParse(request).success).toBe(true);
    }
    expect(generationRequestSchema.safeParse({ ...buildTrainingRequest(trainingOptionsFor('conditionals')[0]!, { level: 'B2', questionCount: 4, targeted }), targetedPractice: { ...targeted, examples: Array(6).fill(targeted.examples[0]) } }).success).toBe(false);
  });
});
