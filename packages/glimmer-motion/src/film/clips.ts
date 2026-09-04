/**
 * CLIPS — a source-time window over the film's clock.
 *
 * A beat is a shot of the picture. A clip is something else laid over it
 * for a while: a video, a still, or a freeze of the picture itself. Its
 * arithmetic is the compositor's (notes/choreo-composition.md, Phase C3),
 * lifted whole because it was already right:
 *
 *   source = in + (film − start) × rate
 *   window = for, or (out − in) / rate, or the rest of the beat
 *
 * Before `start` the clip is absent; inside its window it is active and
 * its source time is the number above; past it the end policy applies —
 * `remove` (the default) takes it off, `hold` keeps the last sample on
 * screen, `freeze` keeps it on screen and writes nothing further. Every
 * state is re-derived from the film time on every frame, never discovered
 * by playing from zero — which is what lets an exact film scrub into the
 * middle of a clip and find it where it should be.
 *
 * A clip may outlive its beat: the window is measured on the film's
 * clock, so a still that starts late in one shot can cross the seam into
 * the next. That is the clip overlap an editor means.
 */
import type { Beat } from './types.ts';

export type ClipKind = 'freeze' | 'image' | 'video';

export type ClipEnd = 'freeze' | 'hold' | 'remove';

export interface ClipSpec {
  /** seconds into the beat at which the clip appears (default 0) */
  at?: number;
  /** a line under an inset, and who to credit */
  caption?: string;
  credit?: string;
  /** past its window: taken off (default), held on its last sample, or frozen */
  end?: ClipEnd;
  /** a pip's own fade, seconds in and out (default 0.4) */
  fade?: number;
  /**
   * `cover` is the full frame over the picture; `inset` is the editorial
   * photograph, a paper card in the corner the type is not using; `pip`
   * is a LAYER — placed, sized and faded by the score, with nothing
   * around it. A pip is what a picture-in-picture actually is, and the
   * card is what an inset actually is; they were one thing and should
   * not have been.
   */
  fit?: 'cover' | 'inset' | 'pip';
  /** seconds it stays; default: to the end of the beat, or the source's own length */
  for?: number;
  /** the source's in point, seconds (video) */
  in?: number;
  kind: ClipKind;
  /** the source's out point, seconds (video); with `in`, sets the window */
  out?: number;
  /** a pip's corner radius, in percent of its width */
  radius?: number;
  /** source seconds per film second (video) */
  rate?: number;
  /** under `assets`; a freeze needs none */
  src?: string;
  /** the clip's own sound, 0..1; 0 (the default) keeps the film's voice in charge */
  volume?: number;
  /** a pip's width, percent of the frame (default 30) */
  w?: number;
  /** a pip's left edge, percent of the frame (default 66) */
  x?: number;
  /** a pip's top edge, percent of the frame (default 10) */
  y?: number;
}

export type ClipState = 'absent' | 'active' | 'frozen' | 'held';

export interface ResolvedClip {
  /** which beat's clip this is */
  index: number;
  /** film seconds since the clip's window opened */
  since: number;
  /** the source time to show, seconds; null when frozen */
  source: null | number;
  spec: ClipSpec;
  state: ClipState;
}

/** how long a clip's window is, in film seconds */
export function clipWindow(
  spec: ClipSpec,
  beatStart: number,
  nextStart: number,
): number {
  if (spec.for !== undefined) {
    return spec.for;
  }
  if (spec.out !== undefined) {
    return (spec.out - (spec.in ?? 0)) / (spec.rate ?? 1);
  }
  /* the rest of the beat */
  return Math.max(0, nextStart - beatStart - (spec.at ?? 0));
}

/**
 * The clip on screen at a film time, if any: the most recent beat at or
 * before `index` whose clip's window holds the time, or whose end policy
 * keeps it on screen past its window. Older clips are never reached past
 * a newer one — a clip that was removed is gone, and one that is held is
 * the one on screen.
 */
export function resolveClip(
  beats: readonly Beat[],
  beatStart: (i: number) => number,
  film: number,
  index: number,
  total: number,
): ResolvedClip | null {
  for (let i = Math.min(index, beats.length - 1); i >= 0; i -= 1) {
    const spec = beats[i]!.clip;
    if (!spec) {
      continue;
    }
    const start = beatStart(i) + (spec.at ?? 0);
    if (film < start) {
      /* not yet — only the current beat's own clip can be ahead of the
         clock; an earlier beat's lies behind it by construction */
      continue;
    }
    const next = i + 1 < beats.length ? beatStart(i + 1) : total;
    const window = clipWindow(spec, beatStart(i), next);
    const since = film - start;
    const rate = spec.rate ?? 1;
    const inPoint = spec.in ?? 0;
    if (since < window) {
      return {
        index: i,
        since,
        source: inPoint + since * rate,
        spec,
        state: 'active',
      };
    }
    const end = spec.end ?? 'remove';
    if (end === 'remove') {
      return null;
    }
    return {
      index: i,
      since,
      source: end === 'hold' ? inPoint + window * rate : null,
      spec,
      state: end === 'hold' ? 'held' : 'frozen',
    };
  }
  return null;
}
