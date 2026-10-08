import { tracked } from '@glimmer/tracking';

/**
 * How the gallery ⇄ demo crossing runs — and nothing else.
 *
 * Not the demos: their clock is `setMotionSpeed`. Slowing both would mean you
 * could never watch the page morph over a demo running at its own speed, which
 * is the thing worth watching.
 *
 * Module-level on purpose: tempo is the viewer's preference, so every gallery
 * open in the host follows the same setting.
 */
export type Tempo = 'instant' | 'smooth' | 'slow';

class Settings {
  @tracked tempo: Tempo = 'smooth';
  /** the code panel, opened from the same control that sets the speed */
  @tracked showCode = false;
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
 * Zero means do not animate at all: the page still changes, it simply
 * changes at once, which is the honest way to say "instant" — a one-frame
 * animation is a flash, not an instant.
 */
export function factor(): number {
  if (settings.tempo === 'instant') {
    return 0;
  }
  return settings.tempo === 'slow' ? 10 : 1;
}
