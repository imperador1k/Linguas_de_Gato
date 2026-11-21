import type { CustomTopic, SpeakingAttempt } from '@ldg/shared';
import {
  assertStorableRecording,
  recordingRepair,
  sortNewestFirst,
  withRecordingStored,
  type RecordingReconciliation,
  type SpeakingRepository,
} from './speaking-repository';

/** Fallback when IndexedDB is unavailable: same contract, data lasts until the tab closes. */
export class MemorySpeakingRepository implements SpeakingRepository {
  readonly persistent = false;

  private readonly attempts = new Map<string, SpeakingAttempt>();
  private readonly recordings = new Map<string, Blob>();
  private readonly topics = new Map<string, CustomTopic>();

  async listAttempts(): Promise<SpeakingAttempt[]> {
    return sortNewestFirst([...this.attempts.values()].map((attempt) => structuredClone(attempt)));
  }

  async getAttempt(id: string): Promise<SpeakingAttempt | null> {
    const attempt = this.attempts.get(id);
    return attempt ? structuredClone(attempt) : null;
  }

  async putAttempt(attempt: SpeakingAttempt, recording?: Blob): Promise<void> {
    if (recording) assertStorableRecording(recording);
    this.attempts.set(attempt.id, structuredClone(recording ? withRecordingStored(attempt, true, attempt.updatedAt) : attempt));
    if (recording) this.recordings.set(attempt.id, recording);
  }

  async reconcileRecording(attemptId: string): Promise<RecordingReconciliation | null> {
    const current = this.attempts.get(attemptId);
    if (!current) return null;
    const present = this.recordings.has(attemptId);
    const repaired = recordingRepair(current, present);
    if (!repaired) return { attempt: structuredClone(current), present, repaired };
    const next = withRecordingStored(current, present, Date.now());
    this.attempts.set(attemptId, next);
    return { attempt: structuredClone(next), present, repaired };
  }

  async listRecordingKeys(): Promise<string[]> {
    return [...this.recordings.keys()];
  }

  async updateAttempt(id: string, update: (attempt: SpeakingAttempt) => SpeakingAttempt): Promise<SpeakingAttempt | null> {
    const current = this.attempts.get(id);
    if (!current) return null;
    const next = structuredClone(update(structuredClone(current)));
    this.attempts.set(id, next);
    return structuredClone(next);
  }

  async deleteAttempt(id: string): Promise<void> {
    this.attempts.delete(id);
    this.recordings.delete(id);
  }

  async getRecording(attemptId: string): Promise<Blob | null> {
    return this.recordings.get(attemptId) ?? null;
  }

  async saveRecording(attemptId: string, recording: Blob): Promise<SpeakingAttempt | null> {
    assertStorableRecording(recording);
    const current = this.attempts.get(attemptId);
    if (!current) return null;
    this.recordings.set(attemptId, recording);
    const next = withRecordingStored(current, true, Date.now());
    this.attempts.set(attemptId, next);
    return structuredClone(next);
  }

  async deleteRecording(attemptId: string): Promise<SpeakingAttempt | null> {
    this.recordings.delete(attemptId);
    const current = this.attempts.get(attemptId);
    if (!current) return null;
    const next = withRecordingStored(current, false, Date.now());
    this.attempts.set(attemptId, next);
    return structuredClone(next);
  }

  async listTopics(): Promise<CustomTopic[]> {
    return sortNewestFirst([...this.topics.values()].map((topic) => structuredClone(topic)));
  }

  async putTopic(topic: CustomTopic): Promise<void> {
    this.topics.set(topic.id, structuredClone(topic));
  }

  async deleteTopic(id: string): Promise<void> {
    this.topics.delete(id);
  }
}
