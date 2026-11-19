import { z } from 'zod';

/**
 * Target languages the learner can study. Adding a language means adding a
 * code here plus its content packs; UI language is a separate concern.
 */
export const LANGUAGE_CODES = ['en'] as const;

export const languageCodeSchema = z.enum(LANGUAGE_CODES);

export type LanguageCode = z.infer<typeof languageCodeSchema>;

export interface LanguageDefinition {
  readonly code: LanguageCode;
  /** BCP 47 tag used for `lang` attributes and speech APIs. */
  readonly bcp47: string;
  readonly name: string;
  readonly nativeName: string;
}

export const LANGUAGES: Readonly<Record<LanguageCode, LanguageDefinition>> = {
  en: { code: 'en', bcp47: 'en', name: 'English', nativeName: 'English' },
};

export const DEFAULT_TARGET_LANGUAGE: LanguageCode = 'en';

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export type CefrLevel = (typeof CEFR_LEVELS)[number];
