import { formatBytes } from '@ldg/shared';
import { AudioLines } from 'lucide-react';
import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useCapabilities } from '@/hooks/use-capabilities';

/**
 * Automatic transcription status. The action stays disabled until the server
 * reports the feature as available; nothing here simulates a transcript.
 */
export function TranscriptionCard({ sourceKind }: { sourceKind: 'file' | 'youtube' | null }) {
  const capabilities = useCapabilities();
  const titleId = useId();
  const reasonId = useId();

  let badge: { label: string; variant: 'outline' | 'success' | 'neutral' };
  let reason: string;

  if (sourceKind === 'youtube') {
    badge = { label: 'Not for YouTube', variant: 'outline' };
    reason = "YouTube videos can't be transcribed here: the app only plays them through the official player and never accesses the audio.";
  } else if (capabilities.status === 'loading') {
    badge = { label: 'Checking…', variant: 'neutral' };
    reason = 'Checking what the local server supports.';
  } else if (capabilities.status === 'error') {
    badge = { label: 'Server offline', variant: 'outline' };
    reason = 'The local server is not reachable, so transcription status is unknown.';
  } else {
    const { transcription } = capabilities.data;
    const limit = formatBytes(transcription.maxUploadBytes);
    if (transcription.available) {
      badge = { label: 'Available', variant: 'success' };
      reason = `Files up to ${limit} are sent once to the server and not stored.`;
    } else if (transcription.configured) {
      badge = { label: 'Planned · M2', variant: 'outline' };
      reason = `A Groq API key is configured. Whisper transcription ships in milestone M2 (files up to ${limit}).`;
    } else {
      badge = { label: 'Planned · M2', variant: 'outline' };
      reason = 'Arrives in milestone M2. You will need a Groq API key in apps/server/.env.';
    }
  }

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle id={titleId} className="flex items-center gap-2">
            <AudioLines aria-hidden="true" className="size-4 text-muted-foreground" />
            Automatic transcript
          </CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <CardDescription id={reasonId} className="mt-1" aria-live="polite">
          {reason}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="secondary" className="w-full" disabled aria-describedby={reasonId}>
          Transcribe with Whisper
        </Button>
      </CardContent>
    </Card>
  );
}
