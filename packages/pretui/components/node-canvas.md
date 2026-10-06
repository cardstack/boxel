## What it is

An infinite pan/zoom node graph: nodes, edges, a patterned background, zoom controls and a minimap. Use it for a flow, a dependency graph, a pipeline, a mind map — anything whose meaning is in the connections. If the arrangement is columnar, **Board**. If it is a hierarchy, **Tree**. If it is a sequence, **Timeline** or **StepList**. A canvas is the most expensive surface in the kit to make usable; reach for a simpler one when the structure allows it.

## The contract

```
@label: string   (REQUIRED — it is a role="application")
@nodes?, @edges?   — uncontrolled unless @onNodesChange / @onEdgesChange is passed
@onNodesChange?, @onEdgesChange?, @onConnect?
@flow? 'horizontal' | 'vertical'
@nodeBody?, @nodeTypes?
@pattern? 'dots' | 'lines' | 'cross' | 'none', @gap?, @patternSize?
@controls? (true), @controlsPosition?, @summary? 'sr-only' | 'visible' | 'off'
```

**An uncontrolled canvas seeds from `@nodes` once and then owns its own copy** — later changes to the array are ignored. Pass `@onNodesChange` and keep the array yourself whenever the graph changes from outside.

**`@flow` sets the drawn handles *and* the edge endpoints together**, and it exists because of a real React Flow foot-gun: the engine defaults `sourcePosition`/`targetPosition` to bottom/top, but a custom node component draws its own handles — so every React Flow graph that forgets those two keys renders edges leaving the *bottom* of a node whose handle is on the *right*. One arg, set once, both sides.

## Prior art

A **wrap of `@cardstack/boxel-canvas`** — a Glimmer port of **xyflow / React Flow**, vendored from emberflow, shipped as a self-contained ESM bundle copied into this realm.

**The stylesheet problem is worth recording**, because it is a realm constraint with no obvious workaround: boxel-canvas needs a companion CSS file, and the npm side-effect `import './styles/canvas.css'` is banned in realm code — it passes parse, remote lint *and* transpile, then fails at indexing with `Unexpected token (28:0)` because the realm loader fetches the CSS and parses it as JavaScript. A bare `<link>` to the realm-served URL 401s on a private realm. So the sheet ships as a **string module** and a modifier injects it into `document.head`, **refcounted** so N canvases share one `<style>` and the last teardown removes it.

That same modifier injects a second sheet for the handful of engine-owned elements no custom property can reach — focus rings the engine explicitly sets to `outline: none`, and the reduced-motion fallback it never wrote. **Every selector in it is anchored under `.pretui-node-canvas`, so it cannot leak past a NodeCanvas.** Everything else is retinted through the engine's own `--xy-*` custom-property channel from `<style scoped>` — no `:global()`, no `:deep()`, no `!important`.

Pretui's additions beyond the cloth: `@flow` (above), hairline-plus-shadow depth instead of the stock node border, **restored focus visibility**, **animated edges that stop under `prefers-reduced-motion`**, and `@summary`.

## Accessibility

**Canvases are the worst surface in UI for screen readers**, and this component's answer is `@summary`: **the whole graph rendered as a real list of nodes and their outgoing links**, `sr-only` by default and available as `visible` for anyone who would rather read it than trace it. Assistive tech reaches it through `aria-describedby` while the visual frame is unchanged. That is the single most valuable thing here, and it is the right answer — a text form of the graph beats any amount of ARIA on the canvas itself.

The keyboard contract, **read out of the engine bundle rather than assumed**:

- The root is `role="application" tabindex="0"`; every visible node is `tabindex="0"` with `aria-roledescription="node"`.
- **Tab / Shift-Tab move the selection to the next / previous node.** The engine consumes the key — inside a canvas, Tab is a graph walk, not the browser's tab order.
- **Enter (or F2) activates** the focused node. **Space does not select** — it is the pan key, held while dragging.
- **Arrows** move the selection to the nearest node in that direction; in the surface's `change` mode they nudge the selected node by one graph unit, Shift+Arrow by ten.
- Delete/Backspace delete the selection, Cmd/Ctrl+A selects all, Escape cancels a drag, then an edit, then clears the selection and releases focus.
- Zoom in / zoom out / fit / lock are real `<button>`s with `aria-label`s inside `Controls`, and are **the only keyboard route to pan or zoom**.

**The remaining gaps, stated plainly rather than papered over:**

1. **There is no keyboard path to create or reconnect an edge.** Connections are pointer-only here and in React Flow. If your graph is editable, **ship a non-canvas editing path beside it** — this is a WCAG **2.1.1** failure for the connect interaction and it cannot be fixed inside the wrapper.
2. **The engine registers its key handler on the window in the capture phase**, so while any canvas is mounted those keys are canvas-scoped for the whole page — a Tab pressed outside the graph can be pulled into it (text inputs and activation keys on buttons are exempt). **Give a canvas its own page or panel; do not sit one beside an unrelated form.**
3. **The MiniMap's accessible name is an SVG `<title>` with a fixed id upstream**, so two canvases on one page share the first one's name. One canvas per page is the shape that behaves.
4. `@summary` is the answer to what is left.

## Theming

Retinted through the engine's `--xy-*` custom-property channel from `<style scoped>`: node surfaces, edge strokes, handle fills, background pattern, controls and minimap all map onto Pretui tokens. Node depth uses `--card`, `--border` and the kit's shadow tokens instead of the stock border. `--pretui-canvas-*` and the pattern's `@gap`/`@patternSize` are graph-space args, not tokens.

The injected skin sheet covers only what the channel cannot reach — the focus ring and the reduced-motion guard — and is anchored under `.pretui-node-canvas`, so a season cannot accidentally restyle another canvas through it.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
