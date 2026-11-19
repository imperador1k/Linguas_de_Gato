import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl, parseYouTubeUrl, type YouTubeVideoRef } from '@ldg/shared';
import { ExternalLink } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function YouTubeSourceForm({ onLoad }: { onLoad: (ref: YouTubeVideoRef) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = parseYouTubeUrl(value);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    onLoad(result.value);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <Label htmlFor={inputId}>YouTube link</Label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id={inputId}
          name="youtube-url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://www.youtube.com/watch?v=…"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        />
        <Button type="submit" size="lg" className="sm:w-auto">
          Load video
        </Button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <p id={hintId} className="text-sm leading-relaxed text-muted-foreground">
        Accepts youtube.com, youtu.be, Shorts and embed links. Playback uses YouTube's official embedded player; nothing is
        downloaded.
      </p>
    </form>
  );
}

export function YouTubePlayer({ video }: { video: YouTubeVideoRef }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="aspect-video bg-black">
        <iframe
          key={video.videoId}
          src={buildYouTubeEmbedUrl(video)}
          title="YouTube video player"
          className="size-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Video <span className="font-mono text-xs text-foreground">{video.videoId}</span>
        </p>
        <a
          href={buildYouTubeWatchUrl(video)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm underline decoration-border-strong underline-offset-4 hover:decoration-brand"
        >
          Open on YouTube
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}
