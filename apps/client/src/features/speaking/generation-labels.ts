import type { SpeakingExerciseFormat, SpeakingSkillFocus } from '@ldg/shared';

export const FORMAT_LABELS: Record<SpeakingExerciseFormat, { label: string; description: string }> = {
  free: { label: 'Free speaking', description: 'An open question you organise your own way.' },
  guided: { label: 'Guided discussion', description: 'Aspects to cover, in a sensible order.' },
  debate: { label: 'Debate', description: 'Take a side and answer the strongest objection.' },
  critical_thinking: { label: 'Critical thinking', description: 'Analyse a problem or claim before judging it.' },
};

export const SKILL_FOCUS_LABELS: Record<SpeakingSkillFocus, string> = {
  lexical_range: 'Vocabulary range and collocations',
  grammatical_range: 'Grammatical range',
  coherence: 'Coherence and linking',
  argumentation: 'Argumentation',
  register_and_tone: 'Register and tone',
  hedging_and_nuance: 'Hedging and nuance',
};

export const LEVEL_DESCRIPTIONS = {
  B2: 'Explain and support a viewpoint with varied vocabulary.',
  C1: 'Nuance, precise expression and complex argument.',
  C2: 'Subtle distinctions, register and idiomatic precision.',
} as const;

/** Shown wherever a generated task appears: honest about what the label means. */
export const CEFR_DISCLAIMER = 'AI-generated practice task. The level is a target for practice, not an official CEFR assessment.';
