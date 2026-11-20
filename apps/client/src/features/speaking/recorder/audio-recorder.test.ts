import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder, type MediaRecorderLike, type RecorderEnvironment } from './audio-recorder';

// --- Fakes ---------------------------------------------------------------------

class FakeTrack extends EventTarget {
  stopped = false;
  stop() {
    this.stopped = true;
  }
  end() {
    this.dispatchEvent(new Event('ended'));
  }
}

function fakeStream() {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

class FakeMediaRecorder implements MediaRecorderLike {
  static supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string) {
    return FakeMediaRecorder.supported.has(type);
  }

  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  readonly mimeType: string;
  timeslice: number | undefined;
  private readonly listeners: Record<string, Array<(event: { data: Blob }) => void>> = {};

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm;codecs=opus';
    FakeMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: Blob }) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  private emit(type: string, data = new Blob()) {
    this.listeners[type]?.forEach((listener) => listener({ data }));
  }

  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  /** Simulates the browser delivering a chunk. */
  deliver(bytes: number) {
    this.emit('dataavailable', new Blob([new Uint8Array(bytes)]));
  }
  stop() {
    this.state = 'inactive';
    // Real order: final dataavailable, then stop (asynchronously).
    queueMicrotask(() => {
      this.emit('dataavailable', new Blob([new Uint8Array(100)]));
      this.emit('stop');
    });
  }
  fail() {
    this.emit('error');
  }
}

let clock = 0;

function environment(overrides: Partial<RecorderEnvironment> = {}): RecorderEnvironment & { stream: ReturnType<typeof fakeStream> } {
  const stream = fakeStream();
  return {
    isSecureContext: true,
    getUserMedia: vi.fn(async () => stream.stream),
    MediaRecorder: FakeMediaRecorder,
    now: () => clock,
    stream,
    ...overrides,
  };
}

const options = { maxDurationMs: 180_000, minDurationMs: 3000, maxBytes: 25 * 1024 * 1024, tickMs: 200 };

function advance(ms: number) {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/webm']);
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests -----------------------------------------------------------------------

describe('AudioRecorder lifecycle', () => {
  it('does not touch the microphone until start() is called', () => {
    const env = environment();
    new AudioRecorder(env, options);
    expect(env.getUserMedia).not.toHaveBeenCalled();
  });

  it('records, pauses, resumes and finishes with the right duration and format', async () => {
    const env = environment();
    const recorder = new AudioRecorder(env, options);
    const states: string[] = [];
    recorder.subscribe(() => states.push(recorder.getState().status));

    await recorder.start();
    expect(env.getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    expect(recorder.getState()).toEqual({ status: 'recording', elapsedMs: 0 });
    expect(FakeMediaRecorder.instances[0]).toMatchObject({ mimeType: 'audio/webm;codecs=opus', timeslice: 1000 });

    advance(4000);
    expect(recorder.getState()).toMatchObject({ status: 'recording', elapsedMs: 4000 });
    recorder.pause();
    advance(10_000); // paused time doesn't count
    expect(recorder.getState()).toEqual({ status: 'paused', elapsedMs: 4000 });
    recorder.resume();
    advance(2000);
    FakeMediaRecorder.instances[0]!.deliver(500);
    recorder.finish();
    expect(recorder.getState().status).toBe('stopping');
    await flush();

    const state = recorder.getState();
    expect(state.status).toBe('recorded');
    if (state.status !== 'recorded') return;
    expect(state.recording.durationMs).toBe(6000);
    expect(state.recording.endedBy).toBe('learner');
    expect(state.recording.blob.size).toBe(600);
    // Uploaded with the base type, which the M2 pipeline validates.
    expect(state.recording.blob.type).toBe('audio/webm');
    expect(state.recording.format.extension).toBe('webm');
    expect(env.stream.track.stopped).toBe(true);
    expect(states).toEqual(expect.arrayContaining(['requesting', 'recording', 'paused', 'stopping', 'recorded']));
  });

  it('stops automatically at the maximum duration', async () => {
    const recorder = new AudioRecorder(environment(), { ...options, maxDurationMs: 10_000 });
    await recorder.start();
    advance(10_200);
    await flush();
    const state = recorder.getState();
    expect(state.status).toBe('recorded');
    if (state.status === 'recorded') {
      expect(state.recording.durationMs).toBe(10_000);
      expect(state.recording.endedBy).toBe('max-duration');
    }
  });

  it('keeps what was recorded when the microphone is unplugged', async () => {
    const env = environment();
    const recorder = new AudioRecorder(env, options);
    await recorder.start();
    advance(5000);
    env.stream.track.end();
    await flush();
    const state = recorder.getState();
    expect(state.status === 'recorded' && state.recording.endedBy).toBe('device-ended');
  });

  it('cancel discards the recording and releases the microphone', async () => {
    const env = environment();
    const recorder = new AudioRecorder(env, options);
    await recorder.start();
    advance(5000);
    recorder.cancel();
    await flush();
    expect(recorder.getState()).toEqual({ status: 'idle' });
    expect(env.stream.track.stopped).toBe(true);
    expect(recorder.getStream()).toBeNull();
  });

  it('releases a stream granted after the user already cancelled', async () => {
    let grant: (stream: MediaStream) => void = () => undefined;
    const env = environment({ getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => (grant = resolve))) });
    const recorder = new AudioRecorder(env, options);
    const starting = recorder.start();
    expect(recorder.getState()).toEqual({ status: 'requesting' });
    recorder.cancel();
    grant(env.stream.stream);
    await starting;
    expect(env.stream.track.stopped).toBe(true);
    expect(recorder.getState()).toEqual({ status: 'idle' });
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('dispose (unmount) stops everything without notifying', async () => {
    const env = environment();
    const recorder = new AudioRecorder(env, options);
    const listener = vi.fn();
    await recorder.start();
    recorder.subscribe(listener);
    recorder.dispose();
    expect(env.stream.track.stopped).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('can record again after a finished recording', async () => {
    const recorder = new AudioRecorder(environment(), options);
    await recorder.start();
    advance(4000);
    recorder.finish();
    await flush();
    expect(recorder.getState().status).toBe('recorded');
    await recorder.start();
    expect(recorder.getState().status).toBe('recording');
  });
});

describe('AudioRecorder failure states', () => {
  it.each([
    ['NotAllowedError', 'permission-denied'],
    ['SecurityError', 'permission-denied'],
    ['NotFoundError', 'no-microphone'],
    ['NotReadableError', 'microphone-busy'],
    ['TypeError', 'recording-failed'],
  ])('maps %s to %s', async (name, kind) => {
    const recorder = new AudioRecorder(
      environment({ getUserMedia: vi.fn(async () => Promise.reject(new DOMException('nope', name))) }),
      options,
    );
    await recorder.start();
    expect(recorder.getState()).toMatchObject({ status: 'error', kind });
  });

  it('reports a browser without MediaRecorder or getUserMedia as unsupported', async () => {
    const noRecorder = new AudioRecorder(environment({ MediaRecorder: undefined }), options);
    expect(noRecorder.isSupported()).toBe(false);
    await noRecorder.start();
    expect(noRecorder.getState()).toMatchObject({ status: 'error', kind: 'unsupported' });

    const noMic = new AudioRecorder(environment({ getUserMedia: undefined }), options);
    await noMic.start();
    expect(noMic.getState()).toMatchObject({ status: 'error', kind: 'unsupported' });
  });

  it('refuses to record on an insecure page', async () => {
    const env = environment({ isSecureContext: false });
    const recorder = new AudioRecorder(env, options);
    await recorder.start();
    expect(recorder.getState()).toMatchObject({ status: 'error', kind: 'insecure-context' });
    expect(env.getUserMedia).not.toHaveBeenCalled();
  });

  it('falls back to the browser default when no preferred MIME type is supported, if the pipeline accepts it', async () => {
    FakeMediaRecorder.supported = new Set();
    const recorder = new AudioRecorder(environment(), options);
    await recorder.start();
    expect(recorder.getState().status).toBe('recording');
    expect(FakeMediaRecorder.instances[0]?.mimeType).toBe('audio/webm;codecs=opus');
  });

  it('rejects an unusable default format and releases the microphone', async () => {
    FakeMediaRecorder.supported = new Set();
    class WavOnlyRecorder extends FakeMediaRecorder {
      override readonly mimeType = 'audio/wav';
    }
    const env = environment({ MediaRecorder: WavOnlyRecorder });
    const recorder = new AudioRecorder(env, options);
    await recorder.start();
    expect(recorder.getState()).toMatchObject({ status: 'error', kind: 'unsupported-format' });
    expect(env.stream.track.stopped).toBe(true);
  });

  it('rejects recordings that are too short or too large', async () => {
    const short = new AudioRecorder(environment(), options);
    await short.start();
    advance(1000);
    short.finish();
    await flush();
    expect(short.getState()).toMatchObject({ status: 'error', kind: 'too-short' });

    const large = new AudioRecorder(environment(), { ...options, maxBytes: 50 });
    await large.start();
    advance(5000);
    large.finish();
    await flush();
    expect(large.getState()).toMatchObject({ status: 'error', kind: 'too-large' });
  });

  it('handles a recorder error mid-recording', async () => {
    const env = environment();
    const recorder = new AudioRecorder(env, options);
    await recorder.start();
    FakeMediaRecorder.instances[0]!.fail();
    expect(recorder.getState()).toMatchObject({ status: 'error', kind: 'recording-failed' });
    expect(env.stream.track.stopped).toBe(true);
  });
});
