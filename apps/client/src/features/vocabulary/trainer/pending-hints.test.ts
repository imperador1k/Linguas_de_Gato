import { hintMask, nextHint } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { PENDING_HINTS_MAX_AGE, clearPendingHints, clearRoundHints, loadPendingHints, savePendingHints, type HintStore } from './pending-hints';
import { memoryHintStore } from './pending-hints.test-helpers';

const NOW = Date.UTC(2026, 10, 21, 12);

describe('pending trainer hints', () => {
  it('restores one hint after leaving and resuming the round', () => {
    const store = memoryHintStore();
    savePendingHints('round-a', 'q2', ['length'], NOW, store);
    // "Leaving": nothing is kept in memory; resuming reads storage again.
    expect(loadPendingHints('round-a', 'q2', 'recipe', store)).toEqual(['length']);
    expect(hintMask('recipe', loadPendingHints('round-a', 'q2', 'recipe', store))).toBe('_ _ _ _ _ _');
  });

  it('restores several hints and continues the same progression', () => {
    const store = memoryHintStore();
    savePendingHints('round-a', 'q1', ['length', 'first_letter', 'letter'], NOW, store);
    const restored = loadPendingHints('round-a', 'q1', 'colleague', store);
    expect(restored).toEqual(['length', 'first_letter', 'letter']);
    expect(hintMask('colleague', restored)).toBe('c o _ _ _ _ _ _ _');
    // The next hint follows on from the restored ones.
    expect(nextHint('colleague', restored)).toBe('letter');
  });

  it('does not leak between rounds or between questions', () => {
    const store = memoryHintStore();
    savePendingHints('round-a', 'q1', ['length', 'first_letter'], NOW, store);
    expect(loadPendingHints('round-b', 'q1', 'colleague', store)).toEqual([]);
    expect(loadPendingHints('round-a', 'q2', 'colleague', store)).toEqual([]);
  });

  it('forgets a question once it is answered, and the whole round once it is checked', () => {
    const store = memoryHintStore();
    savePendingHints('round-a', 'q1', ['length'], NOW, store);
    savePendingHints('round-a', 'q2', ['length', 'first_letter'], NOW, store);
    clearPendingHints('round-a', 'q1', store);
    expect(loadPendingHints('round-a', 'q1', 'recipe', store)).toEqual([]);
    expect(loadPendingHints('round-a', 'q2', 'recipe', store)).toEqual(['length', 'first_letter']);
    clearPendingHints('round-a', 'q2', store);
    expect(store.size).toBe(0);
    savePendingHints('round-a', 'q3', ['length'], NOW, store);
    clearRoundHints('round-a', store);
    expect(store.size).toBe(0);
  });

  it('treats missing or damaged state as no hints, keeping only a valid progression', () => {
    const store = memoryHintStore();
    store.setItem('ldg.trainer.pendingHints.r1', '{not json');
    store.setItem('ldg.trainer.pendingHints.r2', JSON.stringify({ at: NOW, questions: { q1: 'length' } }));
    store.setItem('ldg.trainer.pendingHints.r3', JSON.stringify({ at: NOW, questions: { q1: ['letter'] } }));
    store.setItem('ldg.trainer.pendingHints.r4', JSON.stringify({ at: NOW, questions: { q1: ['length', 'cheat', 'first_letter'] } }));
    store.setItem('ldg.trainer.pendingHints.r5', JSON.stringify([1, 2]));
    // More "letter" hints than the word allows: cut where the progression would give the word away.
    store.setItem('ldg.trainer.pendingHints.r6', JSON.stringify({ at: NOW, questions: { q1: ['length', 'first_letter', 'letter', 'letter', 'letter', 'letter'] } }));
    expect(loadPendingHints('r0', 'q1', 'go', store)).toEqual([]);
    expect(loadPendingHints('r1', 'q1', 'recipe', store)).toEqual([]);
    expect(loadPendingHints('r2', 'q1', 'recipe', store)).toEqual([]);
    expect(loadPendingHints('r3', 'q1', 'recipe', store)).toEqual([]);
    expect(loadPendingHints('r4', 'q1', 'recipe', store)).toEqual(['length']);
    expect(loadPendingHints('r5', 'q1', 'recipe', store)).toEqual([]);
    // "knife": five letters, so at most three extra letters (the last one is never revealed).
    expect(loadPendingHints('r6', 'q1', 'knife', store)).toEqual(['length', 'first_letter', 'letter', 'letter', 'letter']);
  });

  it('never throws when storage is unavailable, blocked or full', () => {
    const broken: HintStore = {
      getItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('Full', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
      key: () => null,
      length: 0,
    };
    expect(loadPendingHints('r', 'q1', 'recipe', null)).toEqual([]);
    expect(loadPendingHints('r', 'q1', 'recipe', broken)).toEqual([]);
    expect(() => savePendingHints('r', 'q1', ['length'], NOW, broken)).not.toThrow();
    expect(() => clearPendingHints('r', 'q1', broken)).not.toThrow();
    expect(() => clearRoundHints('r', broken)).not.toThrow();
  });

  it('forgets rounds left untouched for a long time', () => {
    const store = memoryHintStore();
    savePendingHints('old-round', 'q1', ['length'], NOW - PENDING_HINTS_MAX_AGE - 1, store);
    savePendingHints('new-round', 'q1', ['length'], NOW, store);
    expect(loadPendingHints('old-round', 'q1', 'recipe', store)).toEqual([]);
    expect(loadPendingHints('new-round', 'q1', 'recipe', store)).toEqual(['length']);
  });
});
