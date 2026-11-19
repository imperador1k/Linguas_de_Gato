import { describe, expect, it } from 'vitest';
import { buildYouTubeEmbedUrl, buildYouTubeWatchUrl, parseYouTubeStartTime, parseYouTubeUrl } from './youtube.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYouTubeUrl', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`],
    [`https://youtube.com/watch?v=${ID}&list=PL123&index=2`],
    [`https://m.youtube.com/watch?v=${ID}`],
    [`https://music.youtube.com/watch?v=${ID}`],
    [`https://youtu.be/${ID}`],
    [`https://youtu.be/${ID}?si=abcdef`],
    [`https://www.youtube.com/embed/${ID}`],
    [`https://www.youtube-nocookie.com/embed/${ID}`],
    [`https://www.youtube.com/shorts/${ID}`],
    [`https://www.youtube.com/live/${ID}?feature=share`],
    [`www.youtube.com/watch?v=${ID}`],
    [`youtu.be/${ID}`],
    [`http://www.youtube.com/watch?v=${ID}`],
    [`  ${ID}  `],
  ])('extracts the video ID from %s', (input) => {
    const result = parseYouTubeUrl(input);
    expect(result).toEqual({ ok: true, value: { videoId: ID } });
  });

  it('extracts a start time from t or start', () => {
    expect(parseYouTubeUrl(`https://youtu.be/${ID}?t=90`)).toEqual({ ok: true, value: { videoId: ID, startSeconds: 90 } });
    expect(parseYouTubeUrl(`https://www.youtube.com/watch?v=${ID}&t=1m5s`)).toEqual({
      ok: true,
      value: { videoId: ID, startSeconds: 65 },
    });
    expect(parseYouTubeUrl(`https://www.youtube.com/embed/${ID}?start=30`)).toEqual({
      ok: true,
      value: { videoId: ID, startSeconds: 30 },
    });
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['not a url at all', 'invalid-url'],
    ['https://vimeo.com/123456', 'not-youtube'],
    ['https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'not-youtube'],
    ['https://evil.example/?u=https://youtu.be/dQw4w9WgXcQ', 'not-youtube'],
    ['ftp://youtube.com/watch?v=dQw4w9WgXcQ', 'invalid-url'],
    ['javascript:alert(1)', 'invalid-url'],
    ['https://www.youtube.com/playlist?list=PL123', 'missing-video-id'],
    ['https://www.youtube.com/watch?v=short', 'missing-video-id'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ<script>', 'missing-video-id'],
    ['https://youtu.be/', 'missing-video-id'],
    ['https://www.youtube.com/@channel', 'missing-video-id'],
  ])('rejects %j as %s', (input, reason) => {
    const result = parseYouTubeUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe(reason);
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });
});

describe('parseYouTubeStartTime', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['1m30s', 90],
    ['1h2m3s', 3723],
    ['2m', 120],
  ])('parses %s', (input, expected) => {
    expect(parseYouTubeStartTime(input)).toBe(expected);
  });

  it.each([null, '', '0', 'abc', '1x', '-5'])('ignores %j', (input) => {
    expect(parseYouTubeStartTime(input)).toBeUndefined();
  });
});

describe('embed and watch URLs', () => {
  it('builds a privacy-enhanced embed URL', () => {
    expect(buildYouTubeEmbedUrl({ videoId: ID })).toBe(`https://www.youtube-nocookie.com/embed/${ID}?rel=0&playsinline=1`);
    expect(buildYouTubeEmbedUrl({ videoId: ID, startSeconds: 65.9 })).toContain('start=65');
  });

  it('builds a watch URL', () => {
    expect(buildYouTubeWatchUrl({ videoId: ID, startSeconds: 30 })).toBe(`https://www.youtube.com/watch?v=${ID}&t=30s`);
  });

  it('refuses to build URLs from an invalid ID', () => {
    expect(() => buildYouTubeEmbedUrl({ videoId: '../../evil' })).toThrow();
    expect(() => buildYouTubeWatchUrl({ videoId: 'x' })).toThrow();
  });
});
