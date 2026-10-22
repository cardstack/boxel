// Pretui — surfaces territory: the two components that only Boxel can
// ship, because only Boxel has the `surfaces` packages sitting under the
// wardrobe. Both are wraps: the engine stays the library's, only the cloth
// changes.
//
//   NodeCanvas   ← @cardstack/boxel-canvas  (a Glimmer port of xyflow /
//                  React Flow, vendored from emberflow). Infinite
//                  pan/zoom node graph: nodes, edges, dot/line/cross
//                  background, zoom controls, minimap.
//   PageScaffold ← @cardstack/boxel-layout  (`Layout` + its four presets
//                  bare / page / notebook / tools). Application frame with
//                  named landmark regions. Upstream reference: wa-page.
//
// Both import the surfaces realm bundle copied into this realm at
// ./surfaces/ (self-contained ESM — xyflow is inlined; only host-provided
// modules are external). Relative in-realm imports, not cross-realm
// common-libs URLs: local `boxel parse` can resolve mirror-local files but
// not authed remote ones.
//
// ── The canvas stylesheet problem, and how this module solves it ────────
// boxel-canvas is the one surfaces package that needs a companion
// stylesheet (surfaces/canvas/styles/canvas.css). The npm package pulls it
// in with a side-effect `import './styles/canvas.css'`, which is BANNED in
// realm code: it passes parse, remote lint AND transpile, then fails at
// indexing with `Unexpected token (28:0)` because the realm loader fetches
// the CSS and parses it as JavaScript. A bare <link> to the realm-served
// URL 401s (private realm, header auth). So the sheet ships as a string
// module (surfaces-canvas-css.ts) and the `canvasStylesheet` modifier
// below injects it into document.head, refcounted so N canvases share one
// <style> and the last teardown removes it.
//
// That same modifier injects a SECOND sheet, PRETUI_CANVAS_SKIN, for the
// handful of engine-owned elements that no custom property can reach
// (focus rings the engine explicitly sets to `outline: none`, the
// reduced-motion fallback the engine never wrote). Every selector in it is
// anchored under `.pretui-node-canvas`, so it cannot leak past a
// NodeCanvas. Everything else is retinted through the engine's own
// `--xy-*` custom-property channel from `<style scoped>` — no :global(),
// no :deep(), no !important.
//
// Pretui — the canvas stylesheet primitive and the data shapes NodeCard and NodeCanvas share.
import { modifier } from 'ember-modifier';
import { CANVAS_CSS } from '../surfaces-canvas-css';

// ── canvasStylesheet — exported primitive ────────────────────────────────
// Any sibling that mounts a boxel-canvas needs this; it is exported rather
// than buried so the next canvas-shaped component reuses it instead of
// re-deriving the injection dance. A `data-refs` attribute on the <style>
// counts the mounted canvases, so the last teardown is the one that removes
// it.

const ENGINE_SHEET_ID = 'pretui-surfaces-canvas-css';
const SKIN_SHEET_ID = 'pretui-surfaces-canvas-skin';

// Engine-owned elements that custom properties cannot reach. Each rule is
// anchored under .pretui-node-canvas so nothing escapes the component.
// What upstream got wrong, itemised:
//   1. `.boxel-canvas__node.selectable:focus-visible { outline: none }`
//      and the same on `__edge` and `__selection` — a keyboard user
//      tabbing through the graph sees nothing at all. Restored, using the
//      Pretui --ring token.
//   2. The controls buttons have no focus style either, and the container
//      has square corners with the engine's fixed shadow.
//   3. `animation: dashdraw .5s linear infinite` on animated edges has no
//      `prefers-reduced-motion` fallback anywhere in canvas.css. Restored
//      with the END state (dashoffset 0), never a frozen midpoint.
//   4. Every engine panel is pinned to `bottom: 0`, so the Controls and
//      the MiniMap sit UNDER the caption strip that `@summary='visible'`
//      draws. The strip's height is a knob and the bottom panels lift by
//      exactly that much.
// The one `outline: none` below is a REPLACEMENT, not a removal: an SVG
// edge cannot show an outline usefully, so the focused edge is redrawn in
// the ring colour at a heavier stroke on the line after it.
const PRETUI_CANVAS_SKIN = `
.pretui-node-canvas .boxel-canvas__node:focus-visible,
.pretui-node-canvas .boxel-canvas__node.selectable:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 3px;
  border-radius: var(--pretui-node-radius, var(--radius-surface, 10px));
}
.pretui-node-canvas .boxel-canvas__edge:focus-visible {
  outline: none;
}
.pretui-node-canvas .boxel-canvas__edge:focus-visible .boxel-canvas__edge-path {
  stroke: var(--ring);
  stroke-width: 2.5;
}
.pretui-node-canvas .boxel-canvas__controls {
  border-radius: var(--pretui-canvas-chrome-radius, 8px);
  overflow: hidden;
}
.pretui-node-canvas .boxel-canvas__controls-button {
  height: var(--pretui-canvas-chrome-size, 26px);
  width: var(--pretui-canvas-chrome-size, 26px);
}
.pretui-node-canvas .boxel-canvas__controls-button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
  position: relative;
  z-index: 1;
}
.pretui-node-canvas .boxel-canvas__minimap {
  border-radius: var(--pretui-canvas-chrome-radius, 8px);
  overflow: hidden;
  box-shadow: var(--pretui-canvas-chrome-shadow,
    0 0 0 1px var(--border), 0 1px 2px rgb(0 0 0 / 0.12));
}
.pretui-node-canvas .boxel-canvas__handle {
  width: var(--pretui-handle-size, 8px);
  height: var(--pretui-handle-size, 8px);
  transition: box-shadow 140ms ease, background-color 140ms ease;
}
.pretui-node-canvas .boxel-canvas__handle.connectionindicator:hover {
  box-shadow: 0 0 0 4px color-mix(in oklch,
    var(--primary) 22%, transparent);
}
.pretui-node-canvas[data-summary='visible'] .boxel-canvas__panel.bottom {
  bottom: var(--pretui-canvas-summary-height, 8rem);
}
@media (prefers-reduced-motion: reduce) {
  .pretui-node-canvas .boxel-canvas__edge.animated .boxel-canvas__edge-path {
    animation: none;
    stroke-dashoffset: 0;
  }
  .pretui-node-canvas .boxel-canvas__connection .animated {
    animation: none;
    stroke-dashoffset: 0;
  }
  .pretui-node-canvas .boxel-canvas__handle {
    transition: none;
  }
}
`;

// ── The arrowhead bug this fixes ─────────────────────────────────────────
// boxel-canvas emits `marker-end="url('#1__type=arrowclosed')"` on any edge
// carrying `markerEnd` — and there is not ONE `<marker>` element anywhere
// in the package. React Flow renders a `<MarkerDefinitions>` component into
// its flow SVG; the Ember port never ported it, so `markerEnd` resolves to
// a dangling fragment reference and draws NOTHING, silently. A directed
// graph with no arrowheads is ambiguous — you cannot tell which way an
// edge runs — so the defs are supplied here.
//
// The engine hard-codes the `1__` prefix (a flow-id placeholder that was
// never wired), which means the ids are document-global whether we like it
// or not. So they are injected ONCE per document, refcounted alongside the
// stylesheets, rather than per canvas. `context-stroke` makes each
// arrowhead take the colour of the edge that references it, so a selected
// edge gets a selected arrowhead for free and no token has to be resolved
// from outside the canvas's own subtree.
const MARKERS_ID = 'pretui-surfaces-canvas-markers';
const MARKER_SVG = `<defs>
<marker id="1__type=arrowclosed" markerWidth="12.5" markerHeight="12.5" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
<polyline points="-5,-4 0,0 -5,4 -5,-4" fill="context-stroke" stroke="context-stroke" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"></polyline>
</marker>
<marker id="1__type=arrow" markerWidth="12.5" markerHeight="12.5" viewBox="-10 -10 20 20" markerUnits="strokeWidth" orient="auto-start-reverse" refX="0" refY="0">
<polyline points="-5,-4 0,0 -5,4" fill="none" stroke="context-stroke" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"></polyline>
</marker>
</defs>`;

function retainMarkers() {
  let el = document.getElementById(MARKERS_ID);
  if (!el) {
    let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = MARKERS_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML = MARKER_SVG;
    document.body.appendChild(svg);
    el = svg as unknown as HTMLElement;
  }
  el.dataset['refs'] = String(Number(el.dataset['refs'] ?? '0') + 1);
}

function releaseMarkers() {
  let el = document.getElementById(MARKERS_ID);
  if (!el) {
    return;
  }
  let remaining = Number(el.dataset['refs'] ?? '1') - 1;
  if (remaining <= 0) {
    el.remove();
  } else {
    el.dataset['refs'] = String(remaining);
  }
}

function retainSheet(id: string, css: string) {
  let el: HTMLElement | null = document.getElementById(id);
  if (!el) {
    let style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
    el = style;
  }
  el.dataset['refs'] = String(Number(el.dataset['refs'] ?? '0') + 1);
}

function releaseSheet(id: string) {
  let el: HTMLElement | null = document.getElementById(id);
  if (!el) {
    return;
  }
  let remaining = Number(el.dataset['refs'] ?? '1') - 1;
  if (remaining <= 0) {
    el.remove();
  } else {
    el.dataset['refs'] = String(remaining);
  }
}

/**
 * Mounts the boxel-canvas engine stylesheet, the Pretui skin, and the
 * arrowhead marker defs the engine references but never ships, for as long
 * as the modified element is alive. Refcounted: many canvases share one set
 * and the last teardown removes it. Use it on any element that hosts a
 * `<Canvas>` from `./surfaces/canvas/index.js`.
 */
export const canvasStylesheet = modifier(() => {
  retainSheet(ENGINE_SHEET_ID, CANVAS_CSS);
  retainSheet(SKIN_SHEET_ID, PRETUI_CANVAS_SKIN);
  retainMarkers();
  return () => {
    releaseMarkers();
    releaseSheet(SKIN_SHEET_ID);
    releaseSheet(ENGINE_SHEET_ID);
  };
});

// ── Shared data shapes ───────────────────────────────────────────────────

/** Payload a NodeCard reads. Any extra keys are yours to use in a custom body. */
export interface NodeCardData {
  /** headline line — the one thing a reader scans for */
  title?: string;
  /** machine value (id / version / enum) set as a Token, per Law 3 */
  kind?: string;
  /** one supporting line under the title */
  meta?: string;
  /** short state word; its hue is DERIVED from the string, per Law 2 */
  status?: string;
  /** override the derived hue with an explicit color/`var()` */
  hue?: string;
  /** engine fallback: bare label when no title is given */
  label?: string;
  [key: string]: unknown;
}

/** One node. `position` is graph space; the engine owns it after a drag. */
export interface CanvasNode {
  id: string;
  position: { x: number; y: number };
  data?: NodeCardData;
  /** node-type key into `@nodeTypes`; defaults to Pretui's own shell */
  type?: string;
  width?: number;
  height?: number;
  sourcePosition?: 'left' | 'right' | 'top' | 'bottom';
  targetPosition?: 'left' | 'right' | 'top' | 'bottom';
  selected?: boolean;
  draggable?: boolean;
  selectable?: boolean;
  focusable?: boolean;
  hidden?: boolean;
  /** screen-reader name; NodeCanvas fills it from data.title when absent */
  ariaLabel?: string;
  [key: string]: unknown;
}

/** One edge. `animated` dashes the stroke (and is silenced under reduced motion). */
export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  animated?: boolean;
  selected?: boolean;
  type?: string;
  [key: string]: unknown;
}
