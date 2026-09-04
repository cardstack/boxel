/**
 * ADJUSTMENTS — the picture's own knobs, held for a shot (or a chapter, or
 * a group), as typed components the actor declares and the film yields.
 *
 * An adjustment is a value held on an actor for a window, applying to
 * everything under it — After Effects' adjustment layer, FCPXML's
 * `adjust-*`, Unity's volume overrides. A FILTER is the kind of adjustment
 * that processes the frame — a grade, a stock, a look — Motion's word,
 * MLT's, CSS's. Photoshop draws the line: a filter is a pixel operation,
 * an adjustment is a parameter held above the stack.
 *
 * The package ships the two base classes and nothing named after weather.
 * The set below is what the IFRAME PICTURE — the WebGL page behind both
 * reference films, addressed through the `Picture` port — declares; a
 * third picture declares its own and never sees `haze`. Today they
 * compile to fields on the row the engine reads; when the picture becomes
 * an actor with ports, they write the ports.
 */
import type { Beat } from '../types.ts';
import type { Patch } from './compile.ts';
import { ClipLookNode, PatchComponent } from './nodes.gts';

/** a value held on an actor for the window it is attached to */
export abstract class Adjustment<A extends object> extends PatchComponent<A> {}

/** an adjustment whose target is the frame: applied before a seam's still is taken */
export abstract class Filter<A extends object> extends Adjustment<A> {}

/* ---- the iframe picture's set ------------------------------------------- */

/** the mood, the named look, and the stock — a filter: it processes the frame */
export class Look extends Filter<{
  grade?: string;
  look?: string;
  lut?: null | string;
}> {
  patch(): Patch {
    return { grade: this.args.grade, look: this.args.look, lut: this.args.lut };
  }
}

/** the hour, the weather, the air */
export class Weather extends Adjustment<{
  haze?: number;
  hours?: number[];
  lightning?: number;
  over?: number;
  rain?: number;
  theme?: number;
  wx?: number;
  wxCut?: boolean;
}> {
  patch(): Patch {
    const a = this.args;
    return {
      haze: a.haze,
      hours: a.hours,
      hoursOver: a.over,
      lightning: a.lightning,
      rain: a.rain,
      theme: a.theme,
      wx: a.wx,
      wxCut: a.wxCut,
    };
  }
}

/** settled snow and a pinned blizzard; `@off` clears them */
export class Winter extends Adjustment<{
  gust?: number;
  off?: boolean;
  pack?: number;
}> {
  patch(): Patch {
    if (this.args.off) {
      return { winter: null };
    }
    return { winter: { gust: this.args.gust ?? 0, pack: this.args.pack ?? 0 } };
  }
}

/** where the sun is, degrees */
export class Sun extends Adjustment<{ az: number; el: number }> {
  patch(): Patch {
    return { sun: { az: this.args.az, el: this.args.el } };
  }
}

/** a backlight, standing opposite the lens */
export class Light extends Adjustment<{ rim?: number }> {
  patch(): Patch {
    return { rim: this.args.rim };
  }
}

/** the surroundings: the city, the field */
export class Set extends Adjustment<{
  city?: Beat['city'];
  grass?: boolean;
}> {
  patch(): Patch {
    return { city: this.args.city, grass: this.args.grass };
  }
}

/** the construction clock, how far through the shot it finishes, and which subject stands */
export class Build extends Adjustment<{
  by?: number;
  clock?: Beat['build'];
  settle?: number;
  subject?: number;
}> {
  patch(): Patch {
    const a = this.args;
    return {
      build: a.clock,
      buildBy: a.by,
      settle: a.settle,
      style: a.subject,
    };
  }
}

/* ---- the sound actor's set ---------------------------------------------- */

/** trims on the page's buses for the window */
export class Mix extends Adjustment<{
  music?: number;
  sfx?: number;
  voice?: number;
  wx?: number;
}> {
  patch(): Patch {
    const { music, sfx, voice, wx } = this.args;
    const mix: NonNullable<Beat['mix']> = {};
    if (music !== undefined) {
      mix.music = music;
    }
    if (sfx !== undefined) {
      mix.sfx = sfx;
    }
    if (voice !== undefined) {
      mix.voice = voice;
    }
    if (wx !== undefined) {
      mix.wx = wx;
    }
    return { mix };
  }
}

/** what the iframe picture yields as `f.picture` */
export const IFRAME_PICTURE = { Build, Light, Look, Set, Sun, Weather, Winter };
/** what the sound actor yields as `f.sound` */
export const SOUND = { Mix };

/* ---- the clip actor's set ------------------------------------------------ *
 * The first adjustments that belong to something other than the picture. A
 * clip is a DOM element, so what it can be given is what a browser can do
 * to one without a texture — which is the honest half of a filter stack,
 * and the half that needs no pixels.
 */
export const CLIP_LOOK = { Look: ClipLookNode } as const;
