import { LEARNING_CATEGORIES, trainingOptionsFor } from '@ldg/shared';
import { describe, expect, it } from 'vitest';
import { isLearningCategory, optionFor, practiseCategoryFor, practisePath } from './practise-links';

describe('practisePath', () => {
  it("opens the first module's own creation panel for the category", () => {
    expect(practisePath('conditionals')).toBe('/grammar?practise=conditionals');
    expect(practisePath('vocabulary_precision')).toBe('/speaking?practise=vocabulary_precision');
    expect(practisePath('register')).toBe('/writing?practise=register');
  });

  it('returns null for categories no generator covers, which keep their own links', () => {
    expect(practisePath('listening_recognition')).toBeNull();
    expect(practisePath('reading_comprehension')).toBeNull();
  });

  it('never routes to the generic Progress form', () => {
    for (const category of LEARNING_CATEGORIES) expect(practisePath(category) ?? '').not.toContain('/progress');
  });

  it('always points at a module that can practise the category', () => {
    for (const category of LEARNING_CATEGORIES) {
      const path = practisePath(category);
      if (!path) continue;
      const module = path.slice(1, path.indexOf('?'));
      expect(trainingOptionsFor(category).some((option) => option.module === module)).toBe(true);
    }
  });
});

describe('practiseCategoryFor', () => {
  it('accepts a category the module can practise', () => {
    expect(practiseCategoryFor('passive_voice', 'grammar')).toBe('passive_voice');
    expect(practiseCategoryFor('passive_voice', 'writing')).toBe('passive_voice');
  });

  it('rejects categories the module cannot practise, unknown values and absence', () => {
    expect(practiseCategoryFor('punctuation', 'grammar')).toBeNull();
    expect(practiseCategoryFor('not-a-category', 'grammar')).toBeNull();
    expect(practiseCategoryFor('<script>', 'speaking')).toBeNull();
    expect(practiseCategoryFor(null, 'writing')).toBeNull();
  });
});

describe('optionFor', () => {
  it("returns the module's pre-fill settings", () => {
    expect(optionFor('reported_speech', 'writing')).toEqual({ module: 'writing', format: 'report', register: 'formal', objective: 'reporting verbs and reported speech' });
    expect(optionFor('conditionals', 'grammar')).toEqual({ module: 'grammar', topic: 'conditionals', focus: null });
    expect(optionFor('conditionals', 'writing')).toBeNull();
  });

  it('recognises learning categories', () => {
    expect(isLearningCategory('articles')).toBe(true);
    expect(isLearningCategory('progress')).toBe(false);
    expect(isLearningCategory(undefined)).toBe(false);
  });
});
