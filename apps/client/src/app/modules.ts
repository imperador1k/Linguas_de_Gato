import {
  BookOpenText,
  ChartLine,
  CircleAlert,
  Headphones,
  Mic,
  PenLine,
  Sparkles,
  SpellCheck,
  WholeWord,
  type LucideIcon,
} from 'lucide-react';

export type ModuleId = 'listening' | 'speaking' | 'writing' | 'grammar' | 'reading' | 'vocabulary' | 'progress';

export type ModuleStatus = 'available' | 'planned';

/** Navigation groups (docs/M7_INFORMATION_ARCHITECTURE.md): practise skills, study language, review progress. */
export type ModuleGroup = 'practise' | 'language' | 'progress';

export interface LearningModule {
  readonly id: ModuleId;
  readonly label: string;
  readonly path: `/${string}`;
  readonly icon: LucideIcon;
  readonly group: ModuleGroup;
  readonly status: ModuleStatus;
  /** Roadmap milestone in which the module became usable (see docs/ROADMAP.md). */
  readonly milestone: string;
  /** One sentence: what the learner does here. */
  readonly summary: string;
  /** Planned modules only: what the module will offer. */
  readonly highlights?: readonly string[];
}

export const MODULE_GROUP_LABELS: Readonly<Record<ModuleGroup, string>> = {
  practise: 'Practise',
  language: 'Language',
  progress: 'Your progress',
};

export const MODULE_GROUP_ORDER: readonly ModuleGroup[] = ['practise', 'language', 'progress'];

/** Input skills before output skills, in the order evidence flows. */
export const MODULES: readonly LearningModule[] = [
  {
    id: 'listening',
    label: 'Listening',
    path: '/listening',
    icon: Headphones,
    group: 'practise',
    status: 'available',
    milestone: 'M2',
    summary: 'Transcribe audio or video, loop hard passages and test yourself with dictation.',
  },
  {
    id: 'reading',
    label: 'Reading',
    path: '/reading',
    icon: BookOpenText,
    group: 'practise',
    status: 'available',
    milestone: 'M5',
    summary: 'Read texts at your level, look up expressions in context and check your understanding.',
  },
  {
    id: 'speaking',
    label: 'Speaking',
    path: '/speaking',
    icon: Mic,
    group: 'practise',
    status: 'available',
    milestone: 'M3',
    summary: 'Answer a question out loud and get feedback tied to your own words.',
  },
  {
    id: 'writing',
    label: 'Writing',
    path: '/writing',
    icon: PenLine,
    group: 'practise',
    status: 'available',
    milestone: 'M4',
    summary: 'Write essays, emails and reports, with errors kept apart from suggestions.',
  },
  {
    id: 'grammar',
    label: 'Grammar',
    path: '/grammar',
    icon: SpellCheck,
    group: 'language',
    status: 'available',
    milestone: 'M4',
    summary: 'Targeted exercises on B2–C2 structures, checked against a verified key.',
  },
  {
    id: 'vocabulary',
    label: 'Vocabulary',
    path: '/vocabulary',
    icon: WholeWord,
    group: 'language',
    status: 'available',
    milestone: 'M5',
    summary: 'Your expressions with their context, reviewed on schedule and practised in new sentences.',
  },
  {
    id: 'progress',
    label: 'Progress',
    path: '/progress',
    icon: ChartLine,
    group: 'progress',
    status: 'available',
    milestone: 'M6',
    summary: 'What you have practised and which mistakes keep coming back, with the evidence.',
  },
];

/** The Progress area's own sections, listed under "Your progress" in the navigation. */
export interface NavLinkItem {
  readonly label: string;
  readonly path: `/${string}`;
  readonly icon: LucideIcon;
  /** Match the path exactly (for parents of other items). */
  readonly end?: boolean;
  /** Also show as current on these related pages (without claiming aria-current). */
  readonly alsoActive?: (pathname: string) => boolean;
}

export const PROGRESS_NAV: readonly NavLinkItem[] = [
  // Recommendations and targeted practice are Progress pages without their own navigation item.
  { label: 'Overview', path: '/progress', icon: ChartLine, end: true, alsoActive: (pathname) => pathname === '/progress/recommendations' || pathname === '/progress/training' },
  { label: 'Skills', path: '/progress/skills', icon: Sparkles },
  { label: 'Mistakes', path: '/progress/mistakes', icon: CircleAlert },
];

export function getModule(id: ModuleId): LearningModule {
  const learningModule = MODULES.find((candidate) => candidate.id === id);
  if (!learningModule) throw new Error(`Unknown module: ${id}`);
  return learningModule;
}

export function findModuleByPath(pathname: string): LearningModule | undefined {
  return MODULES.find((candidate) => pathname === candidate.path || pathname.startsWith(`${candidate.path}/`));
}

/** Document title for any route: module name, Settings, or the app alone. */
export function titleForPath(pathname: string): string | null {
  if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'Settings & data';
  return findModuleByPath(pathname)?.label ?? null;
}
