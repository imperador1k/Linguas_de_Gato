import type { ListeningMediaState, RecordingState } from '@ldg/shared';
import { CircleAlert, CircleCheck, CircleDashed, type LucideIcon } from 'lucide-react';
import { Badge } from './badge';

interface BadgeSpec {
  readonly label: string;
  readonly variant: 'success' | 'caution' | 'neutral';
  readonly icon: LucideIcon;
}

const AUDIO: Record<Exclude<ListeningMediaState, 'not-applicable'>, BadgeSpec> = {
  saved: { label: 'Audio saved', variant: 'success', icon: CircleCheck },
  'this-visit': { label: 'Audio not saved', variant: 'caution', icon: CircleAlert },
  'needs-file': { label: 'Needs the file', variant: 'caution', icon: CircleAlert },
};

const RECORDING: Record<RecordingState, BadgeSpec> = {
  saved: { label: 'Recording saved', variant: 'success', icon: CircleCheck },
  'this-visit': { label: 'Recording not saved', variant: 'caution', icon: CircleAlert },
  'not-kept': { label: 'No recording', variant: 'neutral', icon: CircleDashed },
};

function MediaBadge({ spec }: { spec: BadgeSpec }) {
  const Icon = spec.icon;
  return (
    <Badge variant={spec.variant} className="px-2 py-0">
      <Icon aria-hidden="true" />
      {spec.label}
    </Badge>
  );
}

/** A Listening session's audio, in the same words everywhere (library, Continue, Today). Text and icon, never colour alone. */
export function MediaStateBadge({ state }: { state: ListeningMediaState }) {
  return state === 'not-applicable' ? null : <MediaBadge spec={AUDIO[state]} />;
}

/** A Speaking attempt's recording (history, attempt page). */
export function RecordingStateBadge({ state }: { state: RecordingState }) {
  return <MediaBadge spec={RECORDING[state]} />;
}
