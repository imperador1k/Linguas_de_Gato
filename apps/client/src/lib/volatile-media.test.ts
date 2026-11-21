import { describe, expect, it } from 'vitest';
import { clearVolatileMedia, getVolatileMedia, reloadDecision, setVolatileMedia, type VolatileMedia } from './volatile-media';

const entry: VolatileMedia = { key: 'listening:a', kind: 'listening', label: 'talk.mp3', path: '/listening/session/a' };

describe('volatile media registry', () => {
  it('tracks media that only exists in this tab, once per key', () => {
    setVolatileMedia(entry);
    setVolatileMedia({ ...entry, label: 'renamed.mp3' });
    expect(getVolatileMedia().filter((item) => item.key === entry.key)).toEqual([{ ...entry, label: 'renamed.mp3' }]);
    clearVolatileMedia(entry.key);
    expect(getVolatileMedia().some((item) => item.key === entry.key)).toBe(false);
  });

  it('returns a stable snapshot until something changes', () => {
    const before = getVolatileMedia();
    clearVolatileMedia('not-there');
    expect(getVolatileMedia()).toBe(before);
  });
});

describe('reloadDecision', () => {
  it('waits for in-flight work, even with unsaved media', () => {
    expect(reloadDecision({ busy: true, volatile: [entry] })).toBe('wait');
  });

  it('asks first when unsaved media would be lost', () => {
    expect(reloadDecision({ busy: false, volatile: [entry] })).toBe('confirm');
  });

  it('reloads straight away when nothing would be lost', () => {
    expect(reloadDecision({ busy: false, volatile: [] })).toBe('reload');
  });
});
