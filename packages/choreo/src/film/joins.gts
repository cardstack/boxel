/**
 * THE JOINS, as presentations.
 *
 * A join is what happens to the OUTGOING frame while the incoming shot
 * plays underneath it from its very first frame: the still is swept off,
 * thinned, closed in a circle, covered with a colour. That is one
 * contract — a component given the still and told how long it has — and
 * the film's twelve seams are twelve components that satisfy it. A
 * thirteenth, written in an app, satisfies it the same way and is named
 * from a shot's `<f.Join @presentation={{MyWipe}} />`; the film learns
 * nothing about it but its length.
 *
 * Three of the twelve are not presentations at all: a `cut` and a
 * `whip` are the camera's, a `sweep` is the light's, and the film plays
 * those itself. Three more — `blend`, `melt`, `dip` — the picture can
 * do in its own glass (`Picture.dissolve`) and only fall back to a still
 * here when it cannot.
 *
 * A seam that never ends is a lid: every overlay retires itself when its
 * animation ends, and a seekable one (stood at a time by an exact film)
 * is taken off by the film instead.
 */
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type { Join, JoinName, Over } from './types.ts';

export const retire = modifier(
  (el: HTMLElement, [seekable]: [boolean | undefined]) => {
    /* a seekable seam is stood at a time by the film and taken off by it:
       an animation that is paused never ends, and must not be lidded */
    if (seekable) {
      return;
    }
    const done = () => {
      el.style.display = 'none';
    };
    el.addEventListener('animationend', done);
    el.addEventListener('animationcancel', done);
    /* a still that never animates at all (reduced motion, a dropped
       stylesheet) must not become a permanent lid either */
    const failsafe = window.setTimeout(done, 1400);
    return () => {
      window.clearTimeout(failsafe);
      el.removeEventListener('animationend', done);
      el.removeEventListener('animationcancel', done);
    };
  },
);

/** what a presentation is given */
export interface PresentationSignature {
  Args: {
    /** where the seam is aimed, as inline custom properties (an iris's centre) */
    at?: string;
    /** the colour a dip passes through */
    color?: string;
    /** the film stands the overlay at a time itself: never retire on `animationend` */
    seekable?: boolean;
    /** the outgoing frame, as a data URL; empty when the picture held it in its own glass */
    still: string;
  };
}

/** a presentation is a Glimmer component class on the contract above — the class, not a `ComponentLike`, so an app's and the library's typings agree */
export type PresentationComponent = typeof Component<PresentationSignature>;

/** a seam the film can play: its presentation, how long it holds the picture, whether it needs a still */
export interface Presentation {
  /** the overlay; none for a seam the camera or the light plays */
  component?: PresentationComponent;
  /**
   * How deep this seam goes by default, when the score does not say
   * (`Over`). A presentation an app brings may want `everything` — a
   * curtain that drops in front of the picture and leaves the caption
   * standing in front of it is not a curtain.
   */
  over?: Over;
  /** seconds the seam holds the picture */
  secs: number;
  /** the seam paints a still of the outgoing frame over the incoming one */
  still: boolean;
}

/* ---- the twelve, as components -------------------------------------- */

/** the outgoing frame itself, swept off along the sun's diagonal behind a feathered edge */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Wipe extends Component<PresentationSignature> {
  <template>
    <div class='cf-swipe' aria-hidden='true' {{retire @seekable}}>
      <img src={{@still}} alt='' />
    </div>
  </template>
}

/** the long soft one, no push and no colour */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Melt extends Component<PresentationSignature> {
  <template>
    <img
      class='cf-melt'
      src={{@still}}
      alt=''
      aria-hidden='true'
      {{retire @seekable}}
    />
  </template>
}

/** the outgoing frame held as a still and faded over the live incoming shot */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Blend extends Component<PresentationSignature> {
  <template>
    <img
      class='cf-blend'
      src={{@still}}
      alt=''
      aria-hidden='true'
      {{retire @seekable}}
    />
  </template>
}

/** the old shot closes in a circle onto the incoming subject; the centre rides inline custom properties */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Iris extends Component<PresentationSignature> {
  <template>
    <img
      class='cf-iris'
      src={{@still}}
      style={{@at}}
      alt=''
      aria-hidden='true'
      {{retire @seekable}}
    />
  </template>
}

/** the still blurs out over the incoming shot; also the freeze half of a rack-defocus */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Blur extends Component<PresentationSignature> {
  <template>
    <img
      class='cf-blurout'
      src={{@still}}
      alt=''
      aria-hidden='true'
      {{retire @seekable}}
    />
  </template>
}

/** the still dissolves by its own luminance */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Luma extends Component<PresentationSignature> {
  <template>
    <img
      class='cf-luma'
      src={{@still}}
      alt=''
      aria-hidden='true'
      {{retire @seekable}}
    />
  </template>
}

/** a white frame, and the picture comes back through it */
// eslint-disable-next-line ember/no-empty-glimmer-component-classes
export class Flash extends Component<PresentationSignature> {
  <template>
    <i class='cf-flash' aria-hidden='true' {{retire @seekable}}></i>
  </template>
}

/** freeze under, veil over: the old shot holds while the colour closes, the seam passes in the dark, the veil lifts on the new shot */
export class Dip extends Component<PresentationSignature> {
  get veil(): string {
    return `background:${this.args.color ?? '#0d0905'}`;
  }

  <template>
    <span class='cf-dip' aria-hidden='true' {{retire @seekable}}>
      {{#if @still}}
        <img src={{@still}} alt='' />
      {{/if}}
      <i style={{this.veil}}></i>
    </span>
  </template>
}

/**
 * A SEAM AS TWO NUMBERS, at progress `p`.
 *
 * `mix` is how much of the HELD frame is over the live one; `veil` is how
 * much of a colour is over both. The picture composites them in light,
 * and the film reveals the incoming furniture by what is left over —
 * `1 - max(mix, veil)`. One number in, two halves out: that is the whole
 * seam, and it is why a seek through one is free (a function of the
 * clock, with nothing to stand at a time).
 *
 * Only the three the glass can hold are here. A wipe and an iris are
 * SHAPES rather than mixes — they need pixels in the DOM to sweep and to
 * clip — and they keep their presentation.
 */
export function seamShape(
  kind: JoinName,
  p: number,
): { mix: number; veil: number } {
  const t = Math.max(0, Math.min(1, p));
  if (kind === 'dip') {
    /* close, hold, open. The veil is a shutter and the picture mixes it
       in light, so the curve is the plain smooth one: the compensation
       the CSS veil needed was for sRGB compositing, which this is not. */
    const veil =
      t < 0.34
        ? smoothstep(t / 0.34)
        : t < 0.44
          ? 1
          : 1 - smoothstep((t - 0.44) / 0.56);
    /* the held frame is swapped for the live one inside the hold, where
       none of the change is on screen */
    return { mix: t < 0.4 ? 1 : 0, veil };
  }
  /* blend and melt: ease-out, the same curve the page used to run itself */
  const e = 1 - (1 - t) * (1 - t);
  return { mix: 1 - e, veil: 0 };
}

/** the seams the picture can hold in its own glass, given `Picture.seam` */
export function inGlass(kind: JoinName): boolean {
  return kind === 'blend' || kind === 'melt' || kind === 'dip';
}

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** the film's own twelve seams, by name */
export const PRESENTATIONS: Record<Join, Presentation> = {
  blend: { component: Blend, secs: 0.52, still: true },
  blur: { component: Blur, secs: 0.64, still: true },
  cut: { secs: 0, still: false },
  defocus: { component: Blur, secs: 0.7, still: true },
  dip: { component: Dip, secs: 0.76, still: true },
  flash: { component: Flash, secs: 0.3, still: false },
  iris: { component: Iris, secs: 0.9, still: true },
  luma: { component: Luma, secs: 0.9, still: true },
  melt: { component: Melt, secs: 1.9, still: true },
  sweep: { secs: 0.6, still: false },
  whip: { secs: 0.36, still: false },
  wipe: { component: Wipe, secs: 1.15, still: true },
};

/** how long each join holds the picture, in seconds */
export const JOIN_SECS: Record<string, number> = Object.fromEntries(
  Object.entries(PRESENTATIONS).map(([k, p]) => [k, p.secs]),
);

/** the joins that hold a still of the outgoing shot over the incoming one */
export const STILL_JOINS: ReadonlySet<string> = new Set(
  Object.entries(PRESENTATIONS)
    .filter(([, p]) => p.still)
    .map(([k]) => k),
);

export interface JoinsSignature {
  Args: {
    /** the colour a dip passes through */
    dipColor?: string;
    /** the outgoing frame, when the page could not hold it in its own glass */
    freeze?: string;
    /** the iris's centre, as inline custom properties */
    irisAt?: string;
    /** which seam is playing */
    kind: '' | JoinName;
    /** every seam the film knows: the twelve, and any a score brought */
    presentations: Record<string, Presentation>;
    /** the film drives the overlay's clock: it is never retired by its own end */
    seekable?: boolean;
    /**
     * A NEW ELEMENT PER CUT. Keyed on the stamp so each overlay plays from
     * its own first frame; the number only ever goes up.
     */
    stamp: number;
  };
}

/**
 * THE SEAM ON SCREEN: whichever presentation the kind names, given the
 * still, a new element per cut. A seam that needs a still and has none
 * (the picture held it in its own glass) paints nothing here.
 */
export class Joins extends Component<JoinsSignature> {
  get presentation(): PresentationComponent | undefined {
    const p = this.args.kind ? this.args.presentations[this.args.kind] : null;
    if (!p?.component) {
      return undefined;
    }
    if (p.still && !this.args.freeze && this.args.kind !== 'dip') {
      return undefined;
    }
    return p.component;
  }

  <template>
    {{#each (array @stamp) key='@identity' as |s|}}
      {{#if s}}
        {{#if this.presentation}}
          <this.presentation
            @still={{if @freeze @freeze ''}}
            @at={{@irisAt}}
            @color={{@dipColor}}
            @seekable={{@seekable}}
          />
        {{/if}}
      {{/if}}
    {{/each}}
  </template>
}

/** `{{array x}}` — one element, so the `each` above is keyed on a scalar */
function array<T>(...items: T[]): T[] {
  return items;
}
