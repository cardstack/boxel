// Pretui — Carousel: a scroll-snap slide track with arrows, dots and a live status.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { cssStyleFrom } from '../pretui-css';
import { Scroller } from './scroller';
import { clamp, scrollBehavior } from '../internal/structure-scroll';

// ── Carousel ─────────────────────────────────────────────────────────────

/** Where the viewport rests when slide `index` is current: the slide's
 * offset, or the far end when the last slides cannot reach the start. */
function restingLeft(viewport: HTMLElement, track: HTMLElement, index: number): number | undefined {
  let child = track.children[index] as HTMLElement | undefined;
  if (!child) {
    return undefined;
  }
  let max = viewport.scrollWidth - viewport.clientWidth;
  return Math.max(0, Math.min(child.offsetLeft, max));
}

/**
 * The slide the viewport is resting nearest. Where several slides share a
 * resting place — the last ones, when more than one fits — `current` keeps
 * the index if it is among them, so a move to the last slide is not read
 * back as the one before it.
 */
function nearestIndex(viewport: HTMLElement, track: HTMLElement, current: number): number {
  let best = current;
  let bestDistance = Infinity;
  let left = viewport.scrollLeft;
  for (let index = 0; index < track.children.length; index++) {
    let rest = restingLeft(viewport, track, index);
    if (rest === undefined) {
      continue;
    }
    let distance = Math.abs(left - rest);
    if (distance < bestDistance - 1) {
      best = index;
      bestDistance = distance;
    } else if (Math.abs(distance - bestDistance) <= 1 && index === current) {
      best = index;
    }
  }
  return best;
}

// Controls that own their own arrow keys. A slide can render a form, a
// slider, a listbox or a rich-text field; taking ArrowLeft from any of those
// to advance the carousel would break the control the reader is actually
// using.
const CAROUSEL_KEY_EXEMPT =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="combobox"], [role="menu"], [role="tree"], [role="grid"]';

/**
 * The keyboard path, bound inside the modifier rather than with `{{on}}`:
 * the scroll viewport's `tabindex` is applied at runtime by `scrollEdges`, so
 * a template-level `{{on 'keydown'}}` on an element the linter sees as
 * non-interactive is rejected by `no-invalid-interactive`.
 *
 * **Fixed 2026-08-13.** This used to be installed on the TRACK, which is a
 * descendant of the element `scrollEdges` makes focusable — so the keydown
 * fired on the focused viewport and bubbled *upward*, past the listener,
 * every time. Tab to the carousel, press an arrow, and nothing but the
 * native scroll step happened, landing between two snap points: precisely
 * what the preventDefault below exists to stop. It now rides the carousel
 * ROOT, above the viewport, and guards `event.target` so a control inside a
 * slide keeps its own arrows.
 */
const carouselKeys = modifier(
  (root: HTMLElement, [go]: [(delta: number | 'first' | 'last') => void]) => {
    let onKeydown = (event: KeyboardEvent) => {
      let target = event.target as Element | null;
      if (target?.closest?.(CAROUSEL_KEY_EXEMPT)) {
        return;
      }
      let key = event.key;
      let handled = true;
      if (key === 'ArrowRight' || key === 'ArrowDown') {
        go(1);
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
        go(-1);
      } else if (key === 'Home') {
        go('first');
      } else if (key === 'End') {
        go('last');
      } else if (key === 'PageDown') {
        go(1);
      } else if (key === 'PageUp') {
        go(-1);
      } else {
        handled = false;
      }
      if (handled) {
        // The native arrow-key scroll would move by a scroll STEP, landing
        // between two snap points; taking the event is what makes the
        // keyboard path land on a slide like the pointer path does.
        event.preventDefault();
      }
    };
    root.addEventListener('keydown', onKeydown);
    return () => root.removeEventListener('keydown', onKeydown);
  },
);

export interface CarouselSignature<T = unknown> {
  Args: {
    /** The slides, yielded back in the caller's own row type. */
    items: T[];
    /** Accessible name for the carousel as a whole. Strongly recommended:
     * it is what a rotor lists, and what the "slide 3 of 7" status attaches
     * to. */
    label?: string;
    /** Controlled index. Omit for uncontrolled. */
    index?: number;
    /** Fires with the next index whenever the reader moves, by any means —
     * button, dot, keyboard or their own thumb on the track. */
    onIndexChange?: (index: number) => void;
    /** Wrap past the ends instead of stopping. Default false: stopping is
     * the honest default when the control also disables itself at the end. */
    loop?: boolean;
    /** Hide the previous/next buttons. The keyboard path is unaffected. */
    hideControls?: boolean;
    /** Hide the dot strip. The status line is unaffected. */
    hideDots?: boolean;
    /** Slides visible at once. A CSS knob under the hood
     * (`--pretui-carousel-slide`); default 1. */
    perView?: number;
  };
  Blocks: {
    /** One slide. Receives the item and its zero-based index. */
    slide: [item: T, index: number];
  };
  Element: HTMLDivElement;
}

/**
 * A scroll-snap carousel with a real keyboard path.
 *
 * ```hbs
 * <Carousel @items={{this.lots}} @label='Featured lots'>
 *   <:slide as |lot|><LotCard @lot={{lot}} /></:slide>
 * </Carousel>
 * ```
 *
 * The Scroller viewport is a native scroll container with `scroll-snap-type`, so the
 * thumb path, the momentum, the rubber-banding and the accessibility of
 * scrolling are the platform's rather than a re-implementation. Everything
 * added on top — arrows, dots, `Home`/`End`, the polite "slide 3 of 7"
 * status — routes through the same `goTo`.
 *
 * Better than the inspiration: the surveyed carousels bind `mousedown` drag
 * handlers (dead on touch, dead on keyboard), announce nothing, and ship an
 * auto-advance that runs regardless of `prefers-reduced-motion`. Here the
 * drag is the platform's, every pointer path has a keyboard twin, the slide
 * change is announced once and politely, and **auto-advance is not shipped
 * at all** — see the file header for why that is a decision and not a gap.
 */
export class Carousel<T = unknown> extends Component<CarouselSignature<T>> {
  @tracked private internalIndex = 0;
  private trackEl?: HTMLElement;
  private viewportEl?: HTMLElement;
  /** The slide a button, dot or key asked for, while the viewport scrolls
   * to it. Every slide that scroll passes would otherwise read as the
   * reader moving; until it arrives, the requested index stands. */
  private pendingIndex: number | undefined;

  captureTrack = modifier((track: HTMLElement) => {
    // The Scroller's viewport is the element that scrolls; the track is its
    // content. Snapping belongs on the scroll container, and that element is
    // Scroller's, so it is set here rather than in this stylesheet.
    let viewport = track.parentElement as HTMLElement;
    this.trackEl = track;
    this.viewportEl = viewport;
    viewport.style.scrollSnapType = 'x mandatory';
    // The reader taking the viewport back ends a requested move early.
    let release = () => (this.pendingIndex = undefined);
    let onScroll = () => this.settle();
    let inputs = ['pointerdown', 'wheel', 'touchstart'];
    for (let type of inputs) {
      viewport.addEventListener(type, release, { passive: true });
    }
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('scrollend', onScroll, { passive: true });
    return () => {
      for (let type of inputs) {
        viewport.removeEventListener(type, release);
      }
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('scrollend', onScroll);
      viewport.style.scrollSnapType = '';
    };
  });

  get count(): number {
    return this.args.items?.length ?? 0;
  }

  get index(): number {
    let raw = this.args.index ?? this.internalIndex;
    return clamp(Math.round(raw), 0, Math.max(0, this.count - 1));
  }

  get atStart(): boolean {
    return !this.args.loop && this.index <= 0;
  }
  get atEnd(): boolean {
    return !this.args.loop && this.index >= this.count - 1;
  }

  /** "Slide 3 of 7" — one polite announcement per change, never per scroll
   * frame, because the text only changes when the index does. */
  get status(): string {
    return this.count === 0
      ? ''
      : 'Slide ' + (this.index + 1) + ' of ' + this.count;
  }

  get slides(): { item: T; index: number; label: string }[] {
    return (this.args.items ?? []).map((item, index) => ({
      item,
      index,
      label: index + 1 + ' of ' + this.count,
    }));
  }

  get dots(): { index: number; current: 'true' | undefined; label: string }[] {
    return (this.args.items ?? []).map((_item, index) => ({
      index,
      current: index === this.index ? ('true' as const) : undefined,
      label: 'Show slide ' + (index + 1) + ' of ' + this.count,
    }));
  }

  get trackStyle() {
    let perView = Math.max(1, Math.round(this.args.perView ?? 1));
    // A clamped integer, so the percentage can never carry a declaration.
    return cssStyleFrom([
      '--pretui-carousel-slide: calc((100% - (' +
        (perView - 1) +
        ' * var(--pretui-carousel-gap, 12px))) / ' +
        perView +
        ')',
    ]);
  }

  /** The single funnel every path goes through: buttons, dots, keyboard,
   * and the observer that reports a thumb-driven scroll. */
  goTo = (next: number) => {
    if (this.count === 0) {
      return;
    }
    let last = this.count - 1;
    let target = this.args.loop
      ? ((next % this.count) + this.count) % this.count
      : clamp(next, 0, last);
    if (this.args.index === undefined) {
      this.internalIndex = target;
    }
    this.args.onIndexChange?.(target);
    this.scrollToIndex(target);
  };

  step = (delta: number | 'first' | 'last') => {
    if (delta === 'first') {
      this.goTo(0);
    } else if (delta === 'last') {
      this.goTo(this.count - 1);
    } else {
      this.goTo(this.index + delta);
    }
  };

  previous = () => this.step(-1);
  next = () => this.step(1);

  /** Called as the viewport scrolls, and once more when it stops (scrollend). A thumb
   * or wheel scroll moves the index; it never scrolls back, which would
   * fight the reader. */
  private settle() {
    let viewport = this.viewportEl;
    let track = this.trackEl;
    if (!viewport || !track) {
      return;
    }
    if (this.pendingIndex !== undefined) {
      // Still travelling, or a scroll that ended short because a newer
      // request interrupted it. Only arriving releases the request.
      if (this.atIndex(this.pendingIndex)) {
        this.pendingIndex = undefined;
      }
      return;
    }
    let index = nearestIndex(viewport, track, this.index);
    if (index === this.index) {
      return;
    }
    if (this.args.index === undefined) {
      this.internalIndex = index;
    }
    this.args.onIndexChange?.(index);
  }

  private atIndex(index: number): boolean {
    let viewport = this.viewportEl;
    let track = this.trackEl;
    if (!viewport || !track) {
      return true;
    }
    let rest = restingLeft(viewport, track, index);
    return rest === undefined || Math.abs(viewport.scrollLeft - rest) <= 1;
  }

  private scrollToIndex(index: number): void {
    let viewport = this.viewportEl;
    let track = this.trackEl;
    if (!viewport || !track) {
      return;
    }
    let rest = restingLeft(viewport, track, index);
    // `viewport.scrollTo` rather than `child.scrollIntoView`: scrollIntoView
    // may scroll every ancestor, so a carousel deep in a page could yank the
    // whole page. The track is positioned, so a slide's offsetLeft is
    // already measured from the start of the scrolled content.
    if (rest === undefined || this.atIndex(index)) {
      return;
    }
    this.pendingIndex = index;
    viewport.scrollTo({ left: rest, behavior: scrollBehavior() });
  }

  <template>
    <div
      class='pretui-carousel'
      role='group'
      aria-roledescription='carousel'
      aria-label={{@label}}
      data-test-pretui-carousel
      ...attributes
      {{carouselKeys this.step}}
    >
      <Scroller
        @orientation='horizontal'
        @label={{@label}}
        @edge='fade'
        @hideScrollbar={{true}}
      >
        <div
          class='pretui-carousel-track'
          style={{this.trackStyle}}
          data-test-pretui-carousel-track
          {{this.captureTrack}}
        >
          {{#each this.slides key='index' as |slide|}}
            <div
              class='pretui-carousel-slide'
              role='group'
              aria-roledescription='slide'
              aria-label={{slide.label}}
              data-index={{slide.index}}
            >
              {{yield slide.item slide.index to='slide'}}
            </div>
          {{/each}}
        </div>
      </Scroller>

      {{! One polite status, changing only when the index does. The APG's
          alternative — aria-live on the track itself — reads the whole slide
          aloud on every scroll frame. }}
      <p class='pretui-sr' role='status' data-test-pretui-carousel-status>
        {{this.status}}
      </p>

      {{#unless @hideControls}}
        <div class='pretui-carousel-controls'>
          <button
            type='button'
            class='pretui-carousel-arrow'
            data-direction='previous'
            aria-label='Previous slide'
            {{!-- aria-disabled, never the disabled attribute: `disabled`
                  removes the button from the tab order the instant it is
                  pressed into the end of the run, so focus falls to <body>
                  and the reader loses their place. The state is still
                  exposed, the button still takes focus, and `step` refuses
                  the move. --}}
            aria-disabled={{if this.atStart 'true'}}
            data-test-pretui-carousel-previous
            {{on 'click' this.previous}}
          ><span class='pretui-carousel-chevron' aria-hidden='true'></span></button>
          <button
            type='button'
            class='pretui-carousel-arrow'
            data-direction='next'
            aria-label='Next slide'
            aria-disabled={{if this.atEnd 'true'}}
            data-test-pretui-carousel-next
            {{on 'click' this.next}}
          ><span class='pretui-carousel-chevron' aria-hidden='true'></span></button>
        </div>
      {{/unless}}

      {{#unless @hideDots}}
        <div class='pretui-carousel-dots' data-test-pretui-carousel-dots>
          {{#each this.dots key='index' as |dot|}}
            <button
              type='button'
              class='pretui-carousel-dot'
              aria-label={{dot.label}}
              aria-current={{dot.current}}
              data-test-pretui-carousel-dot={{dot.index}}
              {{on 'click' (fn this.goTo dot.index)}}
            ><span class='pretui-carousel-pip' aria-hidden='true'></span></button>
          {{/each}}
        </div>
      {{/unless}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-carousel {
          position: relative;
          display: grid;
          gap: var(--space-3, 8px);
          min-width: 0;
          container-type: inline-size;
          font-family: var(--font-sans);
          color: var(--foreground);
          /* Reaches the nested Scroller by INHERITANCE rather than by a class
             on a child component's root — custom properties cascade, so the
             knob crosses the component boundary without a selector that has
             to guess where the child's scope attribute landed. */
          --pretui-scroller-fade: 36px;
        }
        .pretui-carousel-track {
          position: relative;
          display: flex;
          gap: var(--pretui-carousel-gap, 12px);
          padding-block-end: 2px;
        }
        .pretui-carousel-slide {
          flex: 0 0 var(--pretui-carousel-slide, 100%);
          min-width: 0;
          scroll-snap-align: start;
          scroll-snap-stop: always;
        }
        .pretui-sr {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          margin: 0;
        }
        .pretui-carousel-controls {
          position: absolute;
          inset-block-start: calc(50% - 18px);
          inset-inline: var(--space-2, 6px);
          display: flex;
          justify-content: space-between;
          pointer-events: none;
        }
        .pretui-carousel-arrow {
          pointer-events: auto;
          inline-size: 36px;
          block-size: 36px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 999px;
          background: var(--card);
          color: var(--foreground);
          box-shadow: var(
            --pretui-shadow-control,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.3)
          );
          cursor: pointer;
        }
        @media (any-pointer: coarse) {
          .pretui-carousel-arrow {
            inline-size: 44px;
            block-size: 44px;
          }
        }
        .pretui-carousel-arrow[aria-disabled='true'] {
          opacity: 0.35;
          cursor: default;
        }
        .pretui-carousel-arrow:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        /* A CSS chevron rather than an svg: lint's require-presentational-
           children rejects any <svg> inside a button subtree. */
        .pretui-carousel-chevron {
          inline-size: 8px;
          block-size: 8px;
          border-inline-end: 2px solid currentColor;
          border-block-start: 2px solid currentColor;
        }
        .pretui-carousel-arrow[data-direction='next'] .pretui-carousel-chevron {
          transform: rotate(45deg) translate(-1px, 1px);
        }
        .pretui-carousel-arrow[data-direction='previous'] .pretui-carousel-chevron {
          transform: rotate(-135deg) translate(-1px, 1px);
        }
        .pretui-carousel-dots {
          display: flex;
          justify-content: center;
          gap: 2px;
        }
        .pretui-carousel-dot {
          border: 0;
          background: transparent;
          padding: 8px 4px;
          cursor: pointer;
          display: grid;
          place-items: center;
          min-inline-size: 20px;
          min-block-size: 20px;
        }
        @media (any-pointer: coarse) {
          .pretui-carousel-dot {
            min-inline-size: 44px;
            min-block-size: 44px;
          }
        }
        .pretui-carousel-dot:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
          border-radius: var(--radius-control, 7px);
        }
        .pretui-carousel-pip {
          inline-size: 6px;
          block-size: 6px;
          border-radius: 999px;
          background: color-mix(
            in oklch,
            var(--muted-foreground) 45%,
            transparent
          );
          /* Law 5: the pip GROWS into the current one, so the eye is told
             which way selection travelled. It lands on the end state under
             reduced motion. */
          transition: inline-size 180ms cubic-bezier(0.23, 1, 0.32, 1),
            background-color 180ms linear;
        }
        .pretui-carousel-dot[aria-current='true'] .pretui-carousel-pip {
          inline-size: 18px;
          border-radius: 999px;
          background: var(--pretui-carousel-pip, var(--primary));
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-carousel-pip {
            transition: none;
          }
        }
        @container (max-width: 26rem) {
          .pretui-carousel-controls {
            display: none;
          }
        }
      }
    </style>
  </template>
}
