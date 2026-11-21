import { describe, expect, it } from 'vitest';
import {
  AUTO_KEEP_MEDIA_MAX_BYTES,
  MAX_STORED_MEDIA_BYTES,
  MAX_STORED_RECORDING_BYTES,
  MEDIA_QUOTA_HEADROOM_BYTES,
  listeningMediaState,
  planMediaRetention,
  recordingState,
} from './media-retention.js';

const MB = 1024 ** 2;
const roomy = { usage: 0, quota: 10_000 * MB };

describe('planMediaRetention', () => {
  it('keeps reasonably sized files by default', () => {
    expect(planMediaRetention({ size: 20 * MB, persistent: true, estimate: roomy })).toEqual({ allowed: true, defaultKeep: true, blocker: null, freeBytes: 10_000 * MB });
  });

  it('allows but does not pre-select large files', () => {
    const plan = planMediaRetention({ size: AUTO_KEEP_MEDIA_MAX_BYTES + 1, persistent: true, estimate: roomy });
    expect(plan.allowed).toBe(true);
    expect(plan.defaultKeep).toBe(false);
  });

  it('refuses files over the cap', () => {
    expect(planMediaRetention({ size: MAX_STORED_MEDIA_BYTES + 1, persistent: true, estimate: roomy }).blocker).toBe('too-large');
  });

  it('refuses when the browser cannot keep data at all', () => {
    expect(planMediaRetention({ size: MB, persistent: false, estimate: roomy }).blocker).toBe('not-persistent');
  });

  it('refuses when the copy would eat into the headroom', () => {
    const estimate = { usage: 0, quota: 10 * MB + MEDIA_QUOTA_HEADROOM_BYTES - 1 };
    const plan = planMediaRetention({ size: 10 * MB, persistent: true, estimate });
    expect(plan).toMatchObject({ allowed: false, defaultKeep: false, blocker: 'storage-full' });
  });

  it('does not refuse when the browser does not report an estimate', () => {
    expect(planMediaRetention({ size: MB, persistent: true, estimate: null })).toMatchObject({ allowed: true, defaultKeep: true, freeBytes: null });
  });

  it('rejects empty or invalid sizes', () => {
    expect(planMediaRetention({ size: 0, persistent: true, estimate: roomy }).blocker).toBe('empty');
    expect(planMediaRetention({ size: Number.NaN, persistent: true, estimate: roomy }).blocker).toBe('empty');
  });

  it('applies the recording cap when given', () => {
    expect(planMediaRetention({ size: MAX_STORED_RECORDING_BYTES + 1, persistent: true, estimate: roomy, maxBytes: MAX_STORED_RECORDING_BYTES }).blocker).toBe('too-large');
  });
});

describe('listeningMediaState', () => {
  const file = (mediaStored: boolean) => ({ kind: 'file', mediaStored });

  it('is saved only when the flag is set and the copy really exists', () => {
    expect(listeningMediaState(file(true), { stored: true, inMemory: false })).toBe('saved');
    expect(listeningMediaState(file(true), { stored: false, inMemory: false })).toBe('needs-file');
  });

  it('distinguishes an open, unsaved file from one that needs reconnecting', () => {
    expect(listeningMediaState(file(false), { stored: false, inMemory: true })).toBe('this-visit');
    expect(listeningMediaState(file(false), { stored: false, inMemory: false })).toBe('needs-file');
  });

  it('does not apply to YouTube', () => {
    expect(listeningMediaState({ kind: 'youtube' }, { stored: false, inMemory: false })).toBe('not-applicable');
  });
});

describe('recordingState', () => {
  it('reports saved, this visit and not kept honestly', () => {
    expect(recordingState({ stored: true }, { stored: true, inMemory: false })).toBe('saved');
    expect(recordingState({ stored: true }, { stored: false, inMemory: false })).toBe('not-kept');
    expect(recordingState({ stored: false }, { stored: false, inMemory: true })).toBe('this-visit');
  });
});
