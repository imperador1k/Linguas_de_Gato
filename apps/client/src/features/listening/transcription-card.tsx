import { AudioLines } from 'lucide-react';
import { useId } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Shown in YouTube sessions. The app never accesses YouTube media streams, so
 * automatic transcription is not offered there (file sessions use
 * SessionTranscriptionCard instead).
 */
export function TranscriptionCard({ sourceKind }: { sourceKind: 'youtube' }) {
  const titleId = useId();
  return (
    <Card aria-labelledby={titleId} data-source={sourceKind}>
      <CardHeader className="pb-5 sm:pb-6">
        <div className="flex items-center justify-between gap-3">
          <CardTitle id={titleId} className="flex items-center gap-2">
            <AudioLines aria-hidden="true" className="size-4 text-muted-foreground" />
            Automatic transcript
          </CardTitle>
          <Badge variant="outline">Not for YouTube</Badge>
        </div>
        <CardDescription className="mt-1">
          YouTube videos can't be transcribed here: the app only plays them through the official player and never accesses the
          audio. Import subtitles you are entitled to use instead.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
