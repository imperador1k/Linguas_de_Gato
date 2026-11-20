import { SPEAKING_CATEGORIES, speakingPromptSchema } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { PROMPT_LIBRARY, findLibraryPrompt, toSpeakingPrompt } from './prompt-library';

describe('PROMPT_LIBRARY', () => {
  it('has unique ids and stays small and curated', () => {
    const ids = PROMPT_LIBRARY.map((prompt) => prompt.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROMPT_LIBRARY.length).toBeLessThanOrEqual(20);
  });

  it('covers every category at both B2 and C1', () => {
    for (const category of SPEAKING_CATEGORIES) {
      // The curated library covers B2 and C1; C2 tasks come from AI generation.
      for (const level of ['B2', 'C1'] as const) {
        expect(PROMPT_LIBRARY.some((prompt) => prompt.category === category && prompt.level === level), `${category} ${level}`).toBe(true);
      }
    }
  });

  it('produces prompts that pass the assessment request limits', () => {
    for (const prompt of PROMPT_LIBRARY) {
      expect(speakingPromptSchema.safeParse(toSpeakingPrompt(prompt)).success, prompt.id).toBe(true);
      expect(prompt.structure.length).toBeGreaterThan(0);
    }
  });

  it('finds prompts by id', () => {
    expect(findLibraryPrompt('work-remote-or-office')?.level).toBe('B2');
    expect(findLibraryPrompt('nope')).toBeUndefined();
  });
});
