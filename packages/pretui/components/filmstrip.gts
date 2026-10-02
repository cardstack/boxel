// Pretui — Filmstrip: a scrubbable strip of video frames with a keyboard cursor.
//
//   <Filmstrip @frames={{frames}} @duration={{6}} @current={{t}}
//              @label='Estate reel' @onScrub={{this.seek}} />
//
// No library. A filmstrip is thumbnails, a time axis and a keyboard contract,
// and none of those is worth 40 KB of somebody else's opinion.
//
// Three decisions worth stating:
//
//   1. **The strip is ONE tab stop, not N.** A row of twelve focusable
//      thumbnails is twelve presses of Tab to get past, which is why every
//      carousel that ships that way is unusable with a keyboard. The strip is
//      a single `role='slider'` over the time axis; arrows move frame to
//      frame, Home/End jump to the ends, PageUp/PageDown move by ten percent.
//      Clicking a frame still works — pointer and keyboard reach the same
//      state through the same setter.
//   2. **A frame's identity is its TIME, not its index.** `@frames` may be
//      irregular (chapter marks, scene cuts, whatever the host has), so
//      `frameAt(seconds)` finds the last frame at or before a time rather than
//      assuming a fixed interval. That is what makes the same component work
//      as a chapter rail and as an even-interval scrub preview.
//   3. **Every tile reserves its aspect ratio before it loads**, and a strip
//      with no frames says so instead of collapsing to a 0px line. The
//      Law-8 corollary, in the place a horizontal strip breaks it worst:
//      images landing one by one otherwise shuffle the whole row sideways
//      under the pointer.
//
// BETTER THAN THE INSPIRATION: the scrub strips in video tools are hover-only
// — no focus, no announced position, no way to reach a frame without a mouse
// — and the ones in image galleries are a row of tab stops. This is neither.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import { formatClock } from '../internal/reading-format';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import { EmptyState } from './empty-state';
import { Token } from './token';

// ── The frame model ──────────────────────────────────────────────────────

/** One thumbnail on the strip. */
export interface FilmstripFrame {
  /** Where this frame sits on the time axis, in seconds. */
  time: number;
  /** Thumbnail URL. */
  src: string;
  /** Optional caption — a chapter title, a shot number. */
  label?: string;
}

/** Evenly spaced frames from a generator — the common case, factored out so
 * every caller does not write the same loop. Deterministic: no `Date.now`,
 * no `Math.random`, the same frames on every reindex. */
export function evenFrames(
  duration: number,
  count: number,
  src: (time: number, index: number) => string,
  label?: (time: number, index: number) => string,
): FilmstripFrame[] {
  const n = Math.max(1, Math.round(count));
  const frames: FilmstripFrame[] = [];
  for (let i = 0; i < n; i++) {
    const time = (duration * i) / n;
    frames.push({
      time,
      src: src(time, i),
      label: label ? label(time, i) : undefined,
    });
  }
  return frames;
}

/** The index of the last frame at or before `seconds`. `-1` for an empty
 * strip, `0` for a time before the first frame. */
export function frameAt(frames: readonly FilmstripFrame[], seconds: number): number {
  if (frames.length === 0) {
    return -1;
  }
  let found = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].time <= seconds) {
      found = i;
    } else {
      break;
    }
  }
  return found;
}

/** What the strip renders, derived once. */
export interface StripCell {
  frame: FilmstripFrame;
  index: number;
  time: string;
  /** True for the frame the playhead is in. */
  active: boolean;
  /** `'true' | undefined`, ready to bind — a boolean attribute bound as
   * `false` or `''` sets a falsy PROPERTY and does nothing at all. */
  activeFlag: 'true' | undefined;
  alt: string;
}

// ── Filmstrip ────────────────────────────────────────────────────────────

/** Keeps the element so the active frame can be scrolled into view. Owned by
 * a modifier and released in its destructor, so nothing outlives the DOM. */
const stripElement = modifier((el: HTMLElement, [host]: [FilmstripHost]) => {
  host.setStrip(el);
  return () => host.setStrip(null);
});

interface FilmstripHost {
  setStrip: (el: HTMLElement | null) => void;
}

export interface FilmstripSignature {
  Args: {
    /** The thumbnails, in time order. */
    frames: readonly FilmstripFrame[];
    /** Length of the time axis in seconds. Defaults to the last frame's time. */
    duration?: number;
    /** Playhead position in seconds. Uncontrolled when omitted. */
    current?: number;
    /** Accessible name of the scrubber. */
    label: string;
    /** Tile width in px. Default 96. */
    thumbWidth?: number;
    /** Aspect ratio of a tile, e.g. `'16 / 9'`. Default `'16 / 9'`. */
    ratio?: string;
    /** Show the time under each tile. Default `true`. */
    showTimes?: boolean;
    /** Fires on every scrub, keyboard or pointer. */
    onScrub?: (seconds: number, frame: FilmstripFrame) => void;
  };
  Blocks: {
    /** Replaces the built-in empty state. */
    empty: [];
  };
  Element: HTMLDivElement;
}

export class Filmstrip extends Component<FilmstripSignature> implements FilmstripHost {
  @tracked innerCurrent = 0;
  strip: HTMLElement | null = null;

  setStrip = (el: HTMLElement | null): void => {
    this.strip = el;
  };

  get frames(): readonly FilmstripFrame[] {
    return this.args.frames ?? [];
  }
  get duration(): number {
    const raw = this.args.duration;
    if (typeof raw === 'number' && raw > 0) {
      return raw;
    }
    const last = this.frames[this.frames.length - 1];
    return last ? last.time : 0;
  }
  get current(): number {
    const raw = this.args.current;
    return typeof raw === 'number' ? raw : this.innerCurrent;
  }
  get activeIndex(): number {
    return frameAt(this.frames, this.current);
  }
  get cells(): StripCell[] {
    const active = this.activeIndex;
    return this.frames.map((frame, index) => ({
      frame,
      index,
      time: formatClock(frame.time),
      active: index === active,
      activeFlag: index === active ? 'true' : undefined,
      alt: frame.label ?? `Frame at ${formatClock(frame.time)}`,
    }));
  }
  get hasFrames(): boolean {
    return this.frames.length > 0;
  }
  get showTimes(): boolean {
    return this.args.showTimes ?? true;
  }
  get valueText(): string {
    const i = this.activeIndex;
    const cell = this.frames[i];
    const where = `${formatClock(this.current)} of ${formatClock(this.duration)}`;
    if (!cell) {
      return where;
    }
    const name = cell.label ? `${cell.label}, ` : '';
    return `${name}frame ${i + 1} of ${this.frames.length}, ${where}`;
  }
  get stripStyle() {
    return cssStyleFrom([
      cssDeclaration(
        '--pretui-strip-w',
        typeof this.args.thumbWidth === 'number' && this.args.thumbWidth > 0
          ? `${Math.round(this.args.thumbWidth)}px`
          : undefined,
      ),
      cssDeclaration('--pretui-strip-ratio', this.args.ratio),
    ]);
  }

  // ── movement ───────────────────────────────────────────────────────────

  goToIndex = (index: number): void => {
    const clamped = Math.min(this.frames.length - 1, Math.max(0, index));
    const frame = this.frames[clamped];
    if (!frame) {
      return;
    }
    if (this.args.current === undefined) {
      this.innerCurrent = frame.time;
    }
    this.args.onScrub?.(frame.time, frame);
    this.revealIndex(clamped);
  };

  /** Keep the active tile visible. `scrollIntoView` is not a timer and not a
   * frame loop — the browser owns the scroll — and reduced motion drops the
   * smoothing rather than the scrolling, which is the end state (Law 5). */
  revealIndex = (index: number): void => {
    const child = this.strip?.children?.[index] as HTMLElement | undefined;
    if (!child || typeof child.scrollIntoView !== 'function') {
      return;
    }
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    child.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  };

  pickIndex = (index: number) => {
    return () => this.goToIndex(index);
  };

  // `{{on}}` types its handler as `(event: Event) => void`; the narrow type
  // is asserted here rather than in the signature.
  handleKey = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (!this.hasFrames) {
      return;
    }
    const here = this.activeIndex;
    const page = Math.max(1, Math.round(this.frames.length / 10));
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = here + (event.shiftKey ? page : 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = here - (event.shiftKey ? page : 1);
        break;
      case 'PageUp':
        next = here + page;
        break;
      case 'PageDown':
        next = here - page;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = this.frames.length - 1;
        break;
      default:
        next = null;
    }
    if (next !== null) {
      event.preventDefault();
      this.goToIndex(next);
    }
  };

  <template>
    <div class='pretui-strip' data-test-pretui-filmstrip ...attributes>
      {{#if this.hasFrames}}
        <div class='pretui-strip-frame' style={{this.stripStyle}}>
          <div class='pretui-strip-rail' {{stripElement this}}>
            {{#each this.cells key='index' as |cell|}}
            {{! A real <button>, so a pointer press lands on something
                interactive — but `tabindex='-1'`, because twelve tab stops in
                a row is the failure this component exists to avoid. The tab
                stop is the scrubber below. }}
            <button
              type='button'
              class='pretui-strip-cell'
              tabindex='-1'
              data-active={{cell.activeFlag}}
              {{on 'click' (this.pickIndex cell.index)}}
            >
              <img
                class='pretui-strip-img'
                src={{cell.frame.src}}
                alt={{cell.alt}}
                loading='lazy'
                decoding='async'
              />
              {{#if this.showTimes}}
                <span class='pretui-strip-time'>
                  {{! State is never colour alone — the current frame is named,
                      not merely tinted. }}
                  {{#if cell.active}}<span class='pretui-strip-here'>▮</span>{{/if}}
                  {{cell.time}}
                </span>
              {{/if}}
            </button>
            {{/each}}
          </div>
          {{! An EMPTY overlay: `role='slider'` takes presentational children
              only, so the thumbnails cannot live inside it. Pointer-transparent,
              so a click still reaches the tile underneath. }}
          <div
            class='pretui-strip-scrub'
            role='slider'
            tabindex='0'
            aria-label={{@label}}
            aria-valuemin='0'
            aria-valuemax={{this.duration}}
            aria-valuenow={{this.current}}
            aria-valuetext={{this.valueText}}
            {{on 'keydown' this.handleKey}}
          ></div>
        </div>
        <p class='pretui-strip-readout'>
          <Token @value={{this.valueText}} />
        </p>
      {{else if (has-block 'empty')}}
        {{yield to='empty'}}
      {{else}}
        <EmptyState @title='No frames on this strip' @texture={{false}}>
          <:default>
            A filmstrip needs thumbnails and the times they sit at. Build them
            with
            <code>evenFrames(duration, count, src)</code>
            or hand it your own.
          </:default>
        </EmptyState>
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-strip {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .pretui-strip-rail {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 6px;
          border-radius: var(--radius);
          scroll-snap-type: x proximity;
          background: color-mix(
            in oklch,
            var(--foreground) 4%,
            var(--card)
          );
          box-shadow: var(
            --pretui-shadow-hairline,
            0 0 0 1px var(--border)
          );
        }
        .pretui-strip-frame {
          position: relative;
          min-width: 0;
        }
        .pretui-strip-scrub {
          position: absolute;
          inset: 0;
          border-radius: var(--radius);
          pointer-events: none;
        }
        .pretui-strip-scrub:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }
        .pretui-strip-cell {
          appearance: none;
          border: 0;
          padding: 0;
          background: none;
          font: inherit;
          text-align: start;
          color: inherit;
          flex: 0 0 auto;
          width: var(--pretui-strip-w, 96px);
          display: flex;
          flex-direction: column;
          gap: 3px;
          scroll-snap-align: center;
          cursor: pointer;
        }
        .pretui-strip-img {
          display: block;
          width: 100%;
          height: auto;
          /* Reserved BEFORE the thumbnail lands, so the row does not shuffle
             sideways under the pointer as images arrive. */
          aspect-ratio: var(--pretui-strip-ratio, 16 / 9);
          object-fit: cover;
          border-radius: calc(var(--radius) - 4px);
          background: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--card)
          );
          box-shadow: 0 0 0 1px var(--border);
        }
        .pretui-strip-cell[data-active='true'] .pretui-strip-img {
          box-shadow: 0 0 0 2px var(--primary);
        }
        .pretui-strip-time {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: var(--text-ui-xs, 10.5px);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        .pretui-strip-cell[data-active='true'] .pretui-strip-time {
          color: var(--foreground);
          font-weight: 600;
        }
        .pretui-strip-here {
          color: var(--pretui-primary-ink, var(--boxel-highlight-hover));
        }
        .pretui-strip-readout {
          margin: 0;
        }
        .dark .pretui-strip-rail {
          background: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--card)
          );
        }
        .dark .pretui-strip-cell[data-active='true'] .pretui-strip-time {
          color: var(--foreground);
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-strip-rail {
            scroll-behavior: auto;
          }
        }
      }
    </style>
  </template>
}
