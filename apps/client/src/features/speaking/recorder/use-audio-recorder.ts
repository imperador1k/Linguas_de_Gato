import { useEffect, useState, useSyncExternalStore } from 'react';
import { AudioRecorder, browserRecorderEnvironment, type RecorderOptions } from './audio-recorder';

/**
 * React binding for `AudioRecorder`. The recorder lives as long as the
 * component: unmounting (navigating away) cancels any recording and releases
 * the microphone.
 */
export function useAudioRecorder(options: RecorderOptions) {
  const [recorder] = useState(() => new AudioRecorder(browserRecorderEnvironment(), options));
  const state = useSyncExternalStore(recorder.subscribe, recorder.getState, recorder.getState);
  useEffect(() => () => recorder.dispose(), [recorder]);
  return { state, recorder };
}
