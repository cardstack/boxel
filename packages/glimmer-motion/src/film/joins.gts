import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type { Join } from './types.ts';

/**
 * A JOIN OVERLAY LIVES EXACTLY AS LONG AS ITS ANIMATION.
 *
 * Every join paints the outgoing frame over the film and gets out of the
 * way — and "gets out of the way" was once left to each overlay's own
 * last keyframe. The wipe's is a swept MASK, not an opacity, so when it
 * finished the element stayed at opacity 1 with a mask that did not, in
 * fact, hide it: a full-screen still of the previous shot sat on top of
 * the picture for the rest of the chapter. So the overlay retires itself
 * the moment its animation ends, and the next cut builds a fresh one. No
 * join can outlive its own play.
 */
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

/** how long each join holds the picture, in seconds — the type waits it out */
export const JOIN_SECS: Record<string, number> = {
  blend: 0.52,
  blur: 0.64,
  defocus: 0.7,
  dip: 0.76,
  flash: 0.3,
  iris: 0.9,
  luma: 0.9,
  melt: 1.9,
  sweep: 0.6,
  whip: 0.36,
  wipe: 1.15,
};

/** the joins that hold a still of the outgoing shot over the incoming one */
export const STILL_JOINS: ReadonlySet<string> = new Set([
  'blend',
  'blur',
  'dip',
  'iris',
  'luma',
  'melt',
  'wipe',
]);

export interface JoinsSignature {
  Args: {
    /** the colour a dip passes through */
    dipColor?: string;
    /** the outgoing frame, when the page could not hold it in its own glass */
    freeze?: string;
    /** the iris's centre, as inline custom properties */
    irisAt?: string;
    /** which seam is playing */
    kind: '' | Join;
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
 * THE TRANSITIONS, as one component. The outgoing frame is held (in the
 * page's own render target when it can, as a still in the DOM when it
 * cannot) while the incoming shot plays live underneath, and the seam is
 * whatever the join does to that still: sweep it, thin it, close it in a
 * circle, cover it with a colour. A `whip`, a `sweep` and a `cut` paint
 * nothing here — they are the camera's and the light's.
 */
export class Joins extends Component<JoinsSignature> {
  get dipVeil(): string {
    return `background:${this.args.dipColor ?? '#0d0905'}`;
  }

  get stillKind(): '' | Join {
    return this.args.freeze ? this.args.kind : '';
  }

  <template>
    {{#each (array @stamp) key='@identity' as |s|}}
      {{#if s}}
        {{#if (eq this.stillKind 'wipe')}}
          {{! THE WIPE: the outgoing frame itself, swept off along the sun's
          diagonal behind a feathered edge }}
          <div class='cf-swipe' aria-hidden='true' {{retire @seekable}}>
            <img src={{@freeze}} alt='' />
          </div>
        {{else if (eq this.stillKind 'melt')}}
          {{! THE MELT: the long soft one, no push and no colour }}
          <img
            class='cf-melt'
            src={{@freeze}}
            alt=''
            aria-hidden='true'
            {{retire @seekable}}
          />
        {{else if (eq this.stillKind 'blend')}}
          {{! THE FREEZE-BLEND: the outgoing frame held as a still and faded
          over the live incoming shot }}
          <img
            class='cf-blend'
            src={{@freeze}}
            alt=''
            aria-hidden='true'
            {{retire @seekable}}
          />
        {{else if (eq this.stillKind 'iris')}}
          {{! THE IRIS: the old shot closes in a circle onto the incoming
          subject; the centre rides inline custom properties }}
          <img
            class='cf-iris'
            src={{@freeze}}
            style={{@irisAt}}
            alt=''
            aria-hidden='true'
            {{retire @seekable}}
          />
        {{else if (eq this.stillKind 'blur')}}
          <img
            class='cf-blurout'
            src={{@freeze}}
            alt=''
            aria-hidden='true'
            {{retire @seekable}}
          />
        {{else if (eq this.stillKind 'defocus')}}
          {{! the freeze half of the rack: the live frame arrives soft
          underneath, animated by the engine }}
          <img
            class='cf-blurout'
            src={{@freeze}}
            alt=''
            aria-hidden='true'
            {{retire @seekable}}
          />
        {{else if (eq this.stillKind 'luma')}}
          <img
            class='cf-luma'
            src={{@freeze}}
            alt=''
            aria-hidden='true'
            {{retire @seekable}}
          />
        {{/if}}
        {{#if (eq @kind 'flash')}}
          <i class='cf-flash' aria-hidden='true' {{retire @seekable}}></i>
        {{/if}}
        {{#if (eq @kind 'dip')}}
          {{! THE DIP: freeze under, veil over. The old shot holds while the
          colour closes, the seam passes in the dark (or the light), and
          the veil lifts on the new shot. }}
          <span class='cf-dip' aria-hidden='true' {{retire @seekable}}>
            {{#if @freeze}}
              <img src={{@freeze}} alt='' />
            {{/if}}
            <i style={{this.dipVeil}}></i>
          </span>
        {{/if}}
      {{/if}}
    {{/each}}
  </template>
}

/** a template helper: two things are the same string */
function eq(a: unknown, b: unknown): boolean {
  return a === b;
}

/** `{{array x}}` — one element, so the `each` above is keyed on a scalar */
function array<T>(...items: T[]): T[] {
  return items;
}
