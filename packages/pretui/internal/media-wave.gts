// Pretui — the wavesurfer engine and keyboard geometry shared by Waveform and TrimBar.
//
//   <Waveform @src={{url}} @label='Lot B-1180' />
//   <TrimBar  @src={{url}} @start={{1}} @end={{4}} @onChange={{this.take}} />
//
// wavesurfer.js 7.12.11 (BSD-3-Clause, vendored at ./wavesurfer — see that
// folder's README for the licence, the provenance and the audit) decodes the
// audio and paints the peaks. Everything else here is Pretui's.
//
// Four decisions worth stating:
//
//   1. **The engine is created in a modifier and destroyed in its
//      destructor** — the rAF ruling, exactly. wavesurfer runs one
//      `requestAnimationFrame` loop while playing and holds an AudioContext,
//      a fetch, a ResizeObserver and a media element; `destroy()` releases all
//      of them and it is called on teardown and whenever the engine key
//      changes (`@src`, height, bar geometry). Nothing here constructs an engine in a getter, where the realm
//      indexer could reach it outside a browser.
//   2. **Construction is wrapped in try/catch and failure is a state, not a
//      crash.** A waveform lives or dies on a decode, and a headless browser
//      has no real media pipeline. `phase` is part of the public contract —
//      `idle → loading → ready`, or `error` — so a caller and a test can both
//      assert on what happened without asserting that a decode succeeded.
//   3. **The waveform is a `role='slider'`, not a canvas you can only click.**
//      wavesurfer gives pointer seeking and nothing else: no tab stop, no
//      arrow keys, no announced position. The keyboard floor is met here,
//      not in the library: one tab stop, ←/→ by step, Shift for a coarse step,
//      PageUp/PageDown, Home/End, Space to play, and an `aria-valuetext` that
//      says "0:03 of 0:06" rather than reading out a float.
//   4. **`TrimBar` owns its own handles.** The regions plugin paints the
//      selection and holds the range, but its handles are pointer-only divs
//      inside wavesurfer's shadow root — unreachable by keyboard and
//      unstylable from here. So the region is created with `drag:false,
//      resize:false` and the two handles are real focusable elements in the
//      light DOM, each a `role='slider'` with its own min, max and value. One
//      visual, one interaction model, and the in-point cannot cross the out.
//
// BETTER THAN THE INSPIRATION: every wavesurfer example on the web is
// `WaveSurfer.create({container: '#waveform'})` with a play button and no
// keyboard path at all. The trimmer examples are worse — a draggable region
// with no announced value, which is unusable without a mouse.
import { modifier } from 'ember-modifier';
import WaveSurfer, { RegionsPlugin } from '../wavesurfer/index.js';

/** Where a waveform is. `error` is a first-class outcome: an undecodable
 * source is normal (a headless browser, a 404, a codec nobody has). */
export type WavePhase = 'idle' | 'loading' | 'ready' | 'error';

/** What both components hand the shared engine modifier. */
interface WaveHost {
  /** Pixel height of the drawing area. */
  height: number;
  /** Bar rendering, or a continuous wave when `barWidth` is 0. */
  barWidth: number;
  barGap: number;
  /** Normalize peaks to the tallest sample. */
  normalize: boolean;
  /** Let wavesurfer handle pointer seeking. `TrimBar` says no — its pointer
   * gestures belong to its handles. */
  interact: boolean;
  /** Create a region and hand it back. */
  wantsRegions: boolean;
  onEngine: (engine: WaveEngine | null) => void;
  onPhase: (phase: WavePhase, message: string) => void;
  onDuration: (seconds: number) => void;
  onTime: (seconds: number) => void;
  onPlaying: (playing: boolean) => void;
  onRegionReady: (region: WaveRegion | null) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the vendored bundle
   ships no type declarations (the same trade `surfaces-preview.gts` makes for
   `./surfaces/index.js`). The surface actually used is narrow and is described
   by the two interfaces below, which is where the checking happens. */
type AnyEngine = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The slice of wavesurfer this module uses. */
export interface WaveEngine {
  play: () => void;
  pause: () => void;
  isPlaying: () => boolean;
  setTime: (seconds: number) => void;
  getDuration: () => number;
  getCurrentTime: () => number;
  destroy: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

/** The slice of a regions-plugin region this module uses. */
export interface WaveRegion {
  start: number;
  end: number;
  setOptions: (options: { start?: number; end?: number }) => void;
  remove: () => void;
}

/** Read a Pretui token off the live element as a concrete colour. wavesurfer
 * paints into a canvas, and a canvas cannot resolve `var(--primary)` — so the
 * theme is resolved once, at construction. A theme switch shows on the next
 * rebuild (a new `@src`, height or bar geometry), not live. */
function tokenColor(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = styles.getPropertyValue(name).trim();
  return raw.length > 0 ? raw : fallback;
}

/**
 * Own one wavesurfer instance for the life of the element.
 *
 * The third positional is a plain key string: change `@src`, the height or the
 * bar geometry and the key changes, ember-modifier tears the
 * engine down and it is rebuilt. wavesurfer reads its colours into a canvas
 * gradient at construction and has no setter for most of them, so a rebuild is
 * the honest answer rather than a pretend-live one.
 */
export const waveEngine = modifier(
  (el: HTMLElement, [host, src, _key]: [WaveHost, string, string]) => {
    let engine: AnyEngine = null;
    let region: WaveRegion | null = null;
    let torn = false;

    const styles = getComputedStyle(el);
    // Law 5: consent before motion. Auto-scrolling the waveform under a
    // moving playhead is motion; reduced motion pins it.
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    try {
      const plugins = [];
      let regions: AnyEngine = null;
      if (host.wantsRegions) {
        regions = RegionsPlugin.create();
        plugins.push(regions);
      }
      host.onPhase('loading', 'Decoding audio');
      engine = WaveSurfer.create({
        container: el,
        url: src,
        height: host.height,
        waveColor: tokenColor(styles, '--muted-foreground', '#9aa0a8'),
        progressColor: tokenColor(styles, '--primary', '#5b7cfa'),
        cursorColor: tokenColor(styles, '--foreground', '#16181d'),
        cursorWidth: 2,
        barWidth: host.barWidth > 0 ? host.barWidth : undefined,
        barGap: host.barWidth > 0 ? host.barGap : undefined,
        barRadius: host.barWidth > 0 ? Math.round(host.barWidth / 2) : undefined,
        normalize: host.normalize,
        interact: host.interact,
        dragToSeek: host.interact,
        autoScroll: !reduced,
        // No autoplay, ever. Stated rather than defaulted.
        autoplay: false,
        plugins,
      });
      host.onEngine(engine as WaveEngine);

      engine.on('decode', (duration: number) => {
        if (!torn) {
          host.onDuration(duration);
        }
      });
      engine.on('ready', (duration: number) => {
        if (torn) {
          return;
        }
        // Phase BEFORE duration: `onDuration` is what forwards `@onReady`,
        // and it only does so once the component is actually ready. Set the
        // duration first and the callback is swallowed.
        host.onPhase('ready', '');
        host.onDuration(duration);
        if (regions) {
          // A region covering the middle half, which is a better starting
          // guess than "everything" (nothing to trim) or "nothing" (a
          // zero-width handle stack the user has to prise apart).
          region = regions.addRegion({
            id: 'pretui-trim',
            start: duration * 0.25,
            end: duration * 0.75,
            drag: false,
            resize: false,
            color: 'rgba(91, 124, 250, 0.18)',
          }) as WaveRegion;
          host.onRegionReady(region);
        }
      });
      engine.on('timeupdate', (time: number) => {
        if (!torn) {
          host.onTime(time);
        }
      });
      engine.on('play', () => !torn && host.onPlaying(true));
      engine.on('pause', () => !torn && host.onPlaying(false));
      engine.on('finish', () => !torn && host.onPlaying(false));
      engine.on('error', (err: unknown) => {
        if (!torn) {
          host.onPhase(
            'error',
            err instanceof Error ? err.message : 'This audio could not be decoded.',
          );
        }
      });
    } catch (err) {
      host.onPhase(
        'error',
        err instanceof Error ? err.message : 'A waveform could not be created here.',
      );
    }

    return () => {
      torn = true;
      host.onEngine(null);
      host.onRegionReady(null);
      region = null;
      try {
        // Aborts the in-flight fetch, cancels the rAF playback loop, closes
        // the AudioContext, disconnects the ResizeObserver, unsubscribes every
        // emitter and drops the media element wavesurfer created.
        engine?.destroy();
      } catch {
        // A destroy that throws during teardown must not take the teardown
        // with it — there is nothing left to salvage either way.
      }
    };
  },
);

/** How far one key press moves, in seconds. Fine step for arrows, coarse for
 * Shift, page for PageUp/PageDown — the standard slider triple. */
export interface WaveSteps {
  fine: number;
  coarse: number;
  page: number;
}

export function stepsFor(duration: number, fine: number): WaveSteps {
  const safe = duration > 0 ? duration : 1;
  return {
    fine,
    coarse: fine * 5,
    page: Math.max(fine * 10, safe / 10),
  };
}

/** Resolve a key press to a delta in seconds, or `null` for "not ours". */
export function waveDelta(
  event: KeyboardEvent,
  steps: WaveSteps,
): number | null {
  const step = event.shiftKey ? steps.coarse : steps.fine;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return step;
    case 'ArrowLeft':
    case 'ArrowDown':
      return -step;
    case 'PageUp':
      return steps.page;
    case 'PageDown':
      return -steps.page;
    default:
      return null;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
