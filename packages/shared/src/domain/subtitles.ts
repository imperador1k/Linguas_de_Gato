/**
 * SRT and WebVTT parsing into a normalised cue list.
 *
 * The parser is intentionally lenient: malformed blocks are skipped and
 * counted rather than failing the whole file, because real-world subtitle
 * files are frequently imperfect.
 */

export type SubtitleFormat = 'srt' | 'vtt';

export interface SubtitleCue {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface SubtitleParseResult {
  readonly format: SubtitleFormat;
  readonly cues: readonly SubtitleCue[];
  readonly skippedBlocks: number;
}

const TIMESTAMP = String.raw`(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}`;
const TIMING_LINE = new RegExp(String.raw`^\s*(${TIMESTAMP})\s*-->\s*(${TIMESTAMP})(?:\s+.*)?$`);

const VTT_NON_CUE_BLOCK = /^(NOTE|STYLE|REGION)(\s|$)/;

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': '',
};

/** Parses `hh:mm:ss,mmm`, `hh:mm:ss.mmm` or `mm:ss.mmm` into milliseconds. */
export function parseSubtitleTimestamp(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(value.trim());
  if (!match) return null;

  const [, hoursRaw, minutesRaw = '0', secondsRaw = '0', fractionRaw = '0'] = match;
  const hours = hoursRaw === undefined ? 0 : Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);
  const millis = Number(fractionRaw.padEnd(3, '0'));

  if (minutes > 59 || seconds > 59) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

export function detectSubtitleFormat(content: string): SubtitleFormat {
  return stripBom(content).trimStart().startsWith('WEBVTT') ? 'vtt' : 'srt';
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}

function cleanCueText(lines: readonly string[]): string {
  return lines
    .map((line) =>
      line
        .replace(/\{\\[^}]*\}/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|lrm|rlm);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

export function parseSubtitles(content: string, formatHint?: SubtitleFormat): SubtitleParseResult {
  const normalized = stripBom(content).replace(/\r\n?/g, '\n');
  const format: SubtitleFormat = normalized.trimStart().startsWith('WEBVTT') ? 'vtt' : (formatHint ?? 'srt');

  const blocks = normalized
    .split(/\n[ \t]*\n/)
    .map((block) => block.split('\n').filter((line, index, lines) => index < lines.length - 1 || line.trim() !== ''))
    .filter((lines) => lines.some((line) => line.trim() !== ''));

  const parsed: Array<Omit<SubtitleCue, 'id'>> = [];
  let skippedBlocks = 0;

  blocks.forEach((rawLines, blockIndex) => {
    const lines = rawLines.map((line) => line.replace(/\s+$/, ''));
    const firstLine = (lines[0] ?? '').trim();

    if (format === 'vtt') {
      if (blockIndex === 0 && firstLine.startsWith('WEBVTT')) return;
      if (VTT_NON_CUE_BLOCK.test(firstLine)) return;
    }

    const timingIndex = lines.findIndex((line) => TIMING_LINE.test(line));
    // A cue may carry one identifier line before its timing line, never more.
    if (timingIndex < 0 || timingIndex > 1) {
      skippedBlocks += 1;
      return;
    }

    const timing = TIMING_LINE.exec(lines[timingIndex] ?? '');
    const startMs = timing?.[1] ? parseSubtitleTimestamp(timing[1]) : null;
    const endMs = timing?.[2] ? parseSubtitleTimestamp(timing[2]) : null;
    const text = cleanCueText(lines.slice(timingIndex + 1));

    if (startMs === null || endMs === null || endMs < startMs || text === '') {
      skippedBlocks += 1;
      return;
    }

    parsed.push({ startMs, endMs, text });
  });

  const cues = parsed
    .map((cue, index) => ({ cue, index }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs || a.index - b.index)
    .map(({ cue }, index): SubtitleCue => ({ id: String(index + 1), ...cue }));

  return { format, cues, skippedBlocks };
}

/**
 * Returns the index of the cue being spoken at `timeMs`, or -1 between cues.
 * Expects cues sorted by start time (as returned by `parseSubtitles`).
 */
export function findActiveCueIndex(cues: readonly SubtitleCue[], timeMs: number): number {
  let low = 0;
  let high = cues.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    const cue = cues[mid];
    if (cue === undefined) break;
    if (cue.startMs <= timeMs) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (candidate === -1) return -1;
  const cue = cues[candidate];
  return cue !== undefined && timeMs < cue.endMs ? candidate : -1;
}
