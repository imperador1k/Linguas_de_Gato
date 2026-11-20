import { chooseRecordingFormat, formatBytes, formatFromRecordedType, type RecordingFormat } from '@ldg/shared';

/**
 * Microphone recording as a small state machine, independent of React and
 * of the real browser APIs (they are injected), so every lifecycle and
 * failure path is unit-testable.
 *
 * Privacy: the microphone is requested only by `start()`, which the UI calls
 * from an explicit click. Nothing here uploads anything.
 */

export type RecorderErrorKind =
  | 'unsupported'
  | 'insecure-context'
  | 'permission-denied'
  | 'no-microphone'
  | 'microphone-busy'
  | 'unsupported-format'
  | 'recording-failed'
  | 'too-short'
  | 'too-large';

export interface CompletedRecording {
  readonly blob: Blob;
  readonly durationMs: number;
  readonly format: RecordingFormat;
  /** Why recording ended without the learner pressing Finish, if it did. */
  readonly endedBy: 'learner' | 'max-duration' | 'device-ended';
}

export type RecorderState =
  | { readonly status: 'idle' }
  | { readonly status: 'requesting' }
  | { readonly status: 'recording' | 'paused'; readonly elapsedMs: number }
  | { readonly status: 'stopping'; readonly elapsedMs: number }
  | { readonly status: 'recorded'; readonly recording: CompletedRecording }
  | { readonly status: 'error'; readonly kind: RecorderErrorKind; readonly message: string };

/** The subset of MediaRecorder this module uses. */
export interface MediaRecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  readonly mimeType: string;
  start(timeslice?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  addEventListener(type: 'dataavailable', listener: (event: { data: Blob }) => void): void;
  addEventListener(type: 'stop' | 'error', listener: () => void): void;
}

export interface MediaRecorderConstructorLike {
  new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported(mimeType: string): boolean;
}

export interface RecorderEnvironment {
  readonly isSecureContext: boolean;
  readonly getUserMedia: ((constraints: MediaStreamConstraints) => Promise<MediaStream>) | undefined;
  readonly MediaRecorder: MediaRecorderConstructorLike | undefined;
  readonly now: () => number;
}

export interface RecorderOptions {
  readonly maxDurationMs: number;
  readonly minDurationMs: number;
  readonly maxBytes: number;
  /** How often the elapsed time is refreshed. */
  readonly tickMs?: number;
}

const MESSAGES: Readonly<Record<RecorderErrorKind, string>> = {
  unsupported: "This browser can't record audio. Use a recent version of Chrome, Edge, Firefox or Safari.",
  'insecure-context': 'Recording needs a secure page. Open the app at http://127.0.0.1 or http://localhost.',
  'permission-denied':
    'Microphone access was blocked. Allow it in your browser’s site settings (the icon next to the address), then try again.',
  'no-microphone': 'No microphone was found. Connect one and try again.',
  'microphone-busy': 'The microphone is in use by another application, or the system blocked it. Close the other app and try again.',
  'unsupported-format': "This browser can't record in a format the transcription service accepts.",
  'recording-failed': 'Recording failed. Try again.',
  'too-short': 'That recording is too short to transcribe. Speak for a few seconds and try again.',
  'too-large': 'That recording is too large to upload.',
};

function errorKindFor(error: unknown): RecorderErrorKind {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission-denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-microphone';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'microphone-busy';
    default:
      return 'recording-failed';
  }
}

/** Real browser APIs, read lazily so server-side rendering or tests never touch them. */
export function browserRecorderEnvironment(): RecorderEnvironment {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const Recorder = typeof window === 'undefined' ? undefined : (window.MediaRecorder as unknown as MediaRecorderConstructorLike | undefined);
  return {
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext,
    getUserMedia: devices?.getUserMedia ? (constraints) => devices.getUserMedia(constraints) : undefined,
    MediaRecorder: Recorder,
    now: () => performance.now(),
  };
}

export class AudioRecorder {
  #state: RecorderState = { status: 'idle' };
  readonly #listeners = new Set<() => void>();
  readonly #env: RecorderEnvironment;
  readonly #options: Required<RecorderOptions>;

  #stream: MediaStream | null = null;
  #recorder: MediaRecorderLike | null = null;
  #format: RecordingFormat | null = null;
  #chunks: Blob[] = [];
  #accumulatedMs = 0;
  #segmentStartedAt: number | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #endedBy: CompletedRecording['endedBy'] = 'learner';
  /** Increments on cancel/dispose so late async results are ignored. */
  #generation = 0;
  #discardOnStop = false;

  constructor(env: RecorderEnvironment, options: RecorderOptions) {
    this.#env = env;
    this.#options = { tickMs: 200, ...options };
  }

  getState = (): RecorderState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** The live microphone stream while recording (for a level meter), else null. */
  getStream(): MediaStream | null {
    return this.#stream;
  }

  isSupported(): boolean {
    return Boolean(this.#env.getUserMedia && this.#env.MediaRecorder);
  }

  async start(): Promise<void> {
    if (this.#state.status !== 'idle' && this.#state.status !== 'error' && this.#state.status !== 'recorded') return;
    if (!this.#env.isSecureContext) return this.#fail('insecure-context');
    const { getUserMedia, MediaRecorder: Recorder } = this.#env;
    if (!getUserMedia || !Recorder) return this.#fail('unsupported');

    const generation = ++this.#generation;
    this.#set({ status: 'requesting' });

    let stream: MediaStream;
    try {
      stream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    } catch (error) {
      if (generation === this.#generation) this.#fail(errorKindFor(error));
      return;
    }
    // Cancelled or unmounted while the permission prompt was open.
    if (generation !== this.#generation) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const preferred = chooseRecordingFormat((type) => Recorder.isTypeSupported(type));
    let recorder: MediaRecorderLike;
    try {
      recorder = preferred ? new Recorder(stream, { mimeType: preferred.mimeType }) : new Recorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      return this.#fail('unsupported-format');
    }
    // Without a preferred match, accept the browser's default only if the pipeline can take it.
    const format = preferred ?? formatFromRecordedType(recorder.mimeType);
    if (!format) {
      stream.getTracks().forEach((track) => track.stop());
      return this.#fail('unsupported-format');
    }

    this.#stream = stream;
    this.#recorder = recorder;
    this.#format = format;
    this.#chunks = [];
    this.#accumulatedMs = 0;
    this.#endedBy = 'learner';
    this.#discardOnStop = false;

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => this.#onStop());
    recorder.addEventListener('error', () => {
      this.#release();
      this.#fail('recording-failed');
    });
    // An unplugged microphone ends the track: keep what was recorded.
    stream.getAudioTracks().forEach((track) =>
      track.addEventListener('ended', () => {
        if (this.#state.status === 'recording' || this.#state.status === 'paused') {
          this.#endedBy = 'device-ended';
          this.finish();
        }
      }),
    );

    try {
      // A timeslice delivers data regularly, so a crash mid-recording loses at most a second.
      recorder.start(1000);
    } catch {
      this.#release();
      return this.#fail('recording-failed');
    }
    this.#segmentStartedAt = this.#env.now();
    this.#timer = setInterval(() => this.#tick(), this.#options.tickMs);
    this.#set({ status: 'recording', elapsedMs: 0 });
  }

  pause(): void {
    if (this.#state.status !== 'recording' || !this.#recorder) return;
    this.#recorder.pause();
    this.#closeSegment();
    this.#set({ status: 'paused', elapsedMs: this.#elapsed() });
  }

  resume(): void {
    if (this.#state.status !== 'paused' || !this.#recorder) return;
    this.#recorder.resume();
    this.#segmentStartedAt = this.#env.now();
    this.#set({ status: 'recording', elapsedMs: this.#elapsed() });
  }

  /** Stops and produces the recording (asynchronously, on the recorder's `stop` event). */
  finish(): void {
    if ((this.#state.status !== 'recording' && this.#state.status !== 'paused') || !this.#recorder) return;
    this.#closeSegment();
    this.#stopTimer();
    this.#set({ status: 'stopping', elapsedMs: this.#elapsed() });
    this.#recorder.stop();
  }

  /** Discards everything, including a finished recording, and releases the microphone. */
  cancel(): void {
    this.#generation += 1;
    this.#discardOnStop = true;
    if (this.#recorder && this.#recorder.state !== 'inactive') {
      try {
        this.#recorder.stop();
      } catch {
        // Already stopped.
      }
    }
    this.#release();
    this.#chunks = [];
    this.#set({ status: 'idle' });
  }

  /** For unmount: like cancel, without notifying anyone. */
  dispose(): void {
    this.#listeners.clear();
    this.cancel();
  }

  #onStop(): void {
    if (this.#discardOnStop) return;
    const format = this.#format;
    const durationMs = Math.round(this.#elapsed());
    const blob = new Blob(this.#chunks, { type: format?.uploadType ?? 'application/octet-stream' });
    this.#chunks = [];
    this.#release();

    if (!format || blob.size === 0) return this.#fail('recording-failed');
    if (durationMs < this.#options.minDurationMs) return this.#fail('too-short');
    if (blob.size > this.#options.maxBytes) {
      return this.#fail('too-large', `${MESSAGES['too-large']} It is ${formatBytes(blob.size)}; the limit is ${formatBytes(this.#options.maxBytes)}.`);
    }
    this.#set({ status: 'recorded', recording: { blob, durationMs, format, endedBy: this.#endedBy } });
  }

  #tick(): void {
    if (this.#state.status !== 'recording') return;
    const elapsedMs = this.#elapsed();
    if (elapsedMs >= this.#options.maxDurationMs) {
      this.#endedBy = 'max-duration';
      this.finish();
      return;
    }
    this.#set({ status: 'recording', elapsedMs });
  }

  #elapsed(): number {
    const running = this.#segmentStartedAt === null ? 0 : this.#env.now() - this.#segmentStartedAt;
    return Math.min(this.#accumulatedMs + running, this.#options.maxDurationMs);
  }

  #closeSegment(): void {
    if (this.#segmentStartedAt === null) return;
    this.#accumulatedMs += this.#env.now() - this.#segmentStartedAt;
    this.#segmentStartedAt = null;
  }

  #stopTimer(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Stops the microphone (the browser's recording indicator goes off) and drops references. */
  #release(): void {
    this.#stopTimer();
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#recorder = null;
    this.#segmentStartedAt = null;
  }

  #fail(kind: RecorderErrorKind, message = MESSAGES[kind]): void {
    this.#set({ status: 'error', kind, message });
  }

  #set(state: RecorderState): void {
    this.#state = state;
    this.#listeners.forEach((listener) => listener());
  }
}
