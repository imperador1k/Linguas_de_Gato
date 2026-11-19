import { describe, expect, it } from 'vitest';
import type { TimedWord, TranscriptSegment } from '../contracts/transcription.js';
import { buildTranscriptCues } from './transcript-cues.js';

function segment(id: number, startMs: number, endMs: number, text: string): TranscriptSegment {
  return { id: String(id), startMs, endMs, text, avgLogprob: null, noSpeechProb: null };
}

/** Words with evenly spaced timings, as the provider would return them (often with leading spaces). */
function wordsFor(text: string, startMs: number, stepMs = 400): TimedWord[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({ text: ` ${word}`, startMs: startMs + index * stepMs, endMs: startMs + index * stepMs + stepMs - 50 }));
}

describe('buildTranscriptCues without word timestamps', () => {
  it('uses the provider segments as cues, skipping empty ones', () => {
    const cues = buildTranscriptCues({
      segments: [segment(0, 0, 2000, ' Hello there. '), segment(1, 2000, 2500, '   '), segment(2, 2500, 5000, 'General Kenobi.')],
      words: [],
    });
    expect(cues).toEqual([
      { id: '1', startMs: 0, endMs: 2000, text: 'Hello there.' },
      { id: '2', startMs: 2500, endMs: 5000, text: 'General Kenobi.' },
    ]);
  });

  it('falls back to one cue for text with no timing at all', () => {
    expect(buildTranscriptCues({ text: ' Just text. ', segments: [], words: [], durationMs: 4000 })).toEqual([
      { id: '1', startMs: 0, endMs: 4000, text: 'Just text.' },
    ]);
    expect(buildTranscriptCues({ text: '  ', segments: [], words: [] })).toEqual([]);
  });
});

describe('buildTranscriptCues with word timestamps', () => {
  it('splits a long segment into sentences timed by their words', () => {
    const text = 'I arrived late. The meeting had already started.';
    const cues = buildTranscriptCues({ segments: [segment(0, 0, 4000, text)], words: wordsFor(text, 1000) });
    expect(cues.map((cue) => cue.text)).toEqual(['I arrived late.', 'The meeting had already started.']);
    // "I arrived late." = words 0–2; "The …" starts at word 3.
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 1000 + 2 * 400 + 350 });
    expect(cues[1]).toMatchObject({ startMs: 1000 + 3 * 400, endMs: 1000 + 7 * 400 + 350 });
  });

  it('joins a sentence that the provider split across segments', () => {
    const first = 'When I was young, my family';
    const second = 'lived by the sea. We moved later.';
    const cues = buildTranscriptCues({
      segments: [segment(0, 0, 2400, first), segment(1, 2400, 5600, second)],
      words: wordsFor(`${first} ${second}`, 0),
    });
    expect(cues.map((cue) => cue.text)).toEqual(['When I was young, my family lived by the sea.', 'We moved later.']);
  });

  it('does not split on abbreviations, initials or decimals', () => {
    const text = 'Mr. Smith moved to the U.S. in 2010 and paid 3.5 percent, e.g. less than Dr. Jones. Then he left.';
    const cues = buildTranscriptCues({ segments: [segment(0, 0, 9000, text)], words: wordsFor(text, 0, 200) });
    expect(cues.map((cue) => cue.text)).toEqual([
      'Mr. Smith moved to the U.S. in 2010 and paid 3.5 percent, e.g. less than Dr. Jones.',
      'Then he left.',
    ]);
  });

  it('keeps question and exclamation marks and closing quotes with their sentence', () => {
    const text = 'Are you sure? "Absolutely!" she said.';
    const cues = buildTranscriptCues({ segments: [segment(0, 0, 3000, text)], words: wordsFor(text, 0) });
    expect(cues.map((cue) => cue.text)).toEqual(['Are you sure?', '"Absolutely!"', 'she said.']);
  });

  it('splits overly long sentences, preferring a comma', () => {
    const text =
      'Although the committee had discussed the proposal for several hours without reaching agreement, the chair decided to postpone the final vote until the following week.';
    const cues = buildTranscriptCues({ segments: [segment(0, 0, 12_000, text)], words: wordsFor(text, 0, 300) }, { maxWordsPerCue: 16 });
    expect(cues.map((cue) => cue.text)).toEqual([
      'Although the committee had discussed the proposal for several hours without reaching agreement,',
      'the chair decided to postpone the final vote until the following week.',
    ]);
    expect(cues[1]?.startMs).toBe(13 * 300);
  });

  it('hard-splits a long sentence without punctuation', () => {
    const text = Array.from({ length: 25 }, (_, index) => `w${index}`).join(' ');
    const cues = buildTranscriptCues({ segments: [segment(0, 0, 10_000, text)], words: wordsFor(text, 0) }, { maxWordsPerCue: 10 });
    expect(cues.map((cue) => cue.text.split(' ').length)).toEqual([10, 10, 5]);
  });

  it('tolerates provider words with punctuation, odd casing and hyphenation', () => {
    const text = 'A well-known fact.';
    const words: TimedWord[] = [
      { text: 'A', startMs: 0, endMs: 100 },
      { text: ' Well-Known', startMs: 100, endMs: 600 },
      { text: ' fact.', startMs: 600, endMs: 900 },
    ];
    expect(buildTranscriptCues({ segments: [segment(0, 0, 1000, text)], words })).toEqual([
      { id: '1', startMs: 0, endMs: 900, text: 'A well-known fact.' },
    ]);
  });

  it('skips words the text does not contain and survives missing words', () => {
    const text = 'One two three. Four five six.';
    const words: TimedWord[] = [
      { text: 'one', startMs: 0, endMs: 100 },
      { text: 'uh', startMs: 100, endMs: 200 }, // not in the text
      { text: 'two', startMs: 200, endMs: 300 },
      { text: 'three', startMs: 300, endMs: 400 },
      // "four" missing from the words
      { text: 'five', startMs: 600, endMs: 700 },
      { text: 'six', startMs: 700, endMs: 800 },
    ];
    expect(buildTranscriptCues({ segments: [segment(0, 0, 900, text)], words })).toEqual([
      { id: '1', startMs: 0, endMs: 400, text: 'One two three.' },
      { id: '2', startMs: 600, endMs: 800, text: 'Four five six.' },
    ]);
  });

  it('interpolates a sentence that received no word timing', () => {
    const text = 'Hello. Mmhmm. Goodbye.';
    const words: TimedWord[] = [
      { text: 'Hello', startMs: 0, endMs: 500 },
      { text: 'Goodbye', startMs: 2000, endMs: 2600 },
    ];
    const cues = buildTranscriptCues({ segments: [segment(0, 0, 3000, text)], words });
    expect(cues).toEqual([
      { id: '1', startMs: 0, endMs: 500, text: 'Hello.' },
      { id: '2', startMs: 500, endMs: 2000, text: 'Mmhmm.' },
      { id: '3', startMs: 2000, endMs: 2600, text: 'Goodbye.' },
    ]);
  });

  it('produces sequential ids and non-decreasing, well-formed timings', () => {
    const text = 'First line here. Second line there! Third? Fourth and last.';
    const cues = buildTranscriptCues({ segments: [segment(0, 0, 8000, text)], words: wordsFor(text, 250) });
    expect(cues.map((cue) => cue.id)).toEqual(['1', '2', '3', '4']);
    for (let index = 0; index < cues.length; index += 1) {
      const cue = cues[index]!;
      expect(cue.endMs).toBeGreaterThanOrEqual(cue.startMs);
      if (index > 0) expect(cue.startMs).toBeGreaterThanOrEqual(cues[index - 1]!.startMs);
    }
  });

  it('handles an hour-long transcript quickly (linear alignment)', () => {
    const sentence = 'This sentence has exactly eight words in it.';
    const text = Array.from({ length: 1500 }, () => sentence).join(' ');
    const words = wordsFor(text, 0, 300);
    const started = performance.now();
    const cues = buildTranscriptCues({ segments: [segment(0, 0, words.at(-1)!.endMs, text)], words });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(cues).toHaveLength(1500);
    expect(cues.at(-1)?.endMs).toBe(words.at(-1)?.endMs);
  });
});
