// Pretui — DashboardGrid: a drag-and-resize dashboard grid driven by layout data.
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import type { SafeString } from '@ember/template';
import { DashboardItem } from './dashboard-item';
import { Grids, clampPlacement, describeMove, describePlaced, describeResize, intAt, mountDashboardPlane, nudge, resolveLayout, sameLayout, syncDashboardOptions } from '../internal/structure-dashboard';
import type { AdjustMode, DashboardGridHost, DashboardLayout, DashboardPlacement, GridItemElement, GridLike, SortDomInternal, WidgetOptions } from '../internal/structure-dashboard';

// ── DashboardGrid ────────────────────────────────────────────────────────

/** The extra seam the plane modifiers talk to, on top of the cell's. */

export interface DashboardGridSignature<T = unknown> {
  Args: {
    /**
     * The tiles. Their array order is presentation-neutral — position lives
     * in `@layout`, never on the item.
     */
    items: readonly T[];
    /**
     * The arrangement, keyed by id. Ids with no placement are auto-positioned
     * by the engine; placements with no item are ignored. Two overlapping
     * placements resolve the way the live engine resolves them — the LATER
     * one keeps the cell and the earlier is pushed down.
     *
     * CONTROLLED when `@onLayoutChange` is supplied: later changes to this
     * array are pushed back into the live grid. UNCONTROLLED without it: the
     * array seeds the grid once and the engine owns the arrangement from
     * there, so a drag is never snapped back to an authored cell nobody
     * updated. Same rule as `NodeCanvas`'s `@nodes`.
     */
    layout?: DashboardLayout;
    /** how an item's stable id is derived. Defaults to `item.id`, falling
     * back to the index. */
    idFor?: (item: T, index: number) => string;
    /** per-tile accessible label for the drag handle. Defaults to the item's
     * `title`, then `label`, then the id. */
    labelFor?: (item: T, index: number) => string;
    /** column count at full width. @default 12 */
    columns?: number;
    /** row height in px. @default 72 */
    cellHeight?: number;
    /** gutter in px. @default 8 */
    gap?: number;
    /** let tiles stay where they are put instead of packing upwards.
     * @default false */
    float?: boolean;
    /** animate the tiles a drag displaces. @default true — and always off
     * under `prefers-reduced-motion`, which lands on the end state. */
    animate?: boolean;
    /** false renders the same layout with no engine and no affordances.
     * @default true */
    editable?: boolean;
    /**
     * Accessible name for the grid region. @default 'Dashboard'
     *
     * A note on TAB ORDER while you are here: each tile contributes exactly
     * one tab stop (its handle), and they are visited in `@items` order, NOT
     * in visual order — see ownership rule 7. A stable, author-controlled tab
     * order is the deliberate trade for a surface whose visual order changes
     * under the user, and every move announces the tile's new column and row,
     * which is what actually orients a screen-reader user. Read-only mode has
     * no engine to fight, so there the cells ARE in visual order.
     */
    label?: string;
    /**
     * Responsive column steps, narrowest first: below a plane width of `w`,
     * use `c` columns. @default [{w:560,c:2},{w:900,c:6}], capped by
     * `@columns`. A responsive re-flow NEVER reaches `@onLayoutChange` — the
     * authored layout is the one that persists.
     */
    breakpoints?: readonly { w: number; c: number }[];
    /**
     * Fires with the serialized layout after a USER-driven change (a drag, a
     * resize, or a committed keyboard adjustment). Adding or removing an item
     * does not fire it — the caller did that and already knows. Where the
     * layout is stored is entirely yours.
     */
    onLayoutChange?: (layout: DashboardPlacement[]) => void;
  };
  Blocks: {
    /** the tile body — receives the item, its placement, and its index */
    item: [T, DashboardPlacement, number];
    /** the tile heading */
    title: [T, number];
    /** trailing controls in the tile bar */
    actions: [T, number];
  };
  Element: HTMLDivElement;
}

interface DashboardRow<T> {
  key: string;
  id: string;
  item: T;
  index: number;
  label: string;
  placement: DashboardPlacement;
  /** read-only mode only — the engine writes geometry in editable mode */
  staticStyle: SafeString | undefined;
  /** may a later change to the placement be pushed into the live engine? */
  live: boolean;
  /**
   * undefined when the caller supplied no placement for this id, which is
   * the signal to let the engine auto-position rather than be pushed to 0,0.
   */
  x: number | undefined;
  y: number | undefined;
  w: number | undefined;
  h: number | undefined;
}

const EMPTY_ITEMS: readonly unknown[] = [];
const DEFAULT_BREAKPOINTS: readonly { w: number; c: number }[] = [
  { w: 560, c: 2 },
  { w: 900, c: 6 },
];
const ZERO_WIDTH = '\u200B';

// Deterministic per page load — `Math.random()` and `Date.now()` are
// forbidden in a realm (they break indexing determinism), and a counter is
// enough because the id only has to be unique within one document.
let dashboardSeq = 0;

export class DashboardGrid<T = unknown>
  extends Component<DashboardGridSignature<T>>
  implements DashboardGridHost
{
  // ── engine state (deliberately NOT tracked) ────────────────────────────
  // None of this is read from a template. Making it tracked would let an
  // engine callback invalidate a render that already consumed it.
  private grid: GridLike | null = null;
  private planeEl: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private resizeFrame = 0;
  private pending: { id: string; el: HTMLElement }[] = [];
  private elements = new Map<string, HTMLElement>();
  private seeds = new Map<string, WidgetOptions>();
  private applying = false;
  private interacting = false;
  private liveColumns = 0;
  private lastEmitted: DashboardPlacement[] = [];
  private snapshot: DashboardPlacement[] | null = null;
  private messageParity = false;

  // ── announced state (tracked — the live region and handle read it) ─────
  @tracked private activeId: string | null = null;
  @tracked private mode: AdjustMode | null = null;
  @tracked private message = '';

  readonly hintId = `pretui-dashboard-hint-${(dashboardSeq += 1)}`;

  get editable(): boolean {
    return this.args.editable !== false;
  }

  private get columns(): number {
    return Math.max(1, Math.round(this.args.columns ?? 12));
  }

  private get cellHeight(): number {
    return Math.max(8, Math.round(this.args.cellHeight ?? 72));
  }

  private get gap(): number {
    return Math.max(0, Math.round(this.args.gap ?? 8));
  }

  private get float(): boolean {
    return this.args.float === true;
  }

  /**
   * CONTROLLED vs UNCONTROLLED, following `NodeCanvas`'s precedent in this
   * kit — and the reason is worth writing down, because getting it wrong is
   * how a dashboard silently snaps a user's drag back.
   *
   * `@layout` ALWAYS seeds the grid. It is only pushed back INTO a live
   * engine when `@onLayoutChange` is supplied, because only then can the
   * caller have kept up: a grid that pushed `@layout` unconditionally would
   * yank every tile back to its authored cell the moment anything else
   * re-rendered, since an uncontrolled caller's `@layout` never changes.
   */
  private get controlled(): boolean {
    return typeof this.args.onLayoutChange === 'function';
  }

  private get animate(): boolean {
    return this.args.animate !== false;
  }

  private get breakpoints(): readonly { w: number; c: number }[] {
    return this.args.breakpoints ?? DEFAULT_BREAKPOINTS;
  }

  private get items(): readonly T[] {
    return this.args.items ?? (EMPTY_ITEMS as readonly T[]);
  }

  private idFor = (item: T, index: number): string => {
    if (this.args.idFor) {
      return this.args.idFor(item, index);
    }
    const bag = item as unknown as { id?: unknown };
    return bag && bag.id != null ? String(bag.id) : `item-${index}`;
  };

  private labelFor = (item: T, index: number): string => {
    if (this.args.labelFor) {
      return this.args.labelFor(item, index);
    }
    const bag = item as unknown as { title?: unknown; label?: unknown };
    if (bag && typeof bag.title === 'string') {
      return bag.title;
    }
    if (bag && typeof bag.label === 'string') {
      return bag.label;
    }
    return this.idFor(item, index);
  };

  /**
   * The rendered rows.
   *
   * In EDITABLE mode the clamped authored placement is passed through and the
   * live engine resolves it; an unauthored tile gets `undefined` coordinates,
   * which is the auto-position signal. In READ-ONLY mode there is no engine,
   * so the placements go through `resolveLayout` — gridstack's own DOM-free
   * engine — and a stored layout with overlaps or holes therefore reads
   * identically in both modes.
   *
   * `@cached` is not an optimisation here, it is correctness: without it this
   * getter recomputes on every announcement, minting new row objects, which
   * invalidates every `{{#each}}` item reference and therefore every cell
   * modifier's arguments.
   */
  @cached
  private get rows(): DashboardRow<T>[] {
    const cols = this.columns;
    const editable = this.editable;
    const push = editable && this.controlled;
    const stored = new Map<string, DashboardPlacement>();
    for (const placement of this.args.layout ?? []) {
      stored.set(placement.id, placement);
    }

    const ids = this.items.map((item, index) => this.idFor(item, index));
    const clamped: DashboardPlacement[] = ids.map((id, index) => {
      const found = stored.get(id);
      return found
        ? clampPlacement(found, cols)
        : clampPlacement(
            { id, x: 0, y: index * 2, w: Math.min(cols, 3), h: 2 },
            cols,
          );
    });
    const placements = editable
      ? clamped
      : resolveLayout(clamped, cols, this.float);

    const rows: DashboardRow<T>[] = [];
    this.items.forEach((item, index) => {
      const id = ids[index] as string;
      const placement = placements[index] as DashboardPlacement;
      const authored = stored.has(id);
      rows.push({
        key: id,
        id,
        item,
        index,
        label: this.labelFor(item, index),
        placement,
        staticStyle: editable ? undefined : this.cellStyle(placement),
        live: push,
        x: authored ? placement.x : undefined,
        y: authored ? placement.y : undefined,
        w: authored ? placement.w : undefined,
        h: authored ? placement.h : undefined,
      });
    });
    // Read-only mode has no engine to fight, so reading order is sorted into
    // visual order here, where Glimmer owns the move. Editable mode keeps the
    // caller's order — see the `_sortDom` note in `mount`.
    if (!editable) {
      rows.sort(
        (a, b) => a.placement.y - b.placement.y || a.placement.x - b.placement.x,
      );
    }
    return rows;
  }

  /**
   * Read-only placement, as CSS grid lines. Every value is an integer this
   * method computed from a clamped placement — no caller string is ever
   * interpolated into a style attribute.
   */
  private cellStyle(placement: DashboardPlacement): SafeString {
    const colStart = Math.max(1, placement.x + 1);
    const rowStart = Math.max(1, placement.y + 1);
    const colSpan = Math.max(1, placement.w);
    const rowSpan = Math.max(1, placement.h);
    return htmlSafe(
      `grid-column:${colStart}/span ${colSpan};grid-row:${rowStart}/span ${rowSpan}`,
    );
  }

  /** Read-only plane metrics. Same numeric-only discipline. */
  private get staticPlaneStyle(): SafeString {
    return htmlSafe(
      `--pretui-dashboard-columns:${this.columns};--pretui-dashboard-cell:${this.cellHeight}px;--pretui-dashboard-gap:${this.gap}px`,
    );
  }

  private get planeLabel(): string {
    return this.args.label ?? 'Dashboard';
  }

  // ── DashboardHost ──────────────────────────────────────────────────────

  isAdjusting = (id: string): boolean => this.activeId === id;

  adjustMode = (id: string): AdjustMode | null =>
    this.activeId === id ? this.mode : null;

  attachItem = (id: string, el: HTMLElement, seed: WidgetOptions): void => {
    this.elements.set(id, el);
    this.seeds.set(id, seed);
    if (!this.grid) {
      this.pending.push({ id, el });
      return;
    }
    this.applying = true;
    try {
      this.grid.makeWidget(el, seed);
    } finally {
      this.applying = false;
    }
  };

  detachItem = (id: string, el: HTMLElement): void => {
    this.elements.delete(id);
    this.seeds.delete(id);
    this.pending = this.pending.filter((entry) => entry.el !== el);
    if (!this.grid) {
      return;
    }
    this.applying = true;
    try {
      // `false, false` — Glimmer removes the DOM, and a teardown is not a
      // user edit, so nothing should be announced or emitted for it.
      this.grid.removeWidget(el, false, false);
    } finally {
      this.applying = false;
    }
  };

  syncItem = (
    el: HTMLElement,
    x: number | undefined,
    y: number | undefined,
    w: number | undefined,
    h: number | undefined,
  ): void => {
    if (!this.grid || this.applying || this.interacting || this.activeId) {
      return;
    }
    if (
      x === undefined ||
      y === undefined ||
      w === undefined ||
      h === undefined
    ) {
      return;
    }
    const node = (el as GridItemElement).gridstackNode;
    if (!node) {
      return;
    }
    if (node.x === x && node.y === y && node.w === w && node.h === h) {
      return;
    }
    this.applying = true;
    try {
      this.grid.update(el, { x, y, w, h });
    } finally {
      this.applying = false;
    }
  };

  // ── DashboardGridHost — engine lifecycle ───────────────────────────────

  mount = (element: HTMLElement): void => {
    this.planeEl = element;
    this.liveColumns = this.columnsForWidth(element.clientWidth);
    const grid = Grids.init(
      {
        column: this.liveColumns,
        cellHeight: this.cellHeight,
        margin: this.gap,
        float: this.float,
        animate: this.animate,
        minRow: 1,
        // Ownership rule 2 — gridstack must never adopt item elements on its
        // own initiative; every registration goes through the cell modifier.
        auto: false,
        // Nothing enters or leaves this grid except through Glimmer.
        acceptWidgets: false,
        removable: false,
        // Drag from the handle only, so tile content stays interactive.
        handle: '.pretui-dashboard-handle',
        resizable: { handles: 'se' },
        // Never let gridstack toggle its own autohide class — visibility is
        // ours, so it can answer to :focus-within as well as :hover.
        alwaysShowResizeHandle: true,
        draggable: { scroll: false },
      },
      element,
    );
    this.grid = grid;

    // ── ownership rule 7, and the one that had to be measured ───────────
    // `_triggerChangeEvent` ends with `_sortDom()`, which re-`appendChild`s
    // every item so DOM order matches visual order. That is a reasonable
    // thing for a standalone library to do — it makes Tab order follow the
    // layout — and it is exactly the trespass this component cannot allow:
    //
    //   • it MOVES nodes `{{#each}}` believes it owns and has bounds for;
    //   • moving an element blurs anything focused inside it, so the very
    //     first arrow key of a keyboard move threw focus to <body> and the
    //     mode collapsed. That is how this was found — the render proof
    //     failed and the blur's stack trace named `_sortDom`.
    //
    // gridstack exposes no option for it, so it is neutralised per instance.
    // The cost is stated plainly in the docs: Tab order follows the `@items`
    // array, not the visual arrangement. A stable, author-controlled tab
    // order is a defensible trade for a surface whose whole point is that its
    // visual order changes under the user — and the position of every tile is
    // announced, which is what a screen-reader user actually needs. Read-only
    // mode has no engine, so there it IS sorted into visual order, in
    // Glimmer, where sorting is safe.
    (grid as unknown as SortDomInternal)._sortDom = () => grid;

    const pending = this.pending;
    this.pending = [];
    this.applying = true;
    try {
      for (const entry of pending) {
        grid.makeWidget(entry.el, this.seeds.get(entry.id) ?? { id: entry.id });
      }
    } finally {
      this.applying = false;
    }
    this.lastEmitted = this.serialize();

    grid.on('dragstart', this.onInteractionStart);
    grid.on('resizestart', this.onInteractionStart);
    grid.on('dragstop', this.onInteractionEnd);
    grid.on('resizestop', this.onInteractionEnd);
    grid.on('change', this.onEngineChange);

    // Responsive columns are ours, not gridstack's: its `columnOpts` would
    // make it install its own ResizeObserver AND a throttling setTimeout that
    // can outlive `destroy()`. This one is owned and disconnected below.
    if (typeof ResizeObserver !== 'undefined') {
      // `grid.column()` relays every widget synchronously; doing that inside
      // the observation cycle resizes the observed plane and trips
      // "ResizeObserver loop completed with undelivered notifications" — so
      // the column change is deferred one frame.
      this.observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) {
          return;
        }
        const width = entry.contentRect.width;
        if (this.resizeFrame) {
          cancelAnimationFrame(this.resizeFrame);
        }
        // One-shot paint-cycle deferral, not a loop: only rAF escapes the
        // ResizeObserver delivery step; a runloop hop would re-trip it.
        // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- paint callback
        this.resizeFrame = requestAnimationFrame(() => {
          this.resizeFrame = 0;
          this.onPlaneResize(width);
        });
      });
      this.observer.observe(element);
    }
  };

  unmount = (): void => {
    this.observer?.disconnect();
    this.observer = null;
    if (this.resizeFrame) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = 0;
    }
    const grid = this.grid;
    this.grid = null;
    this.planeEl = null;
    this.pending = [];
    this.elements.clear();
    this.seeds.clear();
    this.activeId = null;
    this.mode = null;
    this.snapshot = null;
    if (grid) {
      grid.offAll();
      // `false` is load-bearing: destroy(true) removes the container from the
      // document, and that container is Glimmer's element.
      grid.destroy(false);
    }
  };

  applyOptions = (
    cellHeight: number,
    gap: number,
    float: boolean,
    animate: boolean,
  ): void => {
    const grid = this.grid;
    if (!grid) {
      return;
    }
    this.applying = true;
    try {
      grid.cellHeight(cellHeight);
      grid.margin(gap);
      grid.float(float);
      grid.setAnimation(animate);
      const wanted = this.columnsForWidth(this.planeEl?.clientWidth ?? 0);
      if (wanted !== this.liveColumns) {
        this.liveColumns = wanted;
        grid.column(wanted, 'moveScale');
      }
    } finally {
      this.applying = false;
    }
  };

  private columnsForWidth(width: number): number {
    const max = this.columns;
    if (!width) {
      return max;
    }
    let chosen = max;
    for (const step of this.breakpoints) {
      if (width < step.w) {
        chosen = Math.min(chosen, Math.max(1, Math.round(step.c)));
      }
    }
    return Math.min(max, chosen);
  }

  private onPlaneResize = (width: number): void => {
    const grid = this.grid;
    if (!grid) {
      return;
    }
    const wanted = this.columnsForWidth(width);
    if (wanted === this.liveColumns) {
      return;
    }
    this.liveColumns = wanted;
    this.applying = true;
    try {
      grid.column(wanted, 'moveScale');
    } finally {
      this.applying = false;
    }
  };

  // ── engine events ──────────────────────────────────────────────────────

  private onInteractionStart = (): void => {
    this.interacting = true;
  };

  private onInteractionEnd = (): void => {
    this.interacting = false;
    this.emitIfChanged();
  };

  private onEngineChange = (): void => {
    if (this.applying || this.interacting) {
      return;
    }
    this.emitIfChanged();
  };

  private serialize(): DashboardPlacement[] {
    const grid = this.grid;
    if (!grid) {
      return [];
    }
    return grid
      .save(false)
      .filter((node) => node.id != null)
      .map((node) => ({
        id: String(node.id),
        x: intAt(node.x, 0),
        y: intAt(node.y, 0),
        w: Math.max(1, intAt(node.w, 1)),
        h: Math.max(1, intAt(node.h, 1)),
      }));
  }

  private emitIfChanged(): void {
    const grid = this.grid;
    if (!grid) {
      return;
    }
    // A responsive re-flow is a VIEW of the layout, not an edit of it —
    // persisting the two-column form would destroy the authored twelve.
    if (grid.getColumn() !== this.columns) {
      return;
    }
    const next = this.serialize();
    if (sameLayout(this.lastEmitted, next)) {
      return;
    }
    this.lastEmitted = next;
    this.args.onLayoutChange?.(next);
  }

  // ── keyboard adjust mode ───────────────────────────────────────────────
  //
  // The mandatory non-pointer path. Focus a tile's handle, press Enter or
  // Space to enter adjust mode, then: arrows move, shift+arrows resize, `m`
  // and `r` switch mode explicitly, Enter commits, Escape restores the layout
  // as it was when the mode opened, and moving focus away commits.
  //
  // Every outcome is read back from the ENGINE rather than from what was
  // asked for, because the engine gets the last word — it may clamp the
  // request or push a neighbour, and announcing the request instead of the
  // result is exactly how keyboard drag implementations end up lying.

  onItemKeydown = (id: string, label: string, event: KeyboardEvent): void => {
    if (!this.editable || !this.grid) {
      return;
    }
    const key = event.key;

    if (this.activeId !== id) {
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        this.beginAdjust(id, label);
      }
      return;
    }

    if (key === 'Escape') {
      event.preventDefault();
      this.cancelAdjust(label);
      return;
    }
    if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      this.commitAdjust(id, label);
      return;
    }
    if (key === 'r' || key === 'R') {
      event.preventDefault();
      this.mode = 'resize';
      this.announce(`Resize mode. Arrow keys change the size of ${label}.`);
      return;
    }
    if (key === 'm' || key === 'M') {
      event.preventDefault();
      this.mode = 'move';
      this.announce(`Move mode. Arrow keys move ${label}.`);
      return;
    }
    if (
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight' &&
      key !== 'ArrowUp' &&
      key !== 'ArrowDown'
    ) {
      return;
    }

    event.preventDefault();
    const mode: AdjustMode = event.shiftKey ? 'resize' : (this.mode ?? 'move');
    this.mode = mode;
    const current = this.placementOf(id);
    if (!current) {
      return;
    }
    this.push(id, nudge(current, key, mode, this.columns));
    const settled = this.placementOf(id) ?? current;
    this.announce(
      mode === 'move'
        ? describeMove(label, settled)
        : describeResize(label, settled),
    );
  };

  onItemBlur = (id: string): void => {
    if (this.activeId !== id) {
      return;
    }
    // Leaving the handle commits — an adjust mode left silently open after
    // focus has moved on is worse than one that lands where it was.
    this.activeId = null;
    this.mode = null;
    this.snapshot = null;
    this.emitIfChanged();
  };

  private beginAdjust(id: string, label: string): void {
    this.snapshot = this.serialize();
    this.activeId = id;
    this.mode = 'move';
    this.announce(
      `Adjust mode on ${label}. Arrow keys move, shift and arrow keys resize, Enter to confirm, Escape to cancel.`,
    );
  }

  private commitAdjust(id: string, label: string): void {
    const settled = this.placementOf(id);
    this.activeId = null;
    this.mode = null;
    this.snapshot = null;
    this.emitIfChanged();
    if (settled) {
      this.announce(describePlaced(label, settled));
    }
  }

  private cancelAdjust(label: string): void {
    const snapshot = this.snapshot;
    const grid = this.grid;
    this.activeId = null;
    this.mode = null;
    this.snapshot = null;
    if (grid && snapshot) {
      this.applying = true;
      try {
        grid.batchUpdate(true);
        for (const placement of snapshot) {
          const el = this.elements.get(placement.id);
          if (el) {
            grid.update(el, {
              x: placement.x,
              y: placement.y,
              w: placement.w,
              h: placement.h,
            });
          }
        }
        grid.batchUpdate(false);
      } finally {
        this.applying = false;
      }
      this.lastEmitted = this.serialize();
    }
    this.announce(`Adjustment cancelled. ${label} returned to where it was.`);
  }

  private placementOf(id: string): DashboardPlacement | null {
    const el = this.elements.get(id) as GridItemElement | undefined;
    const node = el?.gridstackNode;
    if (!node) {
      return null;
    }
    return {
      id,
      x: intAt(node.x, 0),
      y: intAt(node.y, 0),
      w: Math.max(1, intAt(node.w, 1)),
      h: Math.max(1, intAt(node.h, 1)),
    };
  }

  private push(id: string, placement: DashboardPlacement): void {
    const grid = this.grid;
    const el = this.elements.get(id);
    if (!grid || !el) {
      return;
    }
    this.applying = true;
    try {
      grid.update(el, {
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
      });
    } finally {
      this.applying = false;
    }
  }

  /**
   * A live region only re-reads text that CHANGED, so two identical outcomes
   * in a row — arrowing into the same wall twice — would be silent.
   * Alternating an invisible zero-width space keeps every result audible
   * without adding a word to what is read.
   */
  private announce(text: string): void {
    this.messageParity = !this.messageParity;
    this.message = this.messageParity ? text : text + ZERO_WIDTH;
  }

  <template>
    <div class='pretui-dashboard' data-test-pretui-dashboard ...attributes>
      {{#if this.editable}}
        <p id={{this.hintId}} class='pretui-dashboard-hint'>
          Press Enter on a tile's move button to adjust it. Arrow keys move it,
          shift with arrow keys resizes it, Enter confirms, Escape cancels.
        </p>

        <div
          class='grid-stack pretui-dashboard-plane'
          role='group'
          aria-label={{this.planeLabel}}
          data-test-pretui-dashboard-plane
          {{mountDashboardPlane this}}
          {{syncDashboardOptions
            this
            this.cellHeight
            this.gap
            this.float
            this.animate
          }}
        >
          {{#each this.rows key='key' as |row|}}
            <DashboardItem
              @host={{this}}
              @id={{row.id}}
              @label={{row.label}}
              @live={{row.live}}
              @x={{row.x}}
              @y={{row.y}}
              @w={{row.w}}
              @h={{row.h}}
            >
              <:title>{{yield row.item row.index to='title'}}</:title>
              <:actions>{{yield row.item row.index to='actions'}}</:actions>
              <:default>{{yield
                  row.item
                  row.placement
                  row.index
                  to='item'
                }}</:default>
            </DashboardItem>
          {{/each}}
        </div>
      {{else}}
        <div
          class='pretui-dashboard-plane-static'
          role='group'
          aria-label={{this.planeLabel}}
          style={{this.staticPlaneStyle}}
          data-test-pretui-dashboard-plane
        >
          {{#each this.rows key='key' as |row|}}
            <DashboardItem
              @id={{row.id}}
              @label={{row.label}}
              @staticStyle={{row.staticStyle}}
            >
              <:title>{{yield row.item row.index to='title'}}</:title>
              <:actions>{{yield row.item row.index to='actions'}}</:actions>
              <:default>{{yield
                  row.item
                  row.placement
                  row.index
                  to='item'
                }}</:default>
            </DashboardItem>
          {{/each}}
        </div>
      {{/if}}

      <p
        class='pretui-dashboard-live'
        role='status'
        aria-live='polite'
        data-test-pretui-dashboard-live
      >{{this.message}}</p>
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-dashboard {
          --pretui-dashboard-radius: var(--radius);
          position: relative;
          width: 100%;
          min-width: 0;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
        }

        /* Read-only mode: no engine, no listeners, no injected stylesheet —
           one CSS grid, positioned from the same resolved coordinates the live
           engine would have produced. */
        .pretui-dashboard-plane-static {
          display: grid;
          grid-template-columns: repeat(
            var(--pretui-dashboard-columns, 12),
            minmax(0, 1fr)
          );
          grid-auto-rows: var(--pretui-dashboard-cell, 72px);
          gap: var(--pretui-dashboard-gap, 8px);
          min-width: 0;
        }

        /* The keyboard instructions are the handle's aria-describedby target,
           so assistive tech reads them whether or not they are on screen.
           Sighted keyboard users get them revealed the moment focus lands
           anywhere in the grid; at rest a dashboard stays uncluttered. */
        .pretui-dashboard-hint,
        .pretui-dashboard-live {
          position: absolute;
          margin: 0;
          width: 1px;
          height: 1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
        }
        .pretui-dashboard:focus-within .pretui-dashboard-hint {
          position: static;
          width: auto;
          height: auto;
          clip-path: none;
          white-space: normal;
          margin: 0 0 var(--space-2, 5px);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
      }
    </style>
  </template>
}
