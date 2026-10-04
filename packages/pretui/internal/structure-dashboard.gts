// Pretui — structure/dashboard: `DashboardGrid`, a grid whose arrangement
// the END USER owns, and `DashboardItem`, its cell.
//
// ENGINE: gridstack.js (MIT, zero runtime dependencies), vendored at
// ./gridstack/index.js — built from the local checkout at commit d9c9bc41
// (v13.1.2-18-gd9c9bc41), which carries a resize-handle listener-leak fix the
// published 13.1.2 does not. gridstack/README.md records the full provenance,
// the build command, and what is deliberately not wired.
//
// ════════════════════════════════════════════════════════════════════════
// THE DOM OWNERSHIP BOUNDARY — read this before changing anything here
// ════════════════════════════════════════════════════════════════════════
//
// gridstack is a DOM library: left to itself it CREATES grid items from
// markup strings (`addWidget`), MOVES them between grids, and REMOVES them
// (`removeWidget`). Glimmer believes it owns exactly those nodes. Two
// systems mutating the same nodes is the failure mode that makes this class
// of integration flaky, so the boundary is drawn explicitly and narrowly:
//
//   GLIMMER OWNS      element existence and identity: it creates every
//                     `.grid-stack-item`, it destroys them, and `{{#each}}`
//                     keyed by the caller's id decides which is which.
//                     Glimmer also owns every class, all content, and every
//                     listener bound with `{{on}}`.
//
//   GRIDSTACK OWNS    geometry, and only geometry: the inline `top`/`left`/
//                     `width`/`height`, the `--gs-*` custom properties and
//                     the `gs-x`/`gs-y`/`gs-w`/`gs-h` attributes it writes
//                     onto those elements, plus two nodes of its own that
//                     Glimmer never sees — the drag placeholder and the
//                     resize handle, both children of elements we hand it.
//
// Seven rules keep that boundary intact. Breaking any one of them is how this
// component would start dropping tiles:
//
//  1. `addWidget()` IS NEVER CALLED. It would inject markup Glimmer thinks
//     it owns. Items are registered with `makeWidget(existingElement, …)`.
//  2. `init` passes `auto: false`, so gridstack never adopts the item
//     elements on its own initiative — every registration goes through the
//     cell's own modifier, in one direction, once.
//  3. `removeWidget(el, false, false)` — the `false`s are load-bearing:
//     do not remove the DOM (Glimmer will) and do not fire events (nobody
//     asked for a layout change). Likewise `destroy(false)` on teardown; a
//     `destroy(true)` would rip Glimmer's container out of the document.
//  4. Geometry flows ONE WAY AT A TIME. `applying` is raised whenever we
//     push a placement INTO the engine, and every event handler bails while
//     it is up; without it the engine's `change` event would call back into
//     `@onLayoutChange` during a render pass and trip Ember's backtracking
//     assertion.
//  5. The `style` attribute of an item is bound ONLY in read-only mode. In
//     editable mode it is left permanently unset, so Glimmer's attribute
//     cache never writes it and can never clobber the inline geometry
//     gridstack keeps there. Never add a `style=` binding to an editable
//     cell, and never splat caller attributes that could carry one.
//  6. Glimmer may reorder the `{{#each}}` freely — items are absolutely
//     positioned, so DOM order carries no meaning, and a keyed move is an
//     `insertBefore` within the same parent, which leaves `gridstackNode`
//     intact. What Glimmer must NEVER do is reparent an item out of the
//     plane while the engine is live, which is why `DashboardGrid` renders
//     the cells itself instead of yielding one for the caller to place
//     wherever they like.
//  7. `_sortDom()` IS NEUTRALISED, per instance, in `mount`. It is the one
//     place gridstack genuinely trespasses: after every change it
//     re-`appendChild`s each item so DOM order matches visual order. There is
//     no option for it, it moves nodes `{{#each}}` has bounds for, and moving
//     a node blurs anything focused inside it — the first arrow key of a
//     keyboard move threw focus to <body> and collapsed the mode. The full
//     reasoning, and what it costs, is at the call site.
//
// An eighth rule is about DATA rather than DOM, and it is the one that bit
// during the render proof: `@layout` is only pushed back into a LIVE engine
// when `@onLayoutChange` is supplied (see `controlled` below), and never
// while a drag or a keyboard adjustment is in flight. Without both guards a
// re-render for any unrelated reason re-asserts the authored coordinates and
// snaps the user's tile back — which is exactly what happened, twice, before
// the guards existed.
//
// The engine instance is created in `mountDashboardPlane` (an
// `ember-modifier`) and `destroy(false)`d in that modifier's destructor,
// along with the ResizeObserver and every listener. That ownership is what
// makes the engine's internal drag timers legal in a realm: a timer is
// allowed when the element that owns it clears it.
//
// ── READ-ONLY MODE ──────────────────────────────────────────────────────
// A dashboard is edited rarely and read constantly, so `@editable={{false}}`
// never constructs a GridStack at all: no engine, no listeners, no observer,
// no injected stylesheet, no drag affordances. It renders the SAME layout as
// a plain CSS grid. The two modes cannot drift because both resolve their
// coordinates through the same code — `resolveLayout()` runs gridstack's own
// `GridStackEngine`, which is entirely DOM-free.
//
// ── BETTER THAN THE INSPIRATION ─────────────────────────────────────────
// gridstack's own demos are the inspiration, and four things they get wrong:
//   • No keyboard path whatsoever. Drag and resize are pointer-only; a
//     keyboard user cannot rearrange a gridstack dashboard at all. Pretui
//     puts move AND resize on the tile's handle button (arrows / shift+
//     arrows) with an announced mode and a live region — see `onItemKeydown`.
//   • The stylesheet hard-codes its palette (a grey `rgba(0,0,0,.1)`
//     placeholder, a grey inline-SVG arrow handle) with no variable in
//     front of it, and reaches for `!important` in ~30 places. Pretui
//     restates only the structural rules, in tokens, with zero `!important`.
//   • Layout is stored ON the widget objects, so a caller's data and its
//     positions are one mutable blob. Pretui follows `Board`'s precedent:
//     placements are a separate `{id,x,y,w,h}[]` keyed by id, and the items
//     never carry coordinates.
//   • `alwaysShowResizeHandle` is either always or hover — never focus. The
//     affordance here appears on `:hover` AND `:focus-within`, and is
//     permanent on coarse pointers, where hover does not exist.
//
// Pretui — the dashboard engine: layout as data, the host seam, stylesheet delivery and the GridStack modifiers.
import { modifier } from 'ember-modifier';
import { DASHBOARD_ENGINE_CSS } from '../structure-dashboard-css';
import { GridStack, GridStackEngine } from '../gridstack/index.js';

// ── the bundle's shapes, re-declared locally ─────────────────────────────
// The realm bundle carries no .d.ts glint can see. These mirror exactly the
// parts of gridstack's public API this module touches, so the rest of the
// file is honestly typed instead of leaking `any` through every call site.

interface EngineNode {
  id?: string | number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export type WidgetOptions = EngineNode & { autoPosition?: boolean };

export interface GridItemElement extends HTMLElement {
  gridstackNode?: EngineNode;
}

interface EngineLike {
  nodes: EngineNode[];
  addNode(node: EngineNode): EngineNode;
}

export interface GridLike {
  makeWidget(el: HTMLElement, options?: WidgetOptions): void;
  removeWidget(el: HTMLElement, removeDOM: boolean, triggerEvent: boolean): void;
  update(el: HTMLElement, opts: EngineNode): void;
  save(saveContent: boolean): EngineNode[];
  batchUpdate(flag: boolean): void;
  column(column: number, layout: string): void;
  cellHeight(val: number): void;
  margin(val: number): void;
  float(val: boolean): void;
  setAnimation(enabled: boolean): void;
  getColumn(): number;
  on(name: string, cb: (...args: unknown[]) => void): void;
  offAll(): void;
  destroy(removeDOM: boolean): void;
}

/**
 * gridstack's one genuine trespass into Glimmer's territory, and the reason
 * it needs a name: `_triggerChangeEvent` ends by calling `_sortDom()`, which
 * `appendChild`s every item in visual order to make DOM order match the
 * layout. There is no option to turn it off. See `SORT_DOM` below.
 */
export interface SortDomInternal {
  _sortDom?: () => unknown;
}

interface GridStackStatic {
  init(options: Record<string, unknown>, el: HTMLElement): GridLike;
}

interface GridStackEngineStatic {
  new (opts: { column: number; float: boolean; maxRow: number }): EngineLike;
}

const Engine = GridStackEngine as unknown as GridStackEngineStatic;
export const Grids = GridStack as unknown as GridStackStatic;

// ── layout as data ───────────────────────────────────────────────────────

/**
 * One tile's position on the grid. This is the whole persistence format:
 * plain, flat, JSON-safe, and — following `Board`'s `KanbanPlacement`
 * precedent — stored SEPARATELY from the items, keyed by id. A tile's data
 * never carries coordinates, and the grid never carries the tile's data.
 */
export interface DashboardPlacement {
  /** matches the id `@idFor` returns for the item this positions */
  id: string;
  /** 0-based column of the tile's inline start */
  x: number;
  /** 0-based row of the tile's block start */
  y: number;
  /** width in columns, at least 1 */
  w: number;
  /** height in rows, at least 1 */
  h: number;
}

/** The serialized arrangement. Hand this straight to a Boxel field. */
export type DashboardLayout = readonly DashboardPlacement[];

/** Which geometry the arrow keys act on while a tile is being adjusted. */
export type AdjustMode = 'move' | 'resize';

export function intAt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}

/**
 * Force one placement into the legal range for a grid of `columns` columns.
 * Pure, total, and never throws — a placement read back from a card field may
 * be anything at all, including `w: 999`, a negative `y`, or `NaN`.
 */
export function clampPlacement(
  placement: DashboardPlacement,
  columns: number,
): DashboardPlacement {
  const cols = Math.max(1, Math.round(columns));
  const w = Math.min(cols, Math.max(1, intAt(placement.w, 1)));
  const h = Math.max(1, intAt(placement.h, 1));
  const x = Math.min(cols - w, Math.max(0, intAt(placement.x, 0)));
  const y = Math.max(0, intAt(placement.y, 0));
  return { id: placement.id, x, y, w, h };
}

/**
 * Resolve a layout the way the live grid would: clamp every placement, then
 * run gridstack's own `GridStackEngine` to push overlapping tiles apart and
 * (unless `float`) pack them upwards. Input order is preserved on the way
 * out; the engine sorts internally.
 *
 * DOM-FREE — the engine never touches `document`, which is what lets
 * read-only mode, the caller, and the unit tests share one layout truth with
 * the interactive grid instead of approximating it.
 */
export function resolveLayout(
  layout: DashboardLayout,
  columns: number,
  float = false,
): DashboardPlacement[] {
  const cols = Math.max(1, Math.round(columns));
  const engine = new Engine({ column: cols, float, maxRow: 0 });
  for (const placement of layout) {
    const safe = clampPlacement(placement, cols);
    engine.addNode({ id: safe.id, x: safe.x, y: safe.y, w: safe.w, h: safe.h });
  }
  const resolved = new Map<string, DashboardPlacement>();
  for (const node of engine.nodes) {
    const id = String(node.id ?? '');
    resolved.set(id, {
      id,
      x: intAt(node.x, 0),
      y: intAt(node.y, 0),
      w: Math.max(1, intAt(node.w, 1)),
      h: Math.max(1, intAt(node.h, 1)),
    });
  }
  return layout.map(
    (placement) => resolved.get(placement.id) ?? clampPlacement(placement, cols),
  );
}

/** Order-insensitive layout equality — the emit guard and the test oracle. */
export function sameLayout(a: DashboardLayout, b: DashboardLayout): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const index = new Map(a.map((placement) => [placement.id, placement]));
  return b.every((placement) => {
    const other = index.get(placement.id);
    return (
      !!other &&
      other.x === placement.x &&
      other.y === placement.y &&
      other.w === placement.w &&
      other.h === placement.h
    );
  });
}

/**
 * The keyboard geometry step. Arrows move by one cell; the same arrows in
 * resize mode grow or shrink by one cell from the inline/block end. Returns
 * the REQUESTED placement, clamped to the grid — the engine still gets to
 * push neighbours around, so what the live grid announces is read back from
 * the engine afterwards rather than assumed from this.
 */
export function nudge(
  placement: DashboardPlacement,
  key: string,
  mode: AdjustMode,
  columns: number,
): DashboardPlacement {
  const next = { ...placement };
  if (mode === 'move') {
    if (key === 'ArrowLeft') {
      next.x -= 1;
    } else if (key === 'ArrowRight') {
      next.x += 1;
    } else if (key === 'ArrowUp') {
      next.y -= 1;
    } else if (key === 'ArrowDown') {
      next.y += 1;
    }
  } else {
    if (key === 'ArrowLeft') {
      next.w -= 1;
    } else if (key === 'ArrowRight') {
      next.w += 1;
    } else if (key === 'ArrowUp') {
      next.h -= 1;
    } else if (key === 'ArrowDown') {
      next.h += 1;
    }
  }
  return clampPlacement(next, columns);
}

/** "Revenue moved to column 3, row 2." — the live-region sentence. */
export function describeMove(label: string, p: DashboardPlacement): string {
  return `${label} moved to column ${p.x + 1}, row ${p.y + 1}.`;
}

/** "Revenue resized to 4 by 2." — width by height, in cells. */
export function describeResize(label: string, p: DashboardPlacement): string {
  return `${label} resized to ${p.w} by ${p.h}.`;
}

/** The sentence read when an adjustment is committed. */
export function describePlaced(label: string, p: DashboardPlacement): string {
  return `${label} placed at column ${p.x + 1}, row ${p.y + 1}, ${p.w} by ${p.h}.`;
}

// ── the host seam ────────────────────────────────────────────────────────

/**
 * What a `DashboardItem` needs from the grid that renders it. Declared as an
 * interface rather than referencing the class so the cell can be read (and
 * tested, and reimplemented) without pulling the engine in behind it.
 */
export interface DashboardHost {
  /** false in read-only mode: no handle, no engine, no listeners */
  editable: boolean;
  /** id of the shared keyboard-instructions element */
  hintId: string;
  /** true while this id is in keyboard adjust mode */
  isAdjusting(id: string): boolean;
  /** 'move' | 'resize' while adjusting this id, else null */
  adjustMode(id: string): AdjustMode | null;
  /** engine registration — driven from the cell's own modifier */
  attachItem(id: string, el: HTMLElement, seed: WidgetOptions): void;
  detachItem(id: string, el: HTMLElement): void;
  syncItem(
    el: HTMLElement,
    x: number | undefined,
    y: number | undefined,
    w: number | undefined,
    h: number | undefined,
  ): void;
  onItemKeydown(id: string, label: string, event: KeyboardEvent): void;
  onItemBlur(id: string): void;
}

/**
 * The stable handle a cell hands its registration modifier. Plain, untracked,
 * created once per cell — see `registerDashboardItem` for why that matters.
 */
export interface CellRegistry {
  attach(el: HTMLElement): void;
  detach(el: HTMLElement): void;
}

// ── stylesheet delivery ──────────────────────────────────────────────────
// Refcounted <style> in document.head: the engine's structural rules must
// reach nodes gridstack creates at runtime (placeholder, resize handle),
// which can never carry a scoped-css attribute. See structure-dashboard-css.

const ENGINE_SHEET_ID = 'pretui-dashboard-engine-css';

function retainSheet(id: string, css: string) {
  let el: HTMLElement | null = document.getElementById(id);
  if (!el) {
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
    el = style;
  }
  el.dataset['refs'] = String(Number(el.dataset['refs'] ?? '0') + 1);
}

function releaseSheet(id: string) {
  const el: HTMLElement | null = document.getElementById(id);
  if (!el) {
    return;
  }
  const remaining = Number(el.dataset['refs'] ?? '1') - 1;
  if (remaining <= 0) {
    el.remove();
  } else {
    el.dataset['refs'] = String(remaining);
  }
}

// ── modifiers ────────────────────────────────────────────────────────────
//
// Four of them, and the split between them is deliberate. A functional
// modifier re-runs its whole body — destructor first — whenever ANY argument
// changes, so a single modifier taking both the host and the live options
// would tear the engine down and rebuild it every time `@cellHeight` moved,
// losing every item registration on the way. Therefore: the two LIFECYCLE
// modifiers take only stable arguments and never re-run, and the two SYNC
// modifiers that carry changing values have no destructor at all.

/** Creates the engine, and destroys it. Stable arg only — never re-runs. */
export const mountDashboardPlane = modifier(
  (element: HTMLElement, [host]: [DashboardGridHost]) => {
    retainSheet(ENGINE_SHEET_ID, DASHBOARD_ENGINE_CSS);
    host.mount(element);
    return () => {
      host.unmount();
      releaseSheet(ENGINE_SHEET_ID);
    };
  },
);

/** Pushes changed grid options into a live engine. No destructor by design. */
export const syncDashboardOptions = modifier(
  (
    _element: HTMLElement,
    [host, cellHeight, gap, float, animate]: [
      DashboardGridHost,
      number,
      number,
      boolean,
      boolean,
    ],
  ) => {
    host.applyOptions(cellHeight, gap, float, animate);
  },
);

/**
 * Registers one cell with the engine, and unregisters it.
 *
 * Its ONE argument is a plain untracked object the cell creates once, and
 * that is the whole point — a functional modifier's destructor also runs
 * before every RE-RUN, so if this modifier ever re-ran it would unregister
 * and re-register a live tile: gridstack would tear down the drag/resize
 * wiring (blurring whatever inside the tile had focus) and re-seed the tile
 * at its AUTHORED cell, silently undoing the move in progress. Measured, not
 * theorised — it is what the keyboard render proof caught.
 *
 * Nothing tracked may be read from here, directly or through the registry's
 * closures: ember-modifier runs the body in an autotracking frame, so a read
 * of `this.args.anything` would re-subscribe the modifier to exactly the
 * churn this design exists to avoid. `DashboardItem` therefore captures its
 * id, host and seed placement as untracked fields at construction, which is
 * sound because `{{#each}}` is keyed by id — a cell's identity cannot change
 * during its life.
 */
export const registerDashboardItem = modifier(
  (element: HTMLElement, [registry]: [CellRegistry]) => {
    registry.attach(element);
    return () => registry.detach(element);
  },
);

/**
 * Pushes a changed placement into a live engine. Re-running is its job, so it
 * has no destructor and touches nothing but geometry.
 */
export const syncDashboardItem = modifier(
  (
    element: HTMLElement,
    [host, live, x, y, w, h]: [
      DashboardHost | undefined,
      boolean,
      number | undefined,
      number | undefined,
      number | undefined,
      number | undefined,
    ],
  ) => {
    if (!live) {
      return;
    }
    host?.syncItem(element, x, y, w, h);
  },
);


export interface DashboardGridHost extends DashboardHost {
  mount(element: HTMLElement): void;
  unmount(): void;
  applyOptions(
    cellHeight: number,
    gap: number,
    float: boolean,
    animate: boolean,
  ): void;
}
