import { describe, expect, it } from 'vitest';
import type { WritingDraft, WritingTaskRecord } from '../contracts/writing.js';
import { DAY, NOW, SESSION, TASK, dictation, emptySnapshot, grammarSet, listeningSet, practiceSet, readingSet, readingText, speakingAttempt, vocabularyEntry, writingAttempt } from './fixtures.test-helpers.js';
import { completedWork, todayWork, unfinishedWork, type TodaySnapshot } from './today.js';

const today = (overrides: Partial<TodaySnapshot>): TodaySnapshot => ({ ...emptySnapshot(), writingDrafts: [], writingTasks: [], ...overrides });

const taskRecord = (id: string, at: number): WritingTaskRecord => ({ id, version: 1, task: { ...TASK, title: `Task ${id}` }, category: 'society', model: 'm', createdAt: at, updatedAt: at });
const draft = (taskId: string, text: string, at: number): WritingDraft => ({ taskId, version: 1, text, timerElapsedMs: 0, createdAt: at, updatedAt: at });

describe('unfinished work', () => {
  it('finds drafts, partly answered sets, texts being read and dictation under way', () => {
    const items = unfinishedWork(
      today({
        writingTasks: [taskRecord('t1', NOW - 5 * DAY)],
        writingDrafts: [draft('t1', 'Some words already written here.', NOW - DAY)],
        grammarSets: [grammarSet('g-open', null, 'inversion', ['right', 'wrong', 'blank'])],
        readingTexts: [{ ...readingText('r1', null), paragraphs: ['a', 'b', 'c'], progress: { furthestParagraph: 1, completedAt: null, lastOpenedAt: NOW - 2 * DAY } }],
        listeningSessions: [SESSION],
        dictation: [dictation('1', 'The weather is lovely today', [{ at: NOW - 3 * DAY, answer: 'The weather' }])],
      }),
      NOW,
    );
    expect(items.map((item) => [item.id, item.status, item.detail])).toEqual(
      expect.arrayContaining([
        ['draft:t1', 'in_progress', 'Draft · 5 words'],
        ['grammar:g-open', 'in_progress', '2 of 3 answered'],
        ['reading:r1', 'in_progress', 'Read 2 of 3 paragraphs'],
        ['listening:s1', 'in_progress', 'Dictation · 1 of 2 lines'],
      ]),
    );
    expect(items.find((item) => item.id === 'draft:t1')?.path).toBe('/writing/tasks/t1');
    expect(items.find((item) => item.id === 'listening:s1')?.path).toBe('/listening/session/s1?mode=dictation');
    // Newest first.
    expect(items.map((item) => item.at)).toEqual([...items.map((item) => item.at)].sort((a, b) => b - a));
  });

  it('says whether a file session can play its audio, and says nothing for YouTube', () => {
    const fileSource = { kind: 'file' as const, fileName: 'talk.mp3', fileSize: 1000, lastModified: 1, mimeType: 'audio/mpeg', formatExtension: 'mp3', mediaKind: 'audio' as const };
    const records = [dictation('1', 'The weather is lovely today', [{ at: NOW - 3 * DAY, answer: 'The weather' }])];
    const media = (session: typeof SESSION) => unfinishedWork(today({ listeningSessions: [session], dictation: records }), NOW).find((item) => item.id === 'listening:s1');
    expect(media(SESSION)).not.toHaveProperty('media');
    expect(media({ ...SESSION, source: { ...fileSource, mediaStored: true } })).toMatchObject({ media: 'audio-saved', sessionId: 's1' });
    expect(media({ ...SESSION, source: { ...fileSource, mediaStored: false } })).toMatchObject({ media: 'needs-file', sessionId: 's1' });
  });

  it('flags work whose feedback is missing, and never invents unfinished work', () => {
    const noFeedback = { ...speakingAttempt('sp-x', NOW - DAY, []), assessment: null };
    const items = unfinishedWork(today({ speakingAttempts: [noFeedback, speakingAttempt('sp-done', NOW, [])] }), NOW);
    expect(items).toEqual([expect.objectContaining({ id: 'speaking:sp-x', status: 'awaiting_feedback', path: '/speaking/attempts/sp-x' })]);
    expect(unfinishedWork(today({}), NOW)).toEqual([]);
  });

  it('ignores empty drafts, finished work and old untouched sets', () => {
    const items = unfinishedWork(
      today({
        writingTasks: [taskRecord('t1', NOW)],
        writingDrafts: [draft('t1', '   ', NOW)],
        grammarSets: [grammarSet('g-checked', NOW, 'inversion', ['right']), { ...grammarSet('g-old', null, 'inversion', ['blank']), createdAt: NOW - 30 * DAY }],
        readingTexts: [readingText('done', NOW - DAY)],
      }),
      NOW,
    );
    expect(items).toEqual([]);
  });

  it('offers recently generated, unstarted sets as not started', () => {
    const fresh = { ...grammarSet('g-new', null, 'inversion', ['blank', 'blank']), createdAt: NOW - DAY };
    expect(unfinishedWork(today({ grammarSets: [fresh] }), NOW)).toEqual([expect.objectContaining({ status: 'not_started', detail: '2 questions · not started' })]);
  });
});

describe('completed work and the Today lists', () => {
  const data = today({
    listeningSessions: [SESSION],
    dictation: [dictation('1', 'a b', [{ at: NOW - DAY, answer: 'a b' }]), dictation('2', 'c d', [{ at: NOW - DAY + 1000, answer: 'c' }])],
    listeningExerciseSets: [listeningSet('l1', NOW - 2 * DAY, [true])],
    speakingAttempts: [speakingAttempt('sp1', NOW - 3 * DAY, [])],
    writingAttempts: [writingAttempt('w1', NOW - 4 * DAY, [])],
    grammarSets: [grammarSet('g1', NOW - 5 * DAY, 'inversion', ['right', 'wrong']), grammarSet('g-open', null, 'conditionals', ['right', 'blank'])],
    readingTexts: [readingText('t1', NOW - 6 * DAY)],
    readingQuestionSets: [readingSet('rq', 't1', NOW - 6 * DAY, [{ type: 'detail', right: true }])],
    vocabularyEntries: [vocabularyEntry('e1', NOW - DAY, [{ at: NOW - DAY, rating: 'good' }]), vocabularyEntry('e2', NOW - DAY, [{ at: NOW - DAY + 5, rating: 'again' }])],
    vocabularyPracticeSets: [practiceSet('p1', NOW - 2 * DAY, 'e1', ['right', 'wrong'])],
  });

  it('groups repetitive actions per day and links every item to its record', () => {
    const items = completedWork(data);
    expect(items.find((item) => item.module === 'listening' && item.detail.startsWith('Dictation'))).toMatchObject({ detail: 'Dictation · 2 lines', path: '/listening/session/s1?mode=dictation' });
    expect(items.filter((item) => item.id.startsWith('reviews:'))).toEqual([expect.objectContaining({ detail: '2 expressions reviewed' })]);
    expect(items.find((item) => item.id === 'grammar:g1')).toMatchObject({ detail: 'Checked · 1 of 2 correct', path: '/grammar/sets/g1' });
    expect(items.every((item) => item.status === 'completed' && item.path.startsWith('/'))).toBe(true);
  });

  it('never repeats a continued item in recent activity', () => {
    const { continueItems, activity, unfinishedCount } = todayWork(data, NOW, { continueLimit: 1 });
    expect(continueItems.map((item) => item.id)).toEqual(['grammar:g-open']);
    expect(unfinishedCount).toBe(1);
    expect(activity.some((item) => item.id === 'grammar:g-open')).toBe(false);
    expect(new Set(activity.map((item) => item.id)).size).toBe(activity.length);
    expect(activity.length).toBeLessThanOrEqual(8);
  });
});
