import { describe, expect, it } from 'vitest';
import { CHECK_INTERVAL_MS, isNewerBuild, shouldCheck } from './version-check';

describe('isNewerBuild', () => {
  it('detects a different build id', () => {
    expect(isNewerBuild('2026-11-20T10:00:00.000Z', { buildId: '2026-11-21T09:00:00.000Z' })).toBe(true);
  });

  it('ignores the same build', () => {
    expect(isNewerBuild('a', { buildId: 'a' })).toBe(false);
  });

  it('never reports a new version in development', () => {
    expect(isNewerBuild('dev', { buildId: 'anything' })).toBe(false);
  });

  it('ignores malformed payloads', () => {
    for (const payload of [null, undefined, 'b', 42, {}, { buildId: '' }, { buildId: 7 }, { buildId: 'x'.repeat(101) }]) {
      expect(isNewerBuild('a', payload)).toBe(false);
    }
  });
});

describe('shouldCheck', () => {
  it('waits for the interval between checks', () => {
    expect(shouldCheck(0, CHECK_INTERVAL_MS - 1)).toBe(false);
    expect(shouldCheck(0, CHECK_INTERVAL_MS)).toBe(true);
  });
});
