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
    status: 'available',
    milestone: 'M4',
    summary: 'Write essays, emails, reports and more, then study feedback where every correction quotes your text and errors are kept apart from suggestions.',
    highlights: ['B2–C2 tasks in 12 formats', 'Autosaved drafts', 'Evidence-based corrections', 'Optional improved version'],
  },
  {
    id: 'reading',
    label: 'Reading',
    path: '/reading',
    icon: BookOpenText,
    group: 'practice',
    status: 'available',
    milestone: 'M5',
    summary: 'Read texts written for your level or your own, look up expressions in context, and check your understanding against the text.',
    highlights: ['Generated or pasted texts', 'Comfortable reading view', 'Contextual lookups', 'Evidence-based questions'],
  },
  {
    id: 'grammar',
    label: 'Grammar',
    path: '/grammar',
    icon: SpellCheck,
    group: 'foundations',
    status: 'available',
    milestone: 'M4',
    summary: 'Targeted exercises on the structures that separate B2 from C1/C2, checked against a verified answer key.',
    highlights: ['12 advanced grammar areas', 'Six question types', 'Rules and distractor explanations', 'Retry with result history'],
  },
  {
    id: 'vocabulary',
    label: 'Vocabulary',
    path: '/vocabulary',
    icon: WholeWord,
    group: 'foundations',
    status: 'available',
    milestone: 'M5',
    summary: 'Keep words and collocations together with the sentences where you found them, review them on schedule and practise them in new contexts.',
    highlights: ['Saved with their context', 'Several meanings per expression', 'Simple review schedule', 'Practice from your own words'],
  },
  {
    id: 'progress',
    label: 'Progress',
    path: '/progress',
    icon: ChartLine,
    group: 'review',
    status: 'available',
    milestone: 'M6',
    summary: 'See what you have practised and which mistakes keep coming back, with the evidence behind each one. Evidence, not points.',
    highlights: ['Measured activity, never guessed', 'Recurring mistakes with examples', 'Targeted practice from your errors', 'Full backup and restore'],
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
