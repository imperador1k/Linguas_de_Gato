import { describe, expect, it } from 'vitest';
import { clamp, formatPreciseTimestamp, formatSpokenDuration, formatTimestamp } from './time.js';

describe('formatTimestamp', () => {
  it.each([
    [0, '0:00'],
    [5.9, '0:05'],
    [65, '1:05'],
    [600, '10:00'],
    [3723, '1:02:03'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00'],
    [-10, '0:00'],
  ])('%d → %s', (input, expected) => {
    expect(formatTimestamp(input)).toBe(expected);
  });

  it('can force the hours field', () => {
    expect(formatTimestamp(65, { forceHours: true })).toBe('0:01:05');
  });
});

describe('formatSpokenDuration', () => {
  it.each([
    [0, '0 seconds'],
    [1, '1 second'],
    [61, '1 minute 1 second'],
    [120, '2 minutes'],
    [3725, '1 hour 2 minutes 5 seconds'],
  ])('%d → %s', (input, expected) => {
    expect(formatSpokenDuration(input)).toBe(expected);
  });
});

describe('clamp', () => {
  it('limits values to a range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('formatPreciseTimestamp', () => {
  it('formats milliseconds with tenths of a second', () => {
    expect(formatPreciseTimestamp(0)).toBe('0:00.0');
    expect(formatPreciseTimestamp(12_345)).toBe('0:12.3');
    expect(formatPreciseTimestamp(3_723_990)).toBe('1:02:03.9');
  });

  it('treats invalid input as zero', () => {
    expect(formatPreciseTimestamp(Number.NaN)).toBe('0:00.0');
    expect(formatPreciseTimestamp(-50)).toBe('0:00.0');
  });
});
