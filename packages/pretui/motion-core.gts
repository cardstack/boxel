// Pretui — MOTION CORE. The four primitives the rest of the kit builds its
// motion on, all four dependency-free (Law 9) and timer-free (realm law):
// every effect is CSS, and the only JavaScript is *measurement* inside an
// ember-modifier that disconnects on cleanup.
//
//   Presence         mount/unmount transitions  ← AnimatePresence
//                    (motion-primitives / framer-motion)
//   InView           scroll-entrance choreography ← motion-primitives InView,
//                    react-bits AnimatedContent / ScrollReveal
//   SlidingHighlight the travelling selection indicator (Law 5's second
//                    canonical mechanism) — shared under Tabs /
//                    SegmentedControl / Select
//   ScrollProgress   reading-progress ribbon ← motion-primitives
//                    ScrollProgress
//
// What the inspiration got wrong, and what this file does instead, is
// recorded per component below. The recurring theme: all four upstreams pay
// a JS animation engine (and a per-frame RAF loop) for behaviour the modern
// CSS platform now expresses declaratively — @starting-style +
// transition-behavior: allow-discrete for real enter AND exit transitions,
// scroll-driven animation timelines for scroll binding. Dropping the engine
// is not a compromise here; it is the upgrade. It also means every one of
// these keeps working when the main thread is busy, which the RAF originals
// do not.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { cssNumber } from './pretui-css';

// ── Shared motion vocabulary ─────────────────────────────────────────────
// One preset table for Presence and InView, so "rise" means the same travel
// in both. Exported so sibling components can speak the same vocabulary
// instead of inventing a third set of names.
export type MotionPreset = 'fade' | 'rise' | 'fall' | 'scale' | 'slide';

const PRESET_TRANSFORM: Record<MotionPreset, string> = {
  fade: 'none',
  rise: 'translateY(var(--pretui-motion-distance, 8px))',
  fall: 'translateY(calc(-1 * var(--pretui-motion-distance, 8px)))',
  scale: 'scale(var(--pretui-motion-scale, 0.96))',
  slide: 'translateX(calc(-1 * var(--pretui-motion-distance, 8px)))',
};

/**
 * The off-screen transform for a named motion preset. Every preset resolves
 * through `--pretui-motion-distance` / `--pretui-motion-scale`, so a caller
 * can retune travel without leaving the preset vocabulary.
 */
export function presetTransform(preset?: MotionPreset): string {
  return PRESET_TRANSFORM[preset ?? 'fade'] ?? PRESET_TRANSFORM.fade;
}

function seconds(value: number | undefined, fallback: number): string {
  let v = value !== undefined && value > 0 ? value : fallback;
  return `${v.toFixed(3)}s`;
}

// ── Presence ─────────────────────────────────────────────────────────────
// Enter AND exit transitions for content that appears and disappears.
//
// Ported from motion-primitives' <AnimatePresence> (itself framer-motion's).
// Upstream needs a whole animation engine for one reason: React removes the
// element the instant the flag flips, so something has to keep a ghost of it
// alive long enough to animate out. That is ~40kB of runtime to defer one
// unmount.
//
// Better than the inspiration: the modern CSS platform now does exit
// transitions natively. `transition-behavior: allow-discrete` lets `display`
// participate in a transition — the browser holds `display: block` for the
// duration and flips to `none` at the end — and `@starting-style` supplies
// the from-values for the enter side, since an element leaving
// `display: none` counts as newly rendered. Zero JS, zero timers, zero
// dependency, and it survives a blocked main thread.
//
// The one API consequence, stated plainly rather than hidden (Law 7): the
// content must stay in the template. Presence owns visibility via @show; do
// NOT wrap it in {{#if}}, or you are back to an instant unmount. Presence
// still works under {{#if}} — you simply get the enter half only.
//
// Dropped upstream surface: `mode='wait' | 'popLayout'` (cross-fading two
// children through a shared layout requires FLIP measurement and a JS
// engine — out of scope for a CSS primitive; render two Presences and stagger
// them with @delay), and variant/keyframe objects (a preset knob plus two
// custom properties covers the honest cases).
export interface PresenceSignature {
  Args: {
    /** visible when true (default). Presence owns display — do NOT also wrap it in {{#if}}, or the exit transition has nothing to animate. */
    show?: boolean;
    /** entrance preset: fade | rise | fall | scale | slide */
    enter?: MotionPreset;
    /** exit preset — separately settable, because leaving reads differently from arriving (Law 7). Defaults to @enter. */
    exit?: MotionPreset;
    /** entrance duration in seconds */
    duration?: number;
    /** exit duration in seconds — defaults to two-thirds of @duration, because leaving should not linger */
    exitDuration?: number;
    /** seconds to wait before entering — the timer-free way to stagger several Presences */
    delay?: number;
    /** travel distance in px for rise / fall / slide */
    distance?: number;
    /** start scale for the scale preset (0–1) */
    scale?: number;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export class Presence extends Component<PresenceSignature> {
  get show(): boolean {
    return this.args.show ?? true;
  }
  // Focus must not be reachable inside content that is on its way out.
  // display:none already removes it once the transition ends; `inert` covers
  // the window in between (upstream leaves that gap open).
  get inert(): true | undefined {
    return this.show ? undefined : true;
  }
  get style(): ReturnType<typeof htmlSafe> {
    let enter = this.args.enter ?? 'fade';
    let exit = this.args.exit ?? enter;
    let duration = this.args.duration !== undefined && this.args.duration > 0
      ? this.args.duration
      : 0.22;
    let bits = [
      `--pretui-presence-enter: ${presetTransform(enter)}`,
      `--pretui-presence-exit: ${presetTransform(exit)}`,
      `--pretui-presence-enter-duration: ${duration.toFixed(3)}s`,
      `--pretui-presence-exit-duration: ${seconds(
        this.args.exitDuration,
        duration * (2 / 3),
      )}`,
      `--pretui-presence-delay: ${(this.args.delay ?? 0).toFixed(3)}s`,
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
  <template>
    <div
      class='pretui-presence'
      data-show={{if this.show 'true' 'false'}}
      inert={{this.inert}}
      style={{this.style}}
      data-test-pretui-presence
      ...attributes
    >{{yield}}</div>
    <style scoped>
      /* Hidden IS the base rule, so its declarations are also the exit
         destination — and because CSS transitions read the after-change
         style, the exit timing lives here and the enter timing lives on the
         shown rule. One mechanism, two independently tuned halves. */
      .pretui-presence {
        display: none;
        opacity: 0;
        transform: var(--pretui-presence-exit, none);
        transition-property: opacity, transform, display;
        transition-duration: var(--pretui-presence-exit-duration, 150ms);
        transition-timing-function: var(
          --pretui-ease-snap,
          cubic-bezier(0.23, 1, 0.32, 1)
        );
        transition-behavior: allow-discrete;
      }
      .pretui-presence[data-show='true'] {
        display: var(--pretui-presence-display, block);
        opacity: 1;
        transform: none;
        transition-property: opacity, transform, display;
        transition-duration: var(--pretui-presence-enter-duration, 220ms);
        transition-delay: var(--pretui-presence-delay, 0s);
        transition-timing-function: var(
          --pretui-ease-snap,
          cubic-bezier(0.23, 1, 0.32, 1)
        );
        transition-behavior: allow-discrete;
      }
      /* Leaving display:none counts as a first render, so this supplies the
         enter from-state on every appearance, not just the first. */
      @starting-style {
        .pretui-presence[data-show='true'] {
          opacity: 0;
          transform: var(--pretui-presence-enter, none);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-presence,
        .pretui-presence[data-show='true'] {
          transition-property: none;
          transform: none;
        }
      }
    </style>
  </template>
}

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

// ── slidingHighlight (modifier) + SlidingHighlight (indicator) ───────────
// Law 5's second canonical mechanism: ONE absolutely-positioned indicator
// whose translate/width follow the active item's offsetLeft/offsetWidth with
// a transition, so the selection TRAVELS instead of cross-fading. The
// travel is what encodes "selection moved from there to here" — the reader
// would otherwise have to infer it.
//
// This is deliberately split in two so adoption by an existing control is a
// five-line diff and no component has to hand its DOM over:
//   {{slidingHighlight}}   on the item container — measures, writes custom
//                          properties, and nothing else
//   <SlidingHighlight />   inside it — the indicator that reads them
// Custom properties inherit across scoped-CSS boundaries, which is precisely
// why the geometry travels as custom properties rather than as classes.
//
// Better than the inspiration (radix/headlessui indicators and the
// react-bits animated tabs): the container does not have to declare which
// item is active. A MutationObserver watches data-state / aria-selected /
// aria-current, so the modifier takes no arguments in the common case and
// stays correct when selection is driven by anything at all — including the
// browser, via :checked-driven attributes. Upstream indicators need the
// active index threaded through props and a useEffect to re-measure.
//
// Also handled, which upstream typically is not:
//   - the first-paint slide from (0,0) is suppressed without a timer, by
//     writing a 0s duration into the SAME style mutation as the first
//     geometry (transitions read the after-change style, so nothing runs)
//   - a ResizeObserver keeps the geometry honest through font loading and
//     container resize
//   - reduced motion parks the indicator on the active item instantly — the
//     END state, never a frozen midpoint
const ACTIVE_SELECTOR =
  '[data-state="active"], [aria-selected="true"], [aria-current="true"], [aria-current="page"]';

/**
 * Measures the active descendant of the element it is installed on and
 * publishes `--pretui-highlight-x/y/w/h/on` for a `<SlidingHighlight />`
 * rendered inside. Takes no arguments in the common case; pass a custom
 * active-item selector when the container also holds selectable content that
 * the default selector would reach — `':scope > [aria-selected=\"true\"]'`
 * confines it to direct children.
 */
export const slidingHighlight = modifier(
  (el: HTMLElement, [selector]: [(string | undefined)?]) => {
    let sel = selector ?? ACTIVE_SELECTOR;
    // The indicator is absolutely positioned; give it a containing block if
    // the container has not already claimed one.
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
    let first = true;
    let watched: HTMLElement | null = null;
    let resize: ResizeObserver | null = null;
    let measure = () => {
      let active = el.querySelector<HTMLElement>(sel);
      if (!active) {
        el.style.setProperty('--pretui-highlight-on', '0');
        return;
      }
      let x: number;
      let y: number;
      let w: number;
      let h: number;
      if (active.offsetParent === el) {
        x = active.offsetLeft;
        y = active.offsetTop;
        w = active.offsetWidth;
        h = active.offsetHeight;
      } else {
        let a = active.getBoundingClientRect();
        let c = el.getBoundingClientRect();
        x = a.left - c.left + el.scrollLeft;
        y = a.top - c.top + el.scrollTop;
        w = a.width;
        h = a.height;
      }
      if (watched !== active) {
        if (resize && watched) resize.unobserve(watched);
        if (resize) resize.observe(active);
        watched = active;
      }
      let style = el.style;
      style.setProperty('--pretui-highlight-x', `${x.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-y', `${y.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-w', `${w.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-h', `${h.toFixed(2)}px`);
      style.setProperty('--pretui-highlight-on', '1');
      // First measurement lands with a 0s duration in the same mutation, so
      // the indicator appears in place instead of sliding in from the
      // origin. Clearing the property afterwards restores the real duration.
      style.setProperty('--pretui-highlight-init', first ? '0s' : '');
      first = false;
    };
    if (typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(() => measure());
    }
    measure();
    resize?.observe(el);
    let mutation =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(() => measure());
    // 'style' is deliberately absent from the filter: the modifier writes to
    // el.style itself, and watching it would feed back into this observer.
    mutation?.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-state', 'aria-selected', 'aria-current'],
    });
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
    };
  },
);

export interface SlidingHighlightSignature {
  Args: {
    /** pill (default, a raised card face) | underline | soft (accent tint) | outline */
    variant?: 'pill' | 'underline' | 'soft' | 'outline';
    /** travel duration in seconds */
    duration?: number;
    /** bar thickness in px — the underline variant only */
    thickness?: number;
    /** corner radius in px; defaults to the control radius, or 1px under underline */
    radius?: number;
  };
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

/**
 * The travelling indicator. Render it inside a container carrying
 * `{{slidingHighlight}}`; it needs no arguments to work. Its block is a slot
 * for callers who want to paint the indicator themselves (a gradient, a
 * texture) while keeping the travel.
 */
export class SlidingHighlight extends Component<SlidingHighlightSignature> {
  get variant(): string {
    return this.args.variant ?? 'pill';
  }
  get style(): ReturnType<typeof htmlSafe> {
    let bits: string[] = [];
    if (this.args.duration !== undefined) {
      bits.push(
        `--pretui-highlight-duration: ${seconds(this.args.duration, 0.22)}`,
      );
    }
    {
      let n = cssNumber(this.args.thickness, 0, 1000);
      if (n !== undefined) {
        bits.push(`--pretui-highlight-thickness: ${n}px`);
      }
    }
    {
      let n = cssNumber(this.args.radius, 0, 1000);
      if (n !== undefined) {
        bits.push(`--pretui-highlight-radius: ${n}px`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  <template>
    <span
      class='pretui-highlight'
      data-variant={{this.variant}}
      style={{this.style}}
      aria-hidden='true'
      data-test-pretui-sliding-highlight
      ...attributes
    >{{yield}}</span>
    <style scoped>
      .pretui-highlight {
        position: absolute;
        inset-block-start: 0;
        inset-inline-start: 0;
        width: var(--pretui-highlight-w, 0px);
        height: var(--pretui-highlight-h, 0px);
        transform: translate(
          var(--pretui-highlight-x, 0px),
          var(--pretui-highlight-y, 0px)
        );
        opacity: var(--pretui-highlight-on, 0);
        border-radius: var(--pretui-highlight-radius, var(--radius));
        pointer-events: none;
        z-index: 0;
        transition-property: transform, width, height, opacity;
        /* --init is present only for the first measurement (see the
           modifier); the chain then falls through to the caller's duration,
           then to the kit's snap default. */
        transition-duration: var(
          --pretui-highlight-init,
          var(--pretui-highlight-duration, var(--pretui-dur-snap, 180ms))
        );
        transition-timing-function: var(
          --pretui-highlight-ease,
          var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1))
        );
      }
      .pretui-highlight[data-variant='pill'] {
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-control,
          0 0 0 1px var(--border),
          0 1px 2px rgb(16 24 40 / 0.1)
        );
      }
      .pretui-highlight[data-variant='soft'] {
        background: color-mix(
          in oklch,
          var(--primary) 14%,
          var(--card)
        );
      }
      .pretui-highlight[data-variant='outline'] {
        box-shadow: 0 0 0 1px var(--primary);
      }
      .pretui-highlight[data-variant='underline'] {
        height: var(--pretui-highlight-thickness, 2px);
        border-radius: var(--pretui-highlight-radius, 1px);
        background: var(--primary);
        /* ride the bottom edge of the active item's box */
        transform: translate(
          var(--pretui-highlight-x, 0px),
          calc(
            var(--pretui-highlight-y, 0px) + var(--pretui-highlight-h, 0px) -
              var(--pretui-highlight-thickness, 2px)
          )
        );
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-highlight {
          transition-property: none;
        }
      }
    </style>
  </template>
}

// ── scrollProgress (modifier) + ScrollProgress ───────────────────────────
// Reading-progress ribbon bound to scroll position.
//
// Ported from motion-primitives' <ScrollProgress>, which subscribes to
// framer-motion's useScroll — a scroll listener feeding a spring on every
// frame — and renders a bare <div> with no role, no label, and no
// reduced-motion consideration.
//
// Better than the inspiration: the default path is a pure CSS scroll-driven
// animation (`animation-timeline: scroll()`), which runs off the main thread
// entirely — no listener, no frame loop, no jank while the page is busy.
// Where scroll timelines are unavailable, or where the caller opts into
// announcing progress, the modifier installs a *passive scroll listener*
// (an event listener, not a timer) and writes the ratio into the same custom
// property the CSS path animates, so exactly one set of styles serves both.
//
// Accessibility, which upstream skips entirely: a reading ribbon is chrome —
// the scroll container already reports position to assistive tech, and a
// second, unlabelled progressbar is noise. So the default is
// `aria-hidden='true'` by deliberate choice, documented here rather than by
// omission. Callers who genuinely need it announced pass @label with
// @announce, which switches on `role='progressbar'` with a live
// `aria-valuenow` — and necessarily switches to the listener path, because a
// CSS scroll timeline's position is not observable from script.
//
// Dropped upstream surface: `springOptions` (a spring lag between the
// scrollbar and the ribbon makes the readout wrong; a progress indicator is
// a direct readout, not an animation) and the container-ref prop (@source
// resolves the scroller from the DOM instead).
function nearestScroller(el: HTMLElement): HTMLElement {
  let node = el.parentElement;
  while (node) {
    // Declared overflow, not current overflow: the modifier installs before
    // the sibling content that will make the box scroll, so measuring
    // scrollHeight here would walk straight past the intended scroller.
    let overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/**
 * Degradation + announcement path for `<ScrollProgress />`. No-ops (leaving
 * the CSS scroll timeline in charge) when scroll-driven animations are
 * supported and nothing needs announcing.
 */
export const scrollProgress = modifier(
  (el: HTMLElement, [source, announce]: ['page' | 'nearest', boolean]) => {
    let cssDriven =
      !announce &&
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('animation-timeline', 'scroll()');
    if (cssDriven) return;
    el.setAttribute('data-js', 'true');
    let scroller =
      source === 'nearest'
        ? nearestScroller(el)
        : ((document.scrollingElement as HTMLElement) ??
          document.documentElement);
    let target: EventTarget =
      scroller === document.scrollingElement ||
      scroller === document.documentElement
        ? window
        : scroller;
    let update = () => {
      let max = scroller.scrollHeight - scroller.clientHeight;
      let ratio = max > 0 ? scroller.scrollTop / max : 0;
      ratio = Math.min(Math.max(ratio, 0), 1);
      el.style.setProperty('--pretui-scroll-progress', ratio.toFixed(4));
      if (announce) {
        el.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      }
    };
    update();
    target.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      target.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  },
);

export interface ScrollProgressSignature {
  Args: {
    /** 'page' (default) tracks the document; 'nearest' tracks the closest scrolling ancestor — the ribbon must live inside it */
    source?: 'page' | 'nearest';
    /** ribbon thickness in px */
    thickness?: number;
    /** show the unfilled remainder as a track (default true) — this is what makes the component legible in a still frame */
    track?: boolean;
    /** 'none' (default) leaves placement to the caller; 'top' / 'bottom' stick the ribbon to that edge of its scroll container */
    affix?: 'none' | 'top' | 'bottom';
    /** accessible name — required when @announce is true */
    label?: string;
    /** expose the ribbon as a live progressbar to assistive tech. Off by default: see the a11y note in the source. Forces the scroll-listener path. */
    announce?: boolean;
  };
  Element: HTMLDivElement;
}

export class ScrollProgress extends Component<ScrollProgressSignature> {
  get source(): 'page' | 'nearest' {
    return this.args.source ?? 'page';
  }
  get announce(): boolean {
    return this.args.announce ?? false;
  }
  get hidden(): 'true' | undefined {
    return this.announce ? undefined : 'true';
  }
  get role(): string | undefined {
    return this.announce ? 'progressbar' : undefined;
  }
  get affix(): string {
    return this.args.affix ?? 'none';
  }
  get showTrack(): boolean {
    return this.args.track ?? true;
  }
  get style(): ReturnType<typeof htmlSafe> {
    let bits: string[] = [];
    {
      let n = cssNumber(this.args.thickness, 0, 1000);
      if (n !== undefined) {
        bits.push(`--pretui-scrollprogress-thickness: ${n}px`);
      }
    }
    return htmlSafe(bits.join('; '));
  }
  <template>
    <div
      class='pretui-scrollprogress'
      data-source={{this.source}}
      data-affix={{this.affix}}
      data-track={{if this.showTrack 'true' 'false'}}
      style={{this.style}}
      role={{this.role}}
      aria-hidden={{this.hidden}}
      aria-label={{if this.announce @label}}
      aria-valuemin={{if this.announce '0'}}
      aria-valuemax={{if this.announce '100'}}
      data-test-pretui-scroll-progress
      {{scrollProgress this.source this.announce}}
      ...attributes
    >
      <span class='pretui-scrollprogress-fill'></span>
    </div>
    <style scoped>
      .pretui-scrollprogress {
        position: relative;
        overflow: hidden;
        height: var(--pretui-scrollprogress-thickness, 3px);
        border-radius: var(--pretui-scrollprogress-radius, 999px);
      }
      .pretui-scrollprogress[data-track='true'] {
        background: var(
          --pretui-scrollprogress-track,
          color-mix(in oklch, var(--foreground) 10%, transparent)
        );
      }
      .pretui-scrollprogress[data-affix='top'] {
        position: sticky;
        inset-block-start: 0;
        z-index: 2;
      }
      .pretui-scrollprogress[data-affix='bottom'] {
        position: sticky;
        inset-block-end: 0;
        z-index: 2;
      }
      .pretui-scrollprogress-fill {
        position: absolute;
        inset: 0;
        transform-origin: left center;
        transform: scaleX(var(--pretui-scroll-progress, 0));
        border-radius: inherit;
        background: var(--pretui-scrollprogress-fill, var(--primary));
      }
      @keyframes pretui-scrollprogress-grow {
        from {
          transform: scaleX(0);
        }
        to {
          transform: scaleX(1);
        }
      }
      /* The preferred path: the compositor drives this off the scroll
         timeline, so it never touches the main thread. [data-js] is written
         by the modifier only when it has taken over. Order matters — the
         `animation` shorthand resets animation-timeline, so the timeline
         longhand has to come after it. */
      @supports (animation-timeline: scroll()) {
        .pretui-scrollprogress[data-source='page']:not([data-js])
          .pretui-scrollprogress-fill {
          animation: pretui-scrollprogress-grow linear both;
          animation-timeline: scroll(root block);
        }
        .pretui-scrollprogress[data-source='nearest']:not([data-js])
          .pretui-scrollprogress-fill {
          animation: pretui-scrollprogress-grow linear both;
          animation-timeline: scroll(nearest block);
        }
      }
      /* No reduced-motion branch by design: the ribbon is a 1:1 readout of
         scroll position with no easing, no lag and no independent movement,
         so there is nothing for prefers-reduced-motion to reduce. */
    </style>
  </template>
}
