// Pretui — InView: entrance choreography that fires when content scrolls into view.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { cssNumber } from '../pretui-css';
import { presetTransform, seconds } from '../internal/motion-core';
import type { MotionPreset } from '../internal/motion-core';

// ── inViewport (modifier) ────────────────────────────────────────────────
// Measurement-only IntersectionObserver: it sets data-inview on its element
// and nothing else. Exported on its own because any component can gate its
// own CSS on the attribute — the observer is the reusable part, not the
// wrapper.
//
// Note the polarity, which is the accessibility fix over every upstream: the
// element's RESTING style is the visible end state, and the modifier writes
// data-inview="false" at install to opt into the hidden pre-state. With no
// JS, no IntersectionObserver, or in a prerender, the attribute never
// appears and the content is simply visible. motion-primitives sets
// `opacity: 0` in React state, so a failed hydration leaves the page blank.
const ROOT_MARGIN_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)$/;

export function normalizeRootMargin(value: unknown): string {
  if (typeof value !== 'string') return '0px';
  let tokens = value.trim().split(/\s+/);
  if (
    tokens.length < 1 ||
    tokens.length > 4 ||
    tokens.some((token) => !ROOT_MARGIN_TOKEN.test(token))
  ) {
    return '0px';
  }
  return tokens.join(' ');
}

export const inViewport = modifier(
  (
    el: HTMLElement,
    [threshold, rootMargin, once]: [number, string, boolean],
  ) => {
    if (typeof IntersectionObserver === 'undefined') return;
    el.setAttribute('data-inview', 'false');
    let observer = new IntersectionObserver(
      (entries) => {
        for (let entry of entries) {
          if (entry.isIntersecting) {
            el.setAttribute('data-inview', 'true');
            if (once) observer.disconnect();
          } else if (!once) {
            el.setAttribute('data-inview', 'false');
          }
        }
      },
      { threshold, rootMargin: normalizeRootMargin(rootMargin) },
    );
    observer.observe(el);
    return () => observer.disconnect();
  },
);

interface InViewCell {
  item: unknown;
  index: number;
  style: ReturnType<typeof htmlSafe>;
}

// ── InView ───────────────────────────────────────────────────────────────
// Entrance choreography that fires when content scrolls into view.
//
// Ported from motion-primitives' <InView> and react-bits'
// AnimatedContent / ScrollReveal. Upstream drives every reveal through the
// motion engine's variants and a per-element JS animation; the stagger is a
// `delayChildren` value fed into that engine.
//
// Better than the inspiration, three ways:
//   1. No engine. The observer only flips an attribute; the reveal is a CSS
//      transition, so N revealing children cost one style recalc, not N
//      animation instances.
//   2. Resting state is the END state (see inViewport above) — the still
//      frame is correct content, not a blank box (Law 8), and a
//      no-JavaScript render is readable.
//   3. Reduced motion gets the content immediately and unconditionally: the
//      hidden pre-state is neutralised, not merely un-animated, so a
//      reduced-motion reader can never be left staring at opacity 0.
// The stagger is precomputed as `index * --stagger` in a transition-delay —
// no timers, no sequencing loop.
//
// Dropped upstream surface: `viewOptions.root` (an arbitrary scroll root
// element is not addressable from a template without a ref plumbing surface;
// use @rootMargin), and per-child custom variant objects (the preset table
// plus the CSS custom-property channel covers it).
export interface InViewSignature {
  Args: {
    /** entrance preset: fade | rise | fall | scale | slide */
    enter?: MotionPreset;
    /** reveal once and disconnect the observer (default true); false re-hides on exit */
    once?: boolean;
    /** IntersectionObserver threshold, 0–1 (default 0.2) */
    threshold?: number;
    /** IntersectionObserver rootMargin, e.g. '0px 0px -12% 0px' to trip early */
    rootMargin?: string;
    /** seconds between consecutive children — only meaningful with @items */
    stagger?: number;
    /** transition duration in seconds */
    duration?: number;
    /** seconds before the first child moves */
    delay?: number;
    /** travel distance in px for rise / fall / slide */
    distance?: number;
    /** start scale for the scale preset (0–1) */
    scale?: number;
    /** pass a list to stagger it; each entry renders through the :item block. Omit for a single-block reveal. */
    items?: unknown[];
  };
  Blocks: {
    /* eslint-disable @typescript-eslint/no-explicit-any -- @items is an
       opaque list (the structure-extras Grid precedent); the block yields
       each entry back untyped alongside its index */
    default: [];
    item: [any, number];
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
  Element: HTMLDivElement;
}

export class InView extends Component<InViewSignature> {
  get once(): boolean {
    return this.args.once ?? true;
  }
  get threshold(): number {
    return this.args.threshold ?? 0.2;
  }
  get rootMargin(): string {
    return normalizeRootMargin(this.args.rootMargin);
  }
  get mode(): 'items' | 'block' {
    return this.args.items ? 'items' : 'block';
  }
  get style(): ReturnType<typeof htmlSafe> {
    let bits = [
      `--pretui-inview-from: ${presetTransform(this.args.enter ?? 'rise')}`,
      `--pretui-inview-duration: ${seconds(this.args.duration, 0.48)}`,
      `--pretui-inview-delay: ${(this.args.delay ?? 0).toFixed(3)}s`,
      `--pretui-inview-stagger: ${(this.args.stagger ?? 0).toFixed(3)}s`,
    ];
    {
      let n = cssNumber(this.args.distance, -10000, 10000);
      if (n !== undefined) {
        bits.push(`--pretui-motion-distance: ${n}px`);
      }
    }
    {
      let n = cssNumber(this.args.scale, 0, 100);
      if (n !== undefined) {
        bits.push(`--pretui-motion-scale: ${n}`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  get cells(): InViewCell[] {
    return (this.args.items ?? []).map((item, index) => ({
      item,
      index,
      style: htmlSafe(`--pretui-inview-i: ${index}`),
    }));
  }
  <template>
    <div
      class='pretui-inview'
      data-mode={{this.mode}}
      style={{this.style}}
      data-test-pretui-inview
      {{inViewport this.threshold this.rootMargin this.once}}
      ...attributes
    >
      {{#if @items}}
        {{#each this.cells key='index' as |cell|}}
          <div class='pretui-inview-item' style={{cell.style}}>
            {{yield cell.item cell.index to='item'}}
          </div>
        {{/each}}
      {{else}}
        {{yield}}
      {{/if}}
    </div>
    <style scoped>
      .pretui-inview {
        display: var(--pretui-inview-display, block);
      }
      .pretui-inview-item {
        display: var(--pretui-inview-item-display, block);
      }
      /* The revealed state is the plain, unqualified rule — see the polarity
         note on inViewport. Only the [data-inview='false'] rules hide, and
         they only exist once the observer is live. */
      .pretui-inview[data-mode='block'],
      .pretui-inview-item {
        transition-property: opacity, transform;
        transition-duration: var(--pretui-inview-duration, 480ms);
        transition-timing-function: var(
          --pretui-ease-out,
          cubic-bezier(0.16, 1, 0.3, 1)
        );
      }
      .pretui-inview[data-mode='block'] {
        transition-delay: var(--pretui-inview-delay, 0s);
      }
      .pretui-inview-item {
        transition-delay: calc(
          var(--pretui-inview-delay, 0s) + var(--pretui-inview-i, 0) *
            var(--pretui-inview-stagger, 0s)
        );
      }
      .pretui-inview[data-mode='block'][data-inview='false'],
      .pretui-inview[data-inview='false'] .pretui-inview-item {
        opacity: 0;
        transform: var(--pretui-inview-from, none);
        transition-delay: 0s;
      }
      /* Reduced motion neutralises the pre-state itself, not just the
         transition — the content is there on the first frame. */
      @media (prefers-reduced-motion: reduce) {
        .pretui-inview[data-mode='block'][data-inview='false'],
        .pretui-inview[data-inview='false'] .pretui-inview-item {
          opacity: 1;
          transform: none;
        }
        .pretui-inview[data-mode='block'],
        .pretui-inview-item {
          transition-property: none;
        }
      }
    </style>
  </template>
}
