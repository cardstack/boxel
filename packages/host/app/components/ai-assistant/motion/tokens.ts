import { isTesting } from '@embroider/macros';

// The assistant's motion timing, in one place (ADR 007 §1.5: durations and
// easings come from shared tokens). The curve is operator mode's: it leaves
// at once and lands softly, without overshoot. Leaving elements ease in.

/** entering and moving: ease-out */
export const EASE = [0.2, 0.8, 0.2, 1] as const;
/** leaving: ease-in */
export const EASE_IN = [0.4, 0, 1, 1] as const;
/**
 * the transcript's moves (a follow, a turn settling, an arrival): spread
 * evenly over the move rather than front-loaded. A whole conversation
 * travelling together reads as a jump when most of the travel lands in its
 * first frames, which EASE does; a busy frame then shows only the end.
 */
export const EASE_FOLLOW = [0.3, 0.1, 0.3, 1] as const;

/** seconds, inside ADR 007's ranges */
export const DURATION = {
  /** small feedback: a status crossfade, a chip (100–200 ms) */
  feedback: 0.14,
  /** an element entering a region (200–300 ms) */
  enter: 0.24,
  /** an element moving within a region (200–300 ms) */
  move: 0.28,
  /** an element leaving (ease-in, short) */
  exit: 0.18,
  /** a card-sized change of place: Quick Look, the send flight (300–500 ms) */
  space: 0.32,
} as const;

/**
 * A room shows its history at once: the transcript's scores are declared
 * only once its first render has settled, so opening a room never plays
 * a run, and only what changes after that moves.
 */
export const SETTLE_AFTER_MS = 1500;

/**
 * The most animation time, in ms, one painted frame may advance (Choreo's
 * @maxFrameStep). The assistant renders on the main thread its motion runs
 * on: behind a 150 ms render, a move would otherwise skip that much and
 * land as a jump. Capped, it slows down for that frame and stays a glide.
 * One 60 Hz frame and some jitter.
 */
export const MAX_FRAME_STEP = 20;

/** how far an entering block rises, in px */
export const RISE = 6;

/**
 * Host tests run with motion off: the regions render plain markup, and the
 * DOM they leave must be the same as with motion on (ADR 007 §1.1).
 */
// Off in tests, and off on demand for measuring what motion costs:
// localStorage 'boxel-assistant-motion' = 'off' (read when a region mounts)
export const motionEnabled = () => {
  if (isTesting()) {
    return false;
  }
  try {
    return globalThis.localStorage?.getItem('boxel-assistant-motion') !== 'off';
  } catch {
    return true;
  }
};
