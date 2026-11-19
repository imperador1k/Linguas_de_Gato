import {
  compareTexts,
  formatAccuracy,
  formatTimestamp,
  type LineProgress,
  type SubtitleCue,
  type TextComparison,
} from '@ldg/shared';
import { ArrowLeft, ArrowRight, Play, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Notice } from '@/components/ui/notice';
import { DictationDiff, DictationLegend } from './dictation-diff';

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * Practice area for one transcript line. The reference stays hidden until the
 * learner checks their answer. Remount it (key by cue id) to reset.
 */
export function DictationPanel({
  cue,
  index,
  total,
  progress,
  ready,
  autoPlay,
  onPlayLine,
  onNavigate,
  onSubmit,
}: {
  cue: SubtitleCue;
  index: number;
  total: number;
  progress: LineProgress | null;
  ready: boolean;
  /** Play the line on mount (set after the learner navigates with Next / Previous). */
  autoPlay: boolean;
  onPlayLine: () => void;
  onNavigate: (index: number, options: { autoPlay: boolean }) => void;
  onSubmit: (answer: string, comparison: TextComparison) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<TextComparison | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const inputId = useId();
  const hintId = useId();
  const resultId = useId();

  const onPlayLineRef = useRef(onPlayLine);
  useEffect(() => {
    onPlayLineRef.current = onPlayLine;
  });

  useEffect(() => {
    if (!autoPlay) return;
    textareaRef.current?.focus();
    if (ready) onPlayLineRef.current();
    // Deliberately mount-only: each line remounts this panel (keyed by cue id).
  }, []);

  function check() {
    const comparison = compareTexts(cue.text, answer);
    setResult(comparison);
    onSubmit(answer, comparison);
    // Move focus to the result so keyboard and screen-reader users land on it.
    requestAnimationFrame(() => resultRef.current?.focus());
  }

  function retry() {
    setResult(null);
    setAnswer('');
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key === 'Enter') {
      event.preventDefault();
      if (!result) check();
    } else if (event.ctrlKey && (event.key === ' ' || event.code === 'Space')) {
      event.preventDefault();
      if (ready) onPlayLine();
    }
  }

  const durationSeconds = Math.max(0, (cue.endMs - cue.startMs) / 1000);
  const errors = result ? result.counts.substitutions : 0;
  const nearMisses = result ? result.alignment.filter((op) => op.type === 'substitution' && op.nearMiss).length : 0;

  return (
    <Card aria-labelledby={`${resultId}-title`}>
      <CardHeader className="flex-row items-start justify-between gap-3 pb-0">
        <div className="min-w-0">
          <CardTitle id={`${resultId}-title`}>
            Line {index + 1} <span className="font-normal text-muted-foreground">of {total}</span>
          </CardTitle>
          <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">
            {formatTimestamp(cue.startMs / 1000)} · {durationSeconds.toFixed(1)} s
            {progress ? ` · best ${formatAccuracy(progress.bestAccuracy)} · ${plural(progress.attempts, 'attempt')}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous line"
            disabled={index === 0}
            onClick={() => onNavigate(index - 1, { autoPlay: true })}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next line"
            disabled={index >= total - 1}
            onClick={() => onNavigate(index + 1, { autoPlay: true })}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="brand" disabled={!ready} onClick={onPlayLine}>
            <Play aria-hidden="true" />
            Play line
          </Button>
          <p className="text-sm text-muted-foreground">Replay as often as you need; change speed in the player.</p>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">
            Type what you hear
          </label>
          <textarea
            ref={textareaRef}
            id={inputId}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={onKeyDown}
            readOnly={result !== null}
            rows={3}
            lang="en"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby={hintId}
            className="w-full resize-y rounded-md border border-input bg-card px-3.5 py-3 font-serif text-[1.0625rem] leading-relaxed transition-colors duration-150 hover:border-border-strong focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none read-only:bg-muted/50"
          />
          <p id={hintId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd> check
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>Ctrl</Kbd>+<Kbd>Space</Kbd> replay
            </span>
            <span>Capitals and punctuation don't count; contractions do.</span>
          </p>
        </div>

        {result === null ? (
          <div>
            <Button onClick={check}>Check answer</Button>
          </div>
        ) : (
          <section aria-labelledby={resultId} className="flex flex-col gap-5 border-t pt-5">
            <h3 id={resultId} ref={resultRef} tabIndex={-1} className="sr-only">
              Result: {formatAccuracy(result.accuracy)} accuracy
            </h3>

            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <p className="font-serif text-5xl leading-none tabular-nums">{formatAccuracy(result.accuracy)}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  accuracy · {result.counts.matches} of {plural(result.counts.referenceWords, 'word')} correct
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Wrong</dt>
                  <dd className="font-medium tabular-nums">
                    {errors}
                    {nearMisses > 0 ? <span className="font-normal text-muted-foreground"> ({nearMisses} close)</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Missed</dt>
                  <dd className="font-medium tabular-nums">{result.counts.deletions}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Extra</dt>
                  <dd className="font-medium tabular-nums">{result.counts.insertions}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground" title="Word error rate: (wrong + missed + extra) ÷ reference words">
                    WER
                  </dt>
                  <dd className="font-medium tabular-nums">{result.wordErrorRate.toFixed(2)}</dd>
                </div>
              </dl>
            </div>

            {result.isExactMatch ? <Notice tone="success">Every word matches the reference.</Notice> : null}

            <div>
              <h4 className="mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">Reference</h4>
              <p className="font-serif text-[1.125rem] leading-relaxed whitespace-pre-line" lang="en">
                {cue.text}
              </p>
            </div>

            {!result.isExactMatch ? (
              <div>
                <h4 className="mb-1.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  Your answer, word by word
                </h4>
                <DictationDiff alignment={result.alignment} />
                <div className="mt-3">
                  <DictationLegend />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={retry}>
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
              {index < total - 1 ? (
                <Button onClick={() => onNavigate(index + 1, { autoPlay: true })}>
                  Next line
                  <ArrowRight aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
