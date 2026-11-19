/**
 * Formats a duration in seconds as `m:ss` or `h:mm:ss`.
 * Non-finite or negative input renders as `0:00` so media UIs never show NaN.
 */
export function formatTimestamp(totalSeconds: number, options: { forceHours?: boolean } = {}): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0 || options.forceHours) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/** Human-readable duration for screen readers, e.g. "1 hour 2 minutes 5 seconds". */
export function formatSpokenDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

/** `m:ss.t` (tenths), for loop points where whole seconds are too coarse. Input in milliseconds. */
export function formatPreciseTimestamp(totalMs: number): string {
  const safe = Number.isFinite(totalMs) && totalMs > 0 ? Math.floor(totalMs / 100) : 0;
  const tenths = safe % 10;
  return `${formatTimestamp(Math.floor(safe / 10))}.${tenths}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
