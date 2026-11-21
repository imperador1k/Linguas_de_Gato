import { countWords, type WritingDraft, type WritingTaskRecord } from '../contracts/writing.js';
import type { LearningModule, LearningSnapshot } from './observations.js';

/**
 * The Today page's view of the learner's work: what is unfinished (to
 * continue) and what happened recently. Everything comes from saved records;
 * an item exists only when a record shows real, unfinished or completed work.
 */

/** Extra records Today needs beyond the analytics snapshot. */
export interface TodaySnapshot extends LearningSnapshot {
  readonly writingDrafts: readonly WritingDraft[];
  readonly writingTasks: readonly WritingTaskRecord[];
}

export type WorkStatus =
  /** Started and saved, not finished (a draft, a partly answered set, a text being read). */
  | 'in_progress'
  /** Created but never started; offered only when recent. */
  | 'not_started'
  /** Done, but the feedback that should follow is missing. */
  | 'awaiting_feedback'
  | 'completed';

export interface WorkItem {
  /** Stable, unique per item. */
  readonly id: string;
  readonly module: LearningModule;
  readonly title: string;
  readonly detail: string;
  readonly path: string;
  readonly at: number;
  readonly status: WorkStatus;
}

const DAY = 86_400_000;
/** Created-but-untouched work older than this is not offered as "continue". */
export const NOT_STARTED_WINDOW_DAYS = 7;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatClock(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Unfinished work, newest first. */
export function unfinishedWork(snapshot: TodaySnapshot, now: number): WorkItem[] {
  const items: WorkItem[] = [];
  const recent = (at: number) => now - at <= NOT_STARTED_WINDOW_DAYS * DAY;
  const tasks = new Map(snapshot.writingTasks.map((task) => [task.id, task]));
  const sessions = new Map(snapshot.listeningSessions.map((session) => [session.id, session]));
  const texts = new Map(snapshot.readingTexts.map((text) => [text.id, text]));

  // Writing drafts with text in them.
  for (const draft of snapshot.writingDrafts) {
    const task = tasks.get(draft.taskId);
    const words = countWords(draft.text);
    if (!task || words === 0) continue;
    items.push({ id: `draft:${draft.taskId}`, module: 'writing', title: task.task.title, detail: `Draft · ${plural(words, 'word')}`, path: `/writing/tasks/${draft.taskId}`, at: draft.updatedAt, status: 'in_progress' });
  }

  // Submissions or recordings whose feedback never arrived (e.g. the request failed or was cancelled).
  for (const attempt of snapshot.writingAttempts) {
    if (attempt.assessment === null) items.push({ id: `writing:${attempt.id}`, module: 'writing', title: attempt.task.title, detail: 'Submitted · feedback not ready', path: `/writing/attempts/${attempt.id}`, at: attempt.submittedAt, status: 'awaiting_feedback' });
  }
  for (const attempt of snapshot.speakingAttempts) {
    if (attempt.assessment === null) items.push({ id: `speaking:${attempt.id}`, module: 'speaking', title: attempt.prompt.title, detail: 'Recorded · feedback not requested', path: `/speaking/attempts/${attempt.id}`, at: attempt.createdAt, status: 'awaiting_feedback' });
  }

  // Exercise sets: partly answered, or generated recently and not started.
  for (const set of snapshot.grammarSets) {
    if (set.checkedAt !== null) continue;
    const answered = set.answers.length;
    if (answered > 0) items.push({ id: `grammar:${set.id}`, module: 'grammar', title: set.set.title, detail: `${answered} of ${set.set.questions.length} answered`, path: `/grammar/sets/${set.id}`, at: set.updatedAt, status: 'in_progress' });
    else if (set.history.length === 0 && recent(set.createdAt)) items.push({ id: `grammar:${set.id}`, module: 'grammar', title: set.set.title, detail: `${plural(set.set.questions.length, 'question')} · not started`, path: `/grammar/sets/${set.id}`, at: set.createdAt, status: 'not_started' });
  }
  for (const set of snapshot.vocabularyPracticeSets) {
    if (set.checkedAt !== null) continue;
    const answered = set.answers.length;
    const title = `Practice on ${plural(set.entryIds.length, 'expression')}`;
    if (answered > 0) items.push({ id: `vocabulary-practice:${set.id}`, module: 'vocabulary', title, detail: `${answered} of ${set.questions.length} answered`, path: `/vocabulary/practice/${set.id}`, at: set.updatedAt, status: 'in_progress' });
    else if (set.history.length === 0 && recent(set.createdAt)) items.push({ id: `vocabulary-practice:${set.id}`, module: 'vocabulary', title, detail: `${plural(set.questions.length, 'question')} · not started`, path: `/vocabulary/practice/${set.id}`, at: set.createdAt, status: 'not_started' });
  }
  for (const set of snapshot.readingQuestionSets) {
    const text = texts.get(set.textId);
    if (set.submittedAt !== null || !text || set.answers.length === 0) continue;
    items.push({ id: `reading-questions:${set.id}`, module: 'reading', title: text.title, detail: `Questions · ${set.answers.length} of ${set.questions.length} answered`, path: `/reading/texts/${text.id}`, at: set.updatedAt, status: 'in_progress' });
  }
  for (const set of snapshot.listeningExerciseSets) {
    const session = sessions.get(set.sessionId);
    if (set.submittedAt !== null || !session || set.answers.length === 0) continue;
    items.push({ id: `listening-questions:${set.id}`, module: 'listening', title: session.title, detail: `Questions · ${set.answers.length} of ${set.questions.length} answered`, path: `/listening/session/${session.id}?mode=exercises`, at: set.updatedAt, status: 'in_progress' });
  }

  // Texts being read.
  for (const text of snapshot.readingTexts) {
    if (text.progress.completedAt !== null) continue;
    const read = text.progress.furthestParagraph + 1;
    if (text.progress.furthestParagraph > 0) items.push({ id: `reading:${text.id}`, module: 'reading', title: text.title, detail: `Read ${read} of ${plural(text.paragraphs.length, 'paragraph')}`, path: `/reading/texts/${text.id}`, at: text.progress.lastOpenedAt, status: 'in_progress' });
    else if (recent(text.createdAt)) items.push({ id: `reading:${text.id}`, module: 'reading', title: text.title, detail: `${plural(text.wordCount, 'word')} · not started`, path: `/reading/texts/${text.id}`, at: text.createdAt, status: 'not_started' });
  }

  // Listening sessions with dictation under way, or opened recently with a saved position.
  const dictationBySession = new Map<string, { lines: number; lastAt: number }>();
  for (const record of snapshot.dictation) {
    const lastAt = Math.max(0, ...record.attempts.map((attempt) => attempt.submittedAt));
    if (record.attempts.length === 0) continue;
    const current = dictationBySession.get(record.sessionId) ?? { lines: 0, lastAt: 0 };
    dictationBySession.set(record.sessionId, { lines: current.lines + 1, lastAt: Math.max(current.lastAt, lastAt) });
  }
  for (const session of snapshot.listeningSessions) {
    const dictation = dictationBySession.get(session.id);
    const total = session.transcript?.cueCount ?? 0;
    if (dictation && total > 0 && dictation.lines < total) {
      items.push({ id: `listening:${session.id}`, module: 'listening', title: session.title, detail: `Dictation · ${dictation.lines} of ${plural(total, 'line')}`, path: `/listening/session/${session.id}?mode=dictation`, at: Math.max(dictation.lastAt, session.lastOpenedAt), status: 'in_progress' });
    } else if (!dictation && session.playback.positionSeconds > 0 && recent(session.lastOpenedAt)) {
      items.push({ id: `listening:${session.id}`, module: 'listening', title: session.title, detail: `Stopped at ${formatClock(session.playback.positionSeconds)}`, path: `/listening/session/${session.id}`, at: session.lastOpenedAt, status: 'in_progress' });
    }
  }

  return items.sort((a, b) => b.at - a.at);
}

/** Completed work, newest first. Repetitive actions (dictation lines, reviews, saves) are grouped per day. */
export function completedWork(snapshot: TodaySnapshot): WorkItem[] {
  const items: WorkItem[] = [];
  const sessions = new Map(snapshot.listeningSessions.map((session) => [session.id, session]));
  const texts = new Map(snapshot.readingTexts.map((text) => [text.id, text]));

  for (const attempt of snapshot.speakingAttempts) {
    if (attempt.assessment) items.push({ id: `speaking:${attempt.id}`, module: 'speaking', title: attempt.prompt.title, detail: `Recorded ${formatClock(attempt.recordingDurationMs / 1000)} · feedback ready`, path: `/speaking/attempts/${attempt.id}`, at: attempt.createdAt, status: 'completed' });
  }
  for (const attempt of snapshot.writingAttempts) {
    if (attempt.assessment) items.push({ id: `writing:${attempt.id}`, module: 'writing', title: attempt.task.title, detail: `${plural(attempt.wordCount, 'word')} · feedback ready`, path: `/writing/attempts/${attempt.id}`, at: attempt.submittedAt, status: 'completed' });
  }
  for (const set of snapshot.grammarSets) {
    const last = set.history.at(-1);
    if (last) items.push({ id: `grammar:${set.id}`, module: 'grammar', title: set.set.title, detail: `Checked · ${last.correct} of ${last.total} correct`, path: `/grammar/sets/${set.id}`, at: last.checkedAt, status: 'completed' });
  }
  for (const set of snapshot.vocabularyPracticeSets) {
    const last = set.history.at(-1);
    if (last) items.push({ id: `vocabulary-practice:${set.id}`, module: 'vocabulary', title: `Practice on ${plural(set.entryIds.length, 'expression')}`, detail: `Checked · ${last.correct} of ${last.objectiveTotal} correct`, path: `/vocabulary/practice/${set.id}`, at: last.checkedAt, status: 'completed' });
  }
  for (const text of snapshot.readingTexts) {
    if (text.progress.completedAt !== null) items.push({ id: `reading:${text.id}`, module: 'reading', title: text.title, detail: `Finished · ${plural(text.wordCount, 'word')}`, path: `/reading/texts/${text.id}`, at: text.progress.completedAt, status: 'completed' });
  }
  for (const set of snapshot.readingQuestionSets) {
    const text = texts.get(set.textId);
    if (set.submittedAt !== null && text) items.push({ id: `reading-questions:${set.id}`, module: 'reading', title: text.title, detail: `Questions checked · ${plural(set.questions.length, 'question')}`, path: `/reading/texts/${text.id}`, at: set.submittedAt, status: 'completed' });
  }
  for (const set of snapshot.listeningExerciseSets) {
    const session = sessions.get(set.sessionId);
    if (set.submittedAt !== null && session) items.push({ id: `listening-questions:${set.id}`, module: 'listening', title: session.title, detail: `Questions checked · ${plural(set.questions.length, 'question')}`, path: `/listening/session/${session.id}?mode=exercises`, at: set.submittedAt, status: 'completed' });
  }

  // Dictation: one item per session and day.
  const dictation = new Map<string, { sessionId: string; lines: Set<string>; at: number }>();
  for (const record of snapshot.dictation) {
    for (const attempt of record.attempts) {
      const key = `${record.sessionId}|${dayKey(attempt.submittedAt)}`;
      const group = dictation.get(key) ?? { sessionId: record.sessionId, lines: new Set<string>(), at: 0 };
      group.lines.add(record.cueId);
      group.at = Math.max(group.at, attempt.submittedAt);
      dictation.set(key, group);
    }
  }
  for (const [key, group] of dictation) {
    const session = sessions.get(group.sessionId);
    if (session) items.push({ id: `dictation:${key}`, module: 'listening', title: session.title, detail: `Dictation · ${plural(group.lines.size, 'line')}`, path: `/listening/session/${session.id}?mode=dictation`, at: group.at, status: 'completed' });
  }

  // Vocabulary reviews and saved expressions: one item per day each.
  const reviews = new Map<string, { count: number; at: number }>();
  const saves = new Map<string, { count: number; at: number }>();
  for (const entry of snapshot.vocabularyEntries) {
    for (const rating of entry.review.history) {
      const group = reviews.get(dayKey(rating.at)) ?? { count: 0, at: 0 };
      reviews.set(dayKey(rating.at), { count: group.count + 1, at: Math.max(group.at, rating.at) });
    }
    for (const sense of entry.senses) {
      const group = saves.get(dayKey(sense.addedAt)) ?? { count: 0, at: 0 };
      saves.set(dayKey(sense.addedAt), { count: group.count + 1, at: Math.max(group.at, sense.addedAt) });
    }
  }
  for (const [day, group] of reviews) items.push({ id: `reviews:${day}`, module: 'vocabulary', title: 'Vocabulary review', detail: `${plural(group.count, 'expression')} reviewed`, path: '/vocabulary', at: group.at, status: 'completed' });
  for (const [day, group] of saves) items.push({ id: `saves:${day}`, module: 'vocabulary', title: 'Saved to your collection', detail: `${plural(group.count, 'meaning')} saved`, path: '/vocabulary', at: group.at, status: 'completed' });

  return items.sort((a, b) => b.at - a.at);
}

/**
 * The Today page's lists, without repetition: the top unfinished items go to
 * "Continue"; recent activity merges the rest with completed work.
 */
export function todayWork(snapshot: TodaySnapshot, now: number, options: { continueLimit?: number; activityLimit?: number } = {}) {
  const unfinished = unfinishedWork(snapshot, now);
  const continueItems = unfinished.slice(0, options.continueLimit ?? 3);
  const shown = new Set(continueItems.map((item) => item.id));
  const activity = [...unfinished.filter((item) => !shown.has(item.id)), ...completedWork(snapshot)]
    .sort((a, b) => b.at - a.at)
    .slice(0, options.activityLimit ?? 8);
  return { continueItems, activity, unfinishedCount: unfinished.length };
}
