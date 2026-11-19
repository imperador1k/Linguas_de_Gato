import { formatBytes, type FileSource } from '@ldg/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { MediaDropzone } from '../media-dropzone';

/**
 * Shown when a file session is reopened without its media (the file is not
 * copied into the browser by default). The transcript and progress are intact.
 */
export function MediaReconnect({ source, onAttach }: { source: FileSource; onAttach: (file: File) => void }) {
  const [mismatch, setMismatch] = useState<File | null>(null);

  function accept(file: File) {
    if (file.name === source.fileName && file.size === source.fileSize) {
      setMismatch(null);
      onAttach(file);
    } else {
      setMismatch(file);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reconnect the recording</CardTitle>
        <CardDescription>
          Your transcript and progress are saved, but the media file stays on your device. Choose{' '}
          <span className="font-medium text-foreground">{source.fileName}</span> ({formatBytes(source.fileSize)}) again to keep
          practising.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mismatch ? (
          <Notice tone="error" role="alert">
            <p>
              <span className="font-medium">{mismatch.name}</span> ({formatBytes(mismatch.size)}) doesn't match the original
              file. Timings may not line up with the transcript.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onAttach(mismatch)}>
                Use it anyway
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMismatch(null)}>
                Choose another file
              </Button>
            </div>
          </Notice>
        ) : (
          // Sessions can hold any transcribable format (a superset of the playable ones).
          <MediaDropzone onAccept={accept} prompt="Drop the original file here" purpose="transcription" />
        )}
      </CardContent>
    </Card>
  );
}
