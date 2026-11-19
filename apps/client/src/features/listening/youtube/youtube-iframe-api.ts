/**
 * Loader and minimal typings for the official YouTube IFrame Player API
 * (https://developers.google.com/youtube/iframe_api_reference).
 *
 * The app only *plays* videos through YouTube's own embedded player. It never
 * reads media streams; this API exposes playback position and control only.
 */

export const YOUTUBE_IFRAME_API_URL = 'https://www.youtube.com/iframe_api';
/** Privacy-enhanced host; the API supports it through the `host` option. */
export const YOUTUBE_PLAYER_HOST = 'https://www.youtube-nocookie.com';

export const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  destroy(): void;
}

export interface YTPlayerEvent<T = undefined> {
  readonly target: YTPlayer;
  readonly data: T;
}

export interface YTPlayerOptions {
  host?: string;
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YTPlayerEvent) => void;
    onStateChange?: (event: YTPlayerEvent<number>) => void;
    onPlaybackRateChange?: (event: YTPlayerEvent<number>) => void;
    onError?: (event: YTPlayerEvent<number>) => void;
  };
}

export interface YTNamespace {
  Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

declare global {
  interface Window {
    YT?: Partial<YTNamespace>;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

/**
 * Loads the IFrame API script once. Rejects on network failure, blocked
 * script, or timeout, and allows a later retry.
 */
export function loadYouTubeIframeApi(timeoutMs = 15_000): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT as YTNamespace);

  loading ??= new Promise<YTNamespace>((resolve, reject) => {
    const fail = (message: string) => {
      loading = null;
      reject(new Error(message));
    };
    const timer = window.setTimeout(() => fail("YouTube's player took too long to load."), timeoutMs);

    // The script calls this global when ready; chain any existing handler.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      window.clearTimeout(timer);
      if (window.YT?.Player) resolve(window.YT as YTNamespace);
      else fail("YouTube's player API loaded without a player.");
    };

    if (!document.querySelector(`script[src="${YOUTUBE_IFRAME_API_URL}"]`)) {
      const script = document.createElement('script');
      script.src = YOUTUBE_IFRAME_API_URL;
      script.async = true;
      script.onerror = () => {
        window.clearTimeout(timer);
        script.remove();
        fail("Couldn't reach YouTube. Check your connection or any content blockers.");
      };
      document.head.append(script);
    }
  });
  return loading;
}

/** Human-readable messages for the documented `onError` codes. */
export function describeYouTubeError(code: number): { readonly message: string; readonly embeddable: boolean } {
  switch (code) {
    case 2:
      return { message: 'YouTube rejected this video ID as invalid.', embeddable: true };
    case 5:
      return { message: "This video can't be played in the browser's HTML5 player.", embeddable: true };
    case 100:
      return { message: 'This video is unavailable. It may have been removed or made private.', embeddable: false };
    case 101:
    case 150:
      // YouTube also reports some missing videos this way, so don't blame the owner outright.
      return {
        message:
          "This video can't be played here. Its owner may not allow embedding, or it may no longer be available. Try opening it on YouTube.",
        embeddable: false,
      };
    case 153:
      return { message: 'YouTube refused the request because the page did not identify itself (missing referrer).', embeddable: true };
    default:
      return { message: "YouTube couldn't play this video.", embeddable: true };
  }
}
