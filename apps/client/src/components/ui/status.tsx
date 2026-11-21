import type { AssessmentLevel } from '@ldg/shared';
import { CircleAlert, CircleCheck, CircleDot, Lightbulb, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from './badge';

/**
 * Semantic status primitives shared by every module. The colour rules are
 * deliberate (see docs/DESIGN_SYSTEM.md):
 * - success (green): strong performance, correct answers;
 * - caution (ochre): levels that describe work in progress — "Developing" is
 *   the normal state of a B2 → C1 learner, so it must never look like an error;
 * - destructive (red): actual errors and destructive actions only;
 * - neutral: stylistic suggestions, which are optional improvements.
 * Every indicator pairs colour with an icon and a word.
 */

const LEVELS: Readonly<Record<AssessmentLevel, { label: string; icon: LucideIcon; className: string }>> = {
  strong: { label: 'Strong', icon: CircleCheck, className: 'text-success' },
  developing: { label: 'Developing', icon: CircleDot, className: 'text-caution' },
  needs_attention: { label: 'Needs attention', icon: CircleAlert, className: 'text-caution' },
};

export function LevelLabel({ level, className }: { level: AssessmentLevel; className?: string }) {
  const { label, icon: Icon, className: tone } = LEVELS[level];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', tone, className)}>
      <Icon aria-hidden="true" className="size-4" />
      {label}
    </span>
  );
}

/** Error vs suggestion: different colour, icon, label and outline, so the distinction never rests on colour. */
export function CorrectionKindBadge({ kind }: { kind: 'error' | 'suggestion' }) {
  return kind === 'error' ? (
    <Badge variant="destructive">
      <CircleAlert aria-hidden="true" />
      Error
    </Badge>
  ) : (
    <Badge variant="outline">
      <Lightbulb aria-hidden="true" />
      Suggestion
    </Badge>
  );
}
