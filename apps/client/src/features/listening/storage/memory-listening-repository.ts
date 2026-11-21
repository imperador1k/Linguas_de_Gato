import {
  listeningExerciseSetSchema,
  type DictationRecord,
  type ListeningExerciseSet,
  type ListeningSession,
  type TranscriptRecord,
} from '@ldg/shared';
import {
  assertStorableMedia,
  mediaRepair,
  sortByLastOpened,
  sortSetsNewestFirst,
  toTranscriptRecord,
  withMediaStored,
  type ListeningRepository,
  type MediaReconciliation,
  type TranscriptContent,
} from './listening-repository';

/**
 * Fallback used when IndexedDB is unavailable. Same contract, but data lives
 * only as long as the tab. Values are cloned so callers can't mutate storage.
 */
export class MemoryListeningRepository implements ListeningRepository {
  readonly persistent = false;

  private readonly sessions = new Map<string, ListeningSession>();
  private readonly transcripts = new Map<string, TranscriptRecord>();
  private readonly media = new Map<string, Blob>();
  private readonly dictation = new Map<string, DictationRecord>();
  private readonly exerciseSets = new Map<string, ListeningExerciseSet>();

  async listSessions(): Promise<ListeningSession[]> {
    return sortByLastOpened([...this.sessions.values()].map((session) => structuredClone(session)));
  }

  async getSession(id: string): Promise<ListeningSession | null> {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : null;
  }

  async createSession(session: ListeningSession, transcript?: TranscriptContent, media?: Blob): Promise<void> {
    if (this.sessions.has(session.id)) throw new Error(`Session ${session.id} already exists.`);
    if (media) assertStorableMedia(media);
    this.sessions.set(session.id, structuredClone(media ? withMediaStored(session, true, session.updatedAt) : session));
    if (transcript) this.transcripts.set(session.id, structuredClone(toTranscriptRecord(session.id, transcript)));
    if (media) this.media.set(session.id, media);
  }

  async updateSession(
    id: string,
    update: (session: ListeningSession) => ListeningSession,
  ): Promise<ListeningSession | null> {
    const current = this.sessions.get(id);
    if (!current) return null;
    const next = structuredClone(update(structuredClone(current)));
    this.sessions.set(id, next);
    return structuredClone(next);
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    this.transcripts.delete(id);
    this.media.delete(id);
    this.clearDictation(id);
    for (const [key, set] of this.exerciseSets) {
      if (set.sessionId === id) this.exerciseSets.delete(key);
    }
  }

  async getTranscript(sessionId: string): Promise<TranscriptRecord | null> {
    const record = this.transcripts.get(sessionId);
    return record ? structuredClone(record) : null;
  }

  async replaceTranscript(session: ListeningSession, transcript: TranscriptContent | null): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
    if (transcript) {
      this.transcripts.set(session.id, structuredClone(toTranscriptRecord(session.id, transcript)));
    } else {
      this.transcripts.delete(session.id);
    }
    this.clearDictation(session.id);
  }

  async getMedia(sessionId: string): Promise<Blob | null> {
    return this.media.get(sessionId) ?? null;
  }

  async reconcileMedia(sessionId: string): Promise<MediaReconciliation | null> {
    const current = this.sessions.get(sessionId);
    if (!current) return null;
    const present = this.media.has(sessionId);
    const repaired = mediaRepair(current, present);
    if (!repaired) return { session: structuredClone(current), present, repaired };
    const next = withMediaStored(current, present, Date.now());
    this.sessions.set(sessionId, next);
    return { session: structuredClone(next), present, repaired };
  }

  async listMediaKeys(): Promise<string[]> {
    return [...this.media.keys()];
  }

  async saveMedia(sessionId: string, media: Blob): Promise<ListeningSession | null> {
    assertStorableMedia(media);
    const current = this.sessions.get(sessionId);
    if (!current) return null;
    this.media.set(sessionId, media);
    const next = withMediaStored(current, true, Date.now());
    this.sessions.set(sessionId, next);
    return structuredClone(next);
  }

  async deleteMedia(sessionId: string): Promise<ListeningSession | null> {
    const current = this.sessions.get(sessionId);
    this.media.delete(sessionId);
    if (!current) return null;
    const next = withMediaStored(current, false, Date.now());
    this.sessions.set(sessionId, next);
    return structuredClone(next);
  }

  async listDictation(sessionId: string): Promise<DictationRecord[]> {
    return [...this.dictation.values()]
      .filter((record) => record.sessionId === sessionId)
      .map((record) => structuredClone(record));
  }

  async putDictation(record: DictationRecord): Promise<void> {
    this.dictation.set(JSON.stringify([record.sessionId, record.cueId]), structuredClone(record));
  }

  async listExerciseSets(sessionId: string): Promise<ListeningExerciseSet[]> {
    return sortSetsNewestFirst(
      [...this.exerciseSets.values()].filter((set) => set.sessionId === sessionId).map((set) => structuredClone(set)),
    );
  }

  async getExerciseSet(id: string): Promise<ListeningExerciseSet | null> {
    const set = this.exerciseSets.get(id);
    return set ? structuredClone(set) : null;
  }

  async putExerciseSet(set: ListeningExerciseSet): Promise<void> {
    this.exerciseSets.set(set.id, structuredClone(listeningExerciseSetSchema.parse(set)));
  }

  async deleteExerciseSet(id: string): Promise<void> {
    this.exerciseSets.delete(id);
  }

  private clearDictation(sessionId: string): void {
    for (const [key, record] of this.dictation) {
      if (record.sessionId === sessionId) this.dictation.delete(key);
    }
  }
}
