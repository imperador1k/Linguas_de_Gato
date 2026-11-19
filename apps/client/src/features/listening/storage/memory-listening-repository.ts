import type { DictationRecord, ListeningSession, TranscriptRecord } from '@ldg/shared';
import {
  sortByLastOpened,
  toTranscriptRecord,
  withMediaStored,
  type ListeningRepository,
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

  async listSessions(): Promise<ListeningSession[]> {
    return sortByLastOpened([...this.sessions.values()].map((session) => structuredClone(session)));
  }

  async getSession(id: string): Promise<ListeningSession | null> {
    const session = this.sessions.get(id);
    return session ? structuredClone(session) : null;
  }

  async createSession(session: ListeningSession, transcript?: TranscriptContent): Promise<void> {
    if (this.sessions.has(session.id)) throw new Error(`Session ${session.id} already exists.`);
    this.sessions.set(session.id, structuredClone(session));
    if (transcript) this.transcripts.set(session.id, structuredClone(toTranscriptRecord(session.id, transcript)));
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

  async saveMedia(sessionId: string, media: Blob): Promise<ListeningSession | null> {
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

  private clearDictation(sessionId: string): void {
    for (const [key, record] of this.dictation) {
      if (record.sessionId === sessionId) this.dictation.delete(key);
    }
  }
}
