import { useCallback, type KeyboardEvent } from 'react';
import { SKIP_SECONDS, type PlaybackControls } from './playback';

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'number', 'password', 'tel']);

function isTextEntry(target: HTMLElement): boolean {
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/** Elements where Space and arrows already do something native (buttons, sliders, checkboxes). */
function hasNativeKeys(target: HTMLElement): boolean {
  return target.tagName === 'INPUT' || target.tagName === 'BUTTON';
}

export interface ListeningShortcutActions {
  readonly replayLine?: () => void;
  readonly setPointA?: () => void;
  readonly setPointB?: () => void;
  /** Returns true when something was cleared, so Escape isn't swallowed otherwise. */
  readonly clearLoop?: () => boolean;
}

/**
 * Keyboard shortcuts for a listening session. Attach the returned handler to
 * the session container. Keys are ignored while typing in a text field.
 *
 * Space/K play · J/← −5 s · L/→ +5 s · ,/. speed · M mute · R replay line ·
 * A/B loop points · Esc clear loop.
 */
export function useListeningShortcuts(controls: PlaybackControls, actions: ListeningShortcutActions) {
  const { replayLine, setPointA, setPointB, clearLoop } = actions;

  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement;
      if (isTextEntry(target)) return;
      const nativeTarget = hasNativeKeys(target);

      switch (event.key) {
        case ' ':
          if (nativeTarget) return;
          controls.togglePlay();
          break;
        case 'k':
        case 'K':
          controls.togglePlay();
          break;
        case 'j':
        case 'J':
          controls.skip(-SKIP_SECONDS);
          break;
        case 'l':
        case 'L':
          controls.skip(SKIP_SECONDS);
          break;
        case 'ArrowLeft':
          if (nativeTarget) return;
          controls.skip(-SKIP_SECONDS);
          break;
        case 'ArrowRight':
          if (nativeTarget) return;
          controls.skip(SKIP_SECONDS);
          break;
        case 'm':
        case 'M':
          controls.toggleMute();
          break;
        case ',':
          controls.stepPlaybackRate(-1);
          break;
        case '.':
          controls.stepPlaybackRate(1);
          break;
        case 'r':
        case 'R':
          if (!replayLine) return;
          replayLine();
          break;
        case 'a':
        case 'A':
          if (!setPointA) return;
          setPointA();
          break;
        case 'b':
        case 'B':
          if (!setPointB) return;
          setPointB();
          break;
        case 'Escape':
          if (!clearLoop?.()) return;
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [controls, replayLine, setPointA, setPointB, clearLoop],
  );
}
