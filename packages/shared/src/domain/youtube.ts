import { err, ok, type Result } from './result.js';

/**
 * Parses user input into a YouTube video reference for the official embedded
 * player. This module only extracts an ID; it never resolves media streams.
 */

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const PATH_PREFIXES_WITH_ID = new Set(['embed', 'shorts', 'live', 'v']);

export interface YouTubeVideoRef {
  readonly videoId: string;
  readonly startSeconds?: number;
}

export type YouTubeParseErrorReason = 'empty' | 'invalid-url' | 'not-youtube' | 'missing-video-id';

export interface YouTubeParseError {
  readonly reason: YouTubeParseErrorReason;
  readonly message: string;
}

export function isValidYouTubeVideoId(candidate: string): boolean {
  return VIDEO_ID_PATTERN.test(candidate);
}

/** Accepts `90`, `90s`, `1m30s`, `1h2m3s`. Returns undefined for anything else. */
export function parseYouTubeStartTime(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : undefined;
  }

  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(trimmed);
  if (!match || trimmed === '') return undefined;
  const [, h = '0', m = '0', s = '0'] = match;
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  return seconds > 0 ? seconds : undefined;
}

function extractVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    return segments[0] ?? null;
  }

  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (segments[0] === 'watch') {
    return url.searchParams.get('v');
  }

  const [prefix, id] = segments;
  if (prefix && PATH_PREFIXES_WITH_ID.has(prefix)) {
    return id ?? null;
  }

  return null;
}

function isYouTubeHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === 'youtu.be' || normalized === 'www.youtu.be' || YOUTUBE_HOSTS.has(normalized);
}

export function parseYouTubeUrl(input: string): Result<YouTubeVideoRef, YouTubeParseError> {
  const trimmed = input.trim();

  if (trimmed === '') {
    return err({ reason: 'empty', message: 'Paste a YouTube link or video ID.' });
  }

  if (isValidYouTubeVideoId(trimmed)) {
    return ok({ videoId: trimmed });
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return err({ reason: 'invalid-url', message: "This doesn't look like a valid link." });
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return err({ reason: 'invalid-url', message: 'Only http and https links are supported.' });
  }

  if (!isYouTubeHost(url.hostname)) {
    return err({ reason: 'not-youtube', message: 'Only YouTube links (youtube.com or youtu.be) are supported.' });
  }

  const videoId = extractVideoId(url);
  if (!videoId || !isValidYouTubeVideoId(videoId)) {
    return err({ reason: 'missing-video-id', message: "This link doesn't point to a single YouTube video." });
  }

  const startSeconds = parseYouTubeStartTime(url.searchParams.get('t') ?? url.searchParams.get('start'));
  return ok(startSeconds === undefined ? { videoId } : { videoId, startSeconds });
}

/** Privacy-enhanced embed URL for the official YouTube player. */
export function buildYouTubeEmbedUrl(ref: YouTubeVideoRef): string {
  if (!isValidYouTubeVideoId(ref.videoId)) {
    throw new Error('Invalid YouTube video ID.');
  }
  const params = new URLSearchParams({ rel: '0', playsinline: '1' });
  if (ref.startSeconds !== undefined && ref.startSeconds > 0) {
    params.set('start', String(Math.floor(ref.startSeconds)));
  }
  return `https://www.youtube-nocookie.com/embed/${ref.videoId}?${params.toString()}`;
}

export function buildYouTubeWatchUrl(ref: YouTubeVideoRef): string {
  if (!isValidYouTubeVideoId(ref.videoId)) {
    throw new Error('Invalid YouTube video ID.');
  }
  const params = new URLSearchParams({ v: ref.videoId });
  if (ref.startSeconds !== undefined && ref.startSeconds > 0) {
    params.set('t', `${Math.floor(ref.startSeconds)}s`);
  }
  return `https://www.youtube.com/watch?${params.toString()}`;
}
