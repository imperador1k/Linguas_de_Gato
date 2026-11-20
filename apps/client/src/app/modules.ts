import {
  BookOpenText,
  ChartLine,
  Headphones,
  Mic,
  PenLine,
  SpellCheck,
  WholeWord,
  type LucideIcon,
} from 'lucide-react';

export type ModuleId = 'listening' | 'speaking' | 'writing' | 'grammar' | 'reading' | 'vocabulary' | 'progress';

export type ModuleStatus = 'available' | 'planned';

export type ModuleGroup = 'practice' | 'foundations' | 'review';

export interface LearningModule {
  readonly id: ModuleId;
  readonly label: string;
  readonly path: `/${string}`;
  readonly icon: LucideIcon;
  readonly group: ModuleGroup;
  readonly status: ModuleStatus;
  /** Roadmap milestone in which the module becomes usable (see docs/ROADMAP.md). */
  readonly milestone: string;
  readonly summary: string;
  readonly highlights: readonly string[];
}

export const MODULE_GROUP_LABELS: Readonly<Record<ModuleGroup, string>> = {
  practice: 'Practice',
  foundations: 'Foundations',
  review: 'Review',
};

export const MODULES: readonly LearningModule[] = [
  {
    id: 'listening',
    label: 'Listening',
    path: '/listening',
    icon: Headphones,
    group: 'practice',
    status: 'available',
    milestone: 'M2',
    summary:
      'Work through authentic audio and video at your own pace: transcribe it automatically, follow the transcript, loop hard passages and test yourself with dictation.',
    highlights: ['Automatic transcription', 'Local files and YouTube', 'Replay line and A-B loops', 'Dictation with word-level feedback', 'Comprehension exercises from the transcript'],
  },
  {
    id: 'speaking',
    label: 'Speaking',
    path: '/speaking',
    icon: Mic,
    group: 'practice',
    status: 'available',
    milestone: 'M3',
    summary: 'Answer a question out loud, check the transcript, and get evidence-based feedback with exercises built from your mistakes.',
    highlights: ['B2 and C1 speaking tasks', 'AI-generated tasks up to C2', 'Reviewed Whisper transcript', 'Feedback tied to your own words', 'Fluency measurements'],
  },
  {
    id: 'writing',
    label: 'Writing',
    path: '/writing',
    icon: PenLine,
    group: 'practice',
    status: 'planned',
    milestone: 'M4',
    summary: 'Write essays, emails and reports, then review corrections with explanations and more natural phrasing.',
    highlights: ['Register-aware prompts', 'Explained corrections', 'Collocation suggestions'],
  },
  {
    id: 'reading',
    label: 'Reading',
    path: '/reading',
    icon: BookOpenText,
    group: 'practice',
    status: 'planned',
    milestone: 'M6',
    summary: 'Read authentic texts in a calm reading view and check your comprehension.',
    highlights: ['Text import', 'Comprehension questions', 'Vocabulary capture in context'],
  },
  {
    id: 'grammar',
    label: 'Grammar',
    path: '/grammar',
    icon: SpellCheck,
    group: 'foundations',
    status: 'planned',
    milestone: 'M5',
    summary: 'Targeted exercises on the structures that separate B2 from C1.',
    highlights: ['Inversion and cleft sentences', 'Mixed conditionals', 'Hedging and modality'],
  },
  {
    id: 'vocabulary',
    label: 'Vocabulary',
    path: '/vocabulary',
    icon: WholeWord,
    group: 'foundations',
    status: 'planned',
    milestone: 'M5',
    summary: 'Keep words and collocations together with the sentences where you found them.',
    highlights: ['Words captured in context', 'Collocation sets', 'Spaced review'],
  },
  {
    id: 'progress',
    label: 'Progress',
    path: '/progress',
    icon: ChartLine,
    group: 'review',
    status: 'planned',
    milestone: 'M7',
    summary: 'See where your time goes and which mistakes keep coming back. Evidence, not points.',
    highlights: ['Time per skill', 'Recurring mistakes', 'Data export and import'],
  },
];

export function getModule(id: ModuleId): LearningModule {
  const learningModule = MODULES.find((candidate) => candidate.id === id);
  if (!learningModule) throw new Error(`Unknown module: ${id}`);
  return learningModule;
}

export function findModuleByPath(pathname: string): LearningModule | undefined {
  return MODULES.find((candidate) => pathname === candidate.path || pathname.startsWith(`${candidate.path}/`));
}
