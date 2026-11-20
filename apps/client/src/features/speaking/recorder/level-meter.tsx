import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const BAR_COUNT = 48;
/** Below this RMS level for the whole window, the microphone is probably muted. */
const SILENCE_LEVEL = 0.015;
const SILENCE_WINDOW_MS = 3000;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Live input level as a scrolling bar waveform, drawn on a canvas so it never
 * re-renders React. It is functional feedback (is the mic picking me up?),
 * so it stays with reduced motion, at a calmer frame rate.
 */
export function LevelMeter({ stream, active, className }: { stream: MediaStream | null; active: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [silent, setSilent] = useState(false);
  // Read inside the animation loop without restarting it.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!stream || !canvas) return;
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const levels: number[] = Array.from({ length: BAR_COUNT }, () => 0);
    const frameInterval = prefersReducedMotion() ? 120 : 50;
    let lastFrame = 0;
    let lastSound = performance.now();
    let frame = 0;
    let stopped = false;

    const draw = (time: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(draw);
      if (time - lastFrame < frameInterval) return;
      lastFrame = time;

      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const value = (sample - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / samples.length);
      if (activeRef.current) {
        levels.push(Math.min(1, rms * 4));
        levels.shift();
        if (rms > SILENCE_LEVEL) lastSound = time;
        setSilent(time - lastSound > SILENCE_WINDOW_MS);
      }

      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth * ratio;
      const height = canvas.clientHeight * ratio;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const styles = getComputedStyle(canvas);
      ctx.clearRect(0, 0, width, height);
      const gap = 3 * ratio;
      const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
      levels.forEach((level, index) => {
        const barHeight = Math.max(2 * ratio, level * height);
        // Older bars fade out, so the newest sound reads first.
        ctx.globalAlpha = 0.25 + (0.75 * (index + 1)) / BAR_COUNT;
        ctx.fillStyle = activeRef.current ? styles.getPropertyValue('--brand') : styles.getPropertyValue('--muted-foreground');
        ctx.beginPath();
        ctx.roundRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };
    frame = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      source.disconnect();
      void context.close();
      setSilent(false);
    };
  }, [stream]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <canvas ref={canvasRef} aria-hidden="true" className="h-16 w-full" />
      <p aria-live="polite" className="min-h-5 text-center text-sm text-muted-foreground">
        {active && silent ? 'No sound detected. Check that your microphone is not muted.' : ''}
      </p>
    </div>
  );
}
