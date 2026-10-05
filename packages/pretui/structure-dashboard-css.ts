// structure-dashboard-css.ts — the ONLY rules gridstack's engine genuinely
// requires, restated in Pretui tokens.
//
// Why this is a global sheet and not `<style scoped>`: three of the four
// selectors below target nodes **gridstack creates at runtime** — the drop
// placeholder (`.grid-stack-placeholder > .placeholder-content`) and the
// resize handles (`.ui-resizable-*`). The scoped-CSS transpiler rewrites every
// selector to `.foo[data-scopedcss-…]`, and a node created by JS after render
// never receives that attribute, so scoped rules can never reach them. Same
// trap Observable Plot hit with its runtime-created SVG.
//
// It is NOT a side-effect `import './gridstack.css'` either: the realm loader
// fetches CSS and parses it as JavaScript, which fails indexing outright with
// `Unexpected token`. A string module + `document.head` injection from a
// refcounted `ember-modifier` is the working delivery route (the pattern
// `surfaces-canvas-css.ts` proved).
//
// Every selector is prefixed with `.pretui-dashboard-plane` so this sheet can
// never restyle another gridstack instance that happens to share the page, and
// every colour is a token with a light-value fallback — the sheet lives in
// `document.head` but its custom properties resolve against the plane element,
// which sits inside the themed subtree and inherits the season.
//
// Ported from gridstack 13.1.2 `src/gridstack.scss`. DROPPED on purpose:
// the grey `rgba(0,0,0,0.1)` placeholder fill and the grey inline-SVG arrow
// handle (both hard-coded, un-themable), the `@media print` block (110 lines
// of `!important`), the rtl `right:` mirror loop (one logical rule replaces
// it), `will-change` hints on drag (they pin a compositor layer per item for
// the whole drag with no measured benefit here), and `z-index: 10000`, which
// was chosen to beat a Bootstrap modal and would beat Boxel's own overlays.

export const DASHBOARD_ENGINE_CSS = `
.pretui-dashboard-plane {
  position: relative;
}

/* The engine's positioning contract. gridstack writes only the deltas as
   inline style — top/left for x,y > 0 and width/height for w,h > 1 — and
   relies on these declarations for everything it left out, so a 1x1 tile at
   0,0 carries no inline geometry at all. */
.pretui-dashboard-plane > .grid-stack-item {
  position: absolute;
  padding: 0;
  inset-block-start: 0;
  inset-inline-start: 0;
  width: var(--gs-column-width);
  height: var(--gs-cell-height);
}

/* gridstack sets --gs-item-margin-* on the plane from its margin option;
   the content box insets by them, which is how the gutter is drawn without
   any element owning a margin. */
.pretui-dashboard-plane > .grid-stack-item > .grid-stack-item-content,
.pretui-dashboard-plane > .grid-stack-placeholder > .placeholder-content {
  position: absolute;
  margin: 0;
  width: auto;
  top: var(--gs-item-margin-top, 0px);
  right: var(--gs-item-margin-right, 0px);
  bottom: var(--gs-item-margin-bottom, 0px);
  left: var(--gs-item-margin-left, 0px);
  overflow: hidden;
}

/* The drop target that follows the dragged tile. */
.pretui-dashboard-plane > .grid-stack-placeholder > .placeholder-content {
  border-radius: var(--pretui-dashboard-radius, var(--radius));
  background: color-mix(in srgb, var(--primary) 9%, transparent);
  box-shadow: 0 0 0 1px
    color-mix(in srgb, var(--primary) 42%, transparent);
}

/* The tile under the pointer rides above its neighbours and gains one
   elevation step — Law 1: depth is the shadow token, never a contrast bump. */
.pretui-dashboard-plane > .grid-stack-item.ui-draggable-dragging,
.pretui-dashboard-plane > .grid-stack-item.ui-resizable-resizing {
  z-index: 3;
}
.pretui-dashboard-plane
  > .grid-stack-item.ui-draggable-dragging
  > .grid-stack-item-content,
.pretui-dashboard-plane
  > .grid-stack-item.ui-resizable-resizing
  > .grid-stack-item-content {
  box-shadow: var(
    --pretui-shadow-overlay,
    0 0 0 1px var(--border),
    0 8px 28px rgb(0 0 0 / 0.34)
  );
}

/* Resize affordance. gridstack builds this node itself, so it can only be
   reached from here. It is revealed on hover AND on :focus-within — a
   keyboard user who tabs into a tile must be told the tile is resizable
   (the keyboard resize path itself lives on the tile's handle button). */
.pretui-dashboard-plane > .grid-stack-item > .ui-resizable-handle {
  position: absolute;
  display: block;
  touch-action: none;
  user-select: none;
  z-index: 2;
  opacity: 0;
  transition: opacity 120ms ease;
}
.pretui-dashboard-plane > .grid-stack-item:hover > .ui-resizable-handle,
.pretui-dashboard-plane > .grid-stack-item:focus-within > .ui-resizable-handle {
  opacity: 1;
}
.pretui-dashboard-plane > .grid-stack-item > .ui-resizable-se {
  right: var(--gs-item-margin-right, 0px);
  bottom: var(--gs-item-margin-bottom, 0px);
  width: 17px;
  height: 17px;
  cursor: se-resize;
  border-right: 2px solid
    color-mix(in srgb, var(--muted-foreground) 60%, transparent);
  border-bottom: 2px solid
    color-mix(in srgb, var(--muted-foreground) 60%, transparent);
  border-bottom-right-radius: var(
    --pretui-dashboard-radius,
    var(--radius)
  );
}
.pretui-dashboard-plane > .grid-stack-item:hover > .ui-resizable-se {
  border-right-color: var(--primary);
  border-bottom-color: var(--primary);
}

/* Touch: no hover state exists, so the affordance is permanent and grows to
   a 44px target. */
@media (any-pointer: coarse) {
  .pretui-dashboard-plane > .grid-stack-item > .ui-resizable-handle {
    opacity: 1;
  }
  .pretui-dashboard-plane > .grid-stack-item > .ui-resizable-se {
    width: 30px;
    height: 30px;
  }
}

/* Repositioning of the tiles a drag displaces — the one motion here, and it
   encodes a state transition (Law 5): it shows WHERE a pushed tile went. The
   dragged tile and the placeholder are exempt so they track the pointer. */
.pretui-dashboard-plane.grid-stack-animate > .grid-stack-item {
  transition:
    top 190ms cubic-bezier(0.2, 0, 0, 1),
    left 190ms cubic-bezier(0.2, 0, 0, 1),
    right 190ms cubic-bezier(0.2, 0, 0, 1),
    width 190ms cubic-bezier(0.2, 0, 0, 1),
    height 190ms cubic-bezier(0.2, 0, 0, 1);
}
.pretui-dashboard-plane.grid-stack-animate
  > .grid-stack-item.ui-draggable-dragging,
.pretui-dashboard-plane.grid-stack-animate
  > .grid-stack-item.ui-resizable-resizing,
.pretui-dashboard-plane.grid-stack-animate > .grid-stack-placeholder {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .pretui-dashboard-plane.grid-stack-animate > .grid-stack-item,
  .pretui-dashboard-plane > .grid-stack-item > .ui-resizable-handle {
    transition: none;
  }
}
`;
