import { tracked } from '@glimmer/tracking';

/**
 * How the page transition runs — and nothing else.
 *
 * Not the demos: their clock is `setMotionSpeed`. Slowing both would mean you
 * could never watch the page morph over a demo running at its own speed, which
 * is the thing worth watching.
 */
export type Tempo = 'instant' | 'smooth' | 'slow' | 'crawl';

class Settings {
  @tracked tempo: Tempo = 'smooth';
  /** the code panel, opened from the same control that sets the speed */
  @tracked showCode = false;
}

/**
 * True while a route transition is running.
 *
 * Anything mounting during one must not play its own entrance: the browser is
 * already animating the page, and twenty-six cards popping in as the morph
 * lands is a kink at the end of an otherwise smooth movement.
 *
 * Deliberately NOT tracked. Setting it would invalidate whatever reads it and
 * force a re-render in the middle of the transition, and another one as it
 * finishes — which is a worse jitter than the one it is here to prevent. It is
 * read once, when a card mounts, and that is the only moment it matters.
 */
let crossing = false;

export function setCrossing(value: boolean) {
  crossing = value;
}

export function isCrossing() {
  return crossing;
}

export const settings = new Settings();

export function setTempo(next: Tempo) {
  settings.tempo = next;
}

export function toggleCode() {
  settings.showCode = !settings.showCode;
}

/**
 * How much longer the morph takes than normal.
 *
 * Zero means do not animate at all: the route still changes, it simply
 * changes at once, which is the honest way to say "instant" — a one-frame
 * animation is a flash, not an instant.
 */
export function factor(): number {
  if (settings.tempo === 'instant') {
    return 0;
  }
  if (settings.tempo === 'crawl') {
    return 40;
  }
  return settings.tempo === 'slow' ? 10 : 1;
}
