// Pretui — VirtualTimeline: windowing for a long transcript inside StickToBottom.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import type { StickToBottomApi } from './stick-to-bottom';

// ── the shared height cache ──────────────────────────────────────────────
// Module-level, keyed by `@measurementKey + row id`, and capped: switching
// back to a session reuses its measurements, so the scrollbar is right on
// the first frame. A Map keeps insertion order, so re-setting an entry
// moves it to the end and the first entry is the least recently used.
const MAX_HEIGHTS = 5000;
const heights = new Map<string, number>();

function readHeight(key: string): number | undefined {
  let h = heights.get(key);
  if (h !== undefined) {
    heights.delete(key);
    heights.set(key, h);
  }
  return h;
}
function writeHeight(key: string, h: number) {
  heights.delete(key);
  heights.set(key, h);
  if (heights.size > MAX_HEIGHTS) {
    let oldest = heights.keys().next().value;
    if (oldest !== undefined) {
      heights.delete(oldest);
    }
  }
}
/** for tests: forget every measurement */
export function clearTimelineHeights() {
  heights.clear();
}

// Timer-free scheduling: one animation frame, or now when there is none
// (prerender, some test environments).
function nextFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame !== 'function') {
    fn();
    return () => undefined;
  }
  let id = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(id);
}

export interface TimelineRow {
  id: string;
}

type Item<T> =
  | { kind: 'spacer'; key: string; height: number }
  | { kind: 'row'; key: string; row: T; index: number };

export interface VirtualTimelineSignature<T extends TimelineRow> {
  Args: {
    rows: T[];
    /** StickToBottom's yielded api: the scroll container, and whether it
     * follows the end */
    scroll: StickToBottomApi;
    /** initial height guess in px, or per row. Default 96 */
    estimate?: number | ((row: T) => number);
    /** px rendered beyond each edge of the viewport. Default 800 */
    overscan?: number;
    /** row ids always rendered: the streaming turn, the focused row, a
     * reveal target */
    pin?: string[];
    /** the measured heights' cache key (the session id), so a remount
     * starts from what it measured last time */
    measurementKey?: string;
    /** the row count at which windowing turns on. Default 60 */
    virtualizeAbove?: number;
    /** false while older history is still unknown: the feed's set size is
     * then -1. Default true */
    complete?: boolean;
    /** the feed's accessible name. Default 'Conversation' */
    label?: string;
  };
  Blocks: {
    row: [row: T, index: number];
  };
  Element: HTMLDivElement;
}

/**
 * Renders only the rows near the viewport, measures them as they render,
 * and keys every row by its id, so loading history never remounts what
 * the reader is looking at. Below `@virtualizeAbove` it renders every row
 * and leans on `content-visibility: auto`.
 *
 * ```hbs
 * <StickToBottom as |scroll|>
 *   <VirtualTimeline @rows={{this.turns}} @scroll={{scroll}} @pin={{this.liveIds}}>
 *     <:row as |turn|><AgentTurn @turn={{turn}} /></:row>
 *   </VirtualTimeline>
 * </StickToBottom>
 * ```
 */
export class VirtualTimeline<T extends TimelineRow> extends Component<
  VirtualTimelineSignature<T>
> {
  /** the window's first and last rows, by id: an index would shift when
   * older history is prepended, and the rows in view would remount */
  @tracked private startId: string | undefined;
  @tracked private endId: string | undefined;
  /** bumped when a measurement changes, so offsets recompute */
  @tracked private measured = 0;
  /** a row pinned for keyboard focus until it has been focused */
  @tracked private focusPin: string | undefined;
  /** layout exists: windowing never runs without it (prerender) */
  @tracked private hasLayout = false;

  private root: HTMLElement | undefined;
  private observer: ResizeObserver | undefined;
  private cancelFrame: (() => void) | undefined;
  private coldMounted = false;

  get virtualizeAbove() {
    return this.args.virtualizeAbove ?? 60;
  }
  get overscan() {
    return this.args.overscan ?? 800;
  }
  get windowed(): boolean {
    return this.hasLayout && this.args.rows.length >= this.virtualizeAbove;
  }
  get mode(): 'plain' | 'windowed' {
    return this.windowed ? 'windowed' : 'plain';
  }
  get setSize(): number {
    return this.args.complete === false ? -1 : this.args.rows.length;
  }

  private keyOf(row: T): string {
    return `${this.args.measurementKey ?? ''}\u0000${row.id}`;
  }
  private estimateOf(row: T): number {
    let e = this.args.estimate;
    return typeof e === 'function' ? e(row) : (e ?? 96);
  }
  private heightOf(row: T): number {
    return readHeight(this.keyOf(row)) ?? this.estimateOf(row);
  }

  /** each row's top offset, and the total height, by measurement or estimate */
  get offsets(): { tops: number[]; total: number } {
    void this.measured;
    let tops: number[] = [];
    let y = 0;
    for (let row of this.args.rows) {
      tops.push(y);
      y += this.heightOf(row);
    }
    return { tops, total: y };
  }

  get pinned(): Set<string> {
    let ids = new Set(this.args.pin ?? []);
    if (this.focusPin) {
      ids.add(this.focusPin);
    }
    return ids;
  }

  /** the window as indexes [start, end), resolved from its ids */
  private get range(): [number, number] {
    let rows = this.args.rows;
    let start = this.startId ? rows.findIndex((r) => r.id === this.startId) : -1;
    let end = this.endId ? rows.findIndex((r) => r.id === this.endId) : -1;
    if (start < 0 || end < 0) {
      // not yet placed: the bottom of the list, as a cold mount shows it
      return [Math.max(0, rows.length - 12), rows.length];
    }
    return [start, end + 1];
  }

  get items(): Item<T>[] {
    let rows = this.args.rows;
    if (!this.windowed) {
      return rows.map((row, index) => ({ kind: 'row', key: row.id, row, index }));
    }
    let { tops, total } = this.offsets;
    let pinned = this.pinned;
    let items: Item<T>[] = [];
    let gapFrom = 0; // offset where the current unrendered run starts
    let gapRun = 0;
    let flush = (to: number) => {
      if (to > gapFrom) {
        items.push({ kind: 'spacer', key: `gap-${gapRun++}`, height: to - gapFrom });
      }
    };
    let [first, last] = this.range;
    rows.forEach((row, index) => {
      let inWindow = index >= first && index < last;
      if (inWindow || pinned.has(row.id)) {
        flush(tops[index]!);
        items.push({ kind: 'row', key: row.id, row, index });
        gapFrom = tops[index]! + this.heightOf(row);
      }
    });
    flush(total);
    return items;
  }

  spacerStyle = (height: number) => htmlSafe(`height: ${Math.max(0, height)}px`);
  isRow = (item: Item<T>) => item.kind === 'row';
  rowOf = (item: Item<T>) => (item as { row: T }).row;
  indexOf = (item: Item<T>) => (item as { index: number }).index;
  heightOfItem = (item: Item<T>) => (item as { height: number }).height;
  posOf = (item: Item<T>) => (item as { index: number }).index + 1;
  estimateStyle = (item: Item<T>) =>
    htmlSafe(
      `contain-intrinsic-size: auto ${this.estimateOf((item as { row: T }).row)}px`,
    );

  /** recompute the window from the scroll position */
  private updateWindow = () => {
    let el = this.args.scroll.scrollElement;
    let root = this.root;
    let rows = this.args.rows;
    if (!el || !root || !this.windowed) {
      return;
    }
    let { tops, total } = this.offsets;
    // where the timeline starts inside the scrolled content
    let rootTop =
      root.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    let viewTop = el.scrollTop - rootTop - this.overscan;
    let viewBottom = el.scrollTop - rootTop + el.clientHeight + this.overscan;
    if (!this.coldMounted) {
      // cold mount: the bottom rows that fill the viewport plus overscan
      this.coldMounted = true;
      viewBottom = total;
      viewTop = total - el.clientHeight - this.overscan;
    }
    let start = 0;
    while (start < rows.length - 1 && tops[start]! + this.heightOf(rows[start]!) < viewTop) {
      start++;
    }
    let end = start;
    while (end < rows.length && tops[end]! < viewBottom) {
      end++;
    }
    end = Math.max(end, start + 1);
    let startId = rows[start]?.id;
    let endId = rows[end - 1]?.id;
    if (startId !== this.startId || endId !== this.endId) {
      this.startId = startId;
      this.endId = endId;
    }
  };

  private schedule = () => {
    this.cancelFrame?.();
    this.cancelFrame = nextFrame(() => {
      this.cancelFrame = undefined;
      if (!this.isDestroying && !this.isDestroyed) {
        this.updateWindow();
      }
    });
  };

  // the root: finds the scroll container, observes rows, listens to scroll
  setupRoot = modifier((element: HTMLElement) => {
    this.root = element;
    let hasLayout =
      typeof ResizeObserver === 'function' &&
      typeof element.getBoundingClientRect === 'function';
    if (hasLayout) {
      this.observer = new ResizeObserver((entries) => {
        let changed = false;
        for (let entry of entries) {
          let target = entry.target as HTMLElement;
          let key = target.dataset['timelineKey'];
          let h = entry.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight;
          if (key && h > 0 && readHeight(key) !== h) {
            writeHeight(key, h);
            changed = true;
          }
        }
        if (changed) {
          this.measured++;
          this.schedule();
        }
      });
    }
    let el: HTMLElement | undefined;
    let cancelAttach = nextFrame(() => {
      this.hasLayout = hasLayout;
      el = this.args.scroll.scrollElement;
      el?.addEventListener('scroll', this.schedule, { passive: true });
      this.schedule();
    });
    return () => {
      cancelAttach();
      this.cancelFrame?.();
      el?.removeEventListener('scroll', this.schedule);
      this.observer?.disconnect();
      this.observer = undefined;
      this.root = undefined;
    };
  });

  // each rendered row reports its height to the shared observer
  measureRow = modifier((element: HTMLElement) => {
    this.observer?.observe(element);
    return () => this.observer?.unobserve(element);
  });

  // the rows changed: place the window again (a new turn at the end, or
  // older history at the start); the ids keep the rendered rows in place
  // meanwhile
  watchRows = modifier((_element: HTMLElement, [_count]: [number]) => {
    this.schedule();
  });

  timelineKey = (item: Item<T>) => this.keyOf((item as { row: T }).row);

  // PageDown / PageUp move focus between articles, pinning the target
  // first so a row outside the window is in the DOM to take it
  keydown = (e: Event) => {
    let event = e as KeyboardEvent;
    if (event.key !== 'PageDown' && event.key !== 'PageUp') {
      return;
    }
    let current = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-transcript-id]',
    );
    if (!current) {
      return;
    }
    let rows = this.args.rows;
    let index = rows.findIndex((r) => r.id === current!.dataset['transcriptId']);
    let next = rows[index + (event.key === 'PageDown' ? 1 : -1)];
    if (!next) {
      return;
    }
    event.preventDefault();
    this.focusPin = next.id;
    nextFrame(() => {
      let target = this.root?.querySelector<HTMLElement>(
        `[data-transcript-id="${CSS.escape(next!.id)}"]`,
      );
      target?.focus();
      target?.scrollIntoView({ block: 'nearest' });
    });
  };

  <template>
    {{! the APG Feed pattern moves focus between articles with PageUp and
        PageDown, handled on the feed itself }}
    {{! template-lint-disable no-invalid-interactive }}
    <div
      class='pretui-timeline'
      role='feed'
      aria-label={{if @label @label 'Conversation'}}
      data-mode={{this.mode}}
      data-test-pretui-virtual-timeline={{this.mode}}
      {{this.setupRoot}}
      {{this.watchRows @rows.length}}
      {{on 'keydown' this.keydown}}
      ...attributes
    >
      {{#each this.items key='key' as |item|}}
        {{#if (this.isRow item)}}
          <article
            class='pretui-timeline-row'
            tabindex='-1'
            aria-posinset={{this.posOf item}}
            aria-setsize={{this.setSize}}
            data-transcript-id={{item.key}}
            data-timeline-key={{this.timelineKey item}}
            style={{if this.windowed '' (this.estimateStyle item)}}
            data-test-pretui-timeline-row={{item.key}}
            {{this.measureRow}}
          >{{yield (this.rowOf item) (this.indexOf item) to='row'}}</article>
        {{else}}
          <div
            class='pretui-timeline-spacer'
            aria-hidden='true'
            style={{this.spacerStyle (this.heightOfItem item)}}
            data-test-pretui-timeline-spacer
          ></div>
        {{/if}}
      {{/each}}
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-timeline {
          display: flow-root;
        }
        /* a short transcript renders every row and lets the browser skip
           painting the ones offscreen */
        .pretui-timeline[data-mode='plain'] .pretui-timeline-row {
          content-visibility: auto;
        }
        .pretui-timeline-row {
          display: flow-root;
        }
        .pretui-timeline-row:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: 4px;
        }
        .pretui-timeline-spacer {
          display: block;
        }
      }
    </style>
  </template>
}
