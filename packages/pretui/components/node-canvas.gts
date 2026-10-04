// Pretui — NodeCanvas: a node-and-edge canvas over the vendored surfaces engine.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { cssStyle } from '../pretui-css';
import { Background, Canvas, Controls, Handle, MiniMap, Panel, addEdge, applyEdgeChanges, applyNodeChanges, getCanvas } from '../surfaces/canvas/index.js';
import { GraphOutline } from './graph-outline';
import { graphLayout, handleSidesFor } from '../surfaces-canvas-layout';
import type { GraphDirection, GraphLayoutResult } from '../surfaces-canvas-layout';
import { NodeCard } from './node-card';
import type { NodeBodyComponent, NodeBodySignature } from './node-card';
import { canvasStylesheet } from '../internal/surfaces-canvas';
import type { CanvasEdge, CanvasNode } from '../internal/surfaces-canvas';

// ── NodeShell — handles + hit area around whatever body is in play ───────
// The engine's FlowNode draws its own source/target handles ONLY when no
// custom node component is supplied (`hasSourceHandle = !nodeComponent`),
// which means every custom node in React Flow and in this port has to
// remember to render <Handle>s or its edges detach. NodeCanvas always uses
// a custom component, so the shell renders them once, correctly, for every
// body — including a caller's.

class NodeShell extends Component<NodeBodySignature> {
  /** Overridden by `shellFor` to carry the caller's body component. */
  get body(): NodeBodyComponent {
    return NodeCard as unknown as NodeBodyComponent;
  }
  get targetPosition() {
    return this.args.node?.targetPosition ?? 'left';
  }
  get sourcePosition() {
    return this.args.node?.sourcePosition ?? 'right';
  }
  <template>
    <Handle @type='target' @position={{this.targetPosition}} />
    <this.body
      @node={{@node}}
      @id={{@id}}
      @data={{@data}}
      @selected={{@selected}}
      @dragging={{@dragging}}
    />
    <Handle @type='source' @position={{this.sourcePosition}} />
  </template>
}

// A component class must keep a STABLE identity across renders or the
// engine treats it as a brand-new node type and warns (error002). Memoised
// per body component; subclassing inherits NodeShell's template through
// the prototype chain.
const SHELL_CACHE = new WeakMap<object, unknown>();

function shellFor(body: NodeBodyComponent): unknown {
  let hit = SHELL_CACHE.get(body as unknown as object);
  if (!hit) {
    hit = class extends NodeShell {
      override get body(): NodeBodyComponent {
        return body;
      }
    };
    SHELL_CACHE.set(body as unknown as object, hit);
  }
  return hit;
}

// ── NodeCanvas ───────────────────────────────────────────────────────────
// Ported from @cardstack/boxel-canvas (xyflow / React Flow). What the
// inspiration got wrong, and what this fixes:
//
//   • Uncontrolled by default. React Flow makes you wire onNodesChange /
//     useNodesState before a node will move at all; drop `<NodeCanvas
//     @nodes>` on a page here and dragging just works. Pass
//     `@onNodesChange` and it hands control straight back.
//   • Node content is a component slot, not a string. React Flow's stock
//     node renders `data.label`; anything richer means authoring a
//     nodeTypes map AND remembering the <Handle>s. Here `@nodeBody` takes
//     any component and the shell supplies the handles.
//   • Chrome is tokenized. Every colour in the engine's `--xy-*` channel
//     is remapped to a Pretui token with a documented `--pretui-canvas-*`
//     knob in front of it — background pattern, edges, handles, controls,
//     minimap, selection rectangle. No `.dark` branch anywhere (the engine
//     ships one; we never add the class that triggers it).
//   • Edges arrive where the handles are. The engine computes an edge's
//     endpoints from `node.sourcePosition ?? 'bottom'` /
//     `node.targetPosition ?? 'top'`, but a custom node component draws
//     its own handles — so every React-Flow graph that forgets those two
//     keys renders edges leaving the BOTTOM of a node whose handle is on
//     the right. `@flow` sets both sides for the whole graph, once, and
//     the shell draws the handles to match.
//   • Depth is hairline + shadow (Law 1) — the stock node border is gone.
//   • Focus is visible again, and animated edges stop under
//     prefers-reduced-motion (Law 5). Both were `outline: none` /
//     unguarded `animation` upstream. See PRETUI_CANVAS_SKIN.
//   • The graph has a text form, and the text form is OPERABLE. Canvases
//     are the worst surface in UI for screen readers; `@summary` renders
//     the whole graph as GraphOutline — a real list of nodes with both
//     directions of every edge spelled out (labels included), where each
//     node is a button that selects and focuses it in the picture, and
//     where a keyboard user can draw a NEW edge. sr-only by default, and
//     it unhides the moment focus enters it.
//   • Auto-layout. React Flow ships none at all; its own Layouting example
//     reaches for `dagre`, whose ranker calls `Math.random()` — forbidden
//     in realm code, because the indexer requires determinism. `@autoLayout`
//     runs a layered pass written for this kit (see surfaces-canvas-layout).
//   • Arrowheads that actually draw. The port emits
//     `marker-end="url('#1__type=arrowclosed')"` and ships no `<marker>`
//     anywhere, so `markerEnd` has always been a no-op. The defs are
//     supplied here, and `@arrowheads` defaults to ON — a directed graph
//     that does not say which way its edges run is not communicating.
//   • Edge routing is a knob. `@edgeType` sets the routing for every edge
//     AND the shape of the line drawn while connecting, which the engine
//     otherwise leaves as a bezier however the edges look.
//
// KEYBOARD — read out of the engine bundle rather than assumed, because a
// canvas is the surface people lie about most:
//   • the canvas root is `role="application" tabindex="0"`; every visible
//     node is `tabindex="0"` with `aria-roledescription="node"`.
//   • Tab / Shift-Tab move the SELECTION to the next / previous node and
//     focus it. The engine consumes the key — inside a canvas Tab is a
//     graph walk, not the browser's tab order.
//   • Enter (or F2) ACTIVATES the focused node — it dispatches the
//     surface `activate` command. Space does NOT select: it is the
//     pan-activation key, held while dragging to pan the viewport.
//   • Arrow keys move the selection to the nearest node in that
//     direction; in the surface's `change` mode they nudge the selected
//     node by one graph unit, Shift+Arrow by ten.
//   • Delete / Backspace delete the selection, Cmd/Ctrl+A selects all,
//     and Escape cancels a drag, then an edit, then clears the selection
//     and releases focus.
//   • zoom in / zoom out / fit view / interactivity lock are real
//     <button>s with aria-labels inside `Controls`, so they are reachable
//     and are the only keyboard route to pan or zoom.
// THE REMAINING GAPS, stated plainly rather than papered over:
//   1. The ENGINE has no keyboard path to create or reconnect an edge —
//      connections are pointer-only here and in React Flow — so `@summary`
//      carries one. GraphOutline gives every node a real button (select and focus it in
//      the picture) and a connect control: arm a source, activate a
//      target, and the connection goes through the SAME `onConnect` a
//      pointer drag uses. Reconnecting an existing edge is still
//      pointer-only.
//   2. The engine registers its key handler on the WINDOW in the capture
//      phase, so while any canvas is mounted those keys are canvas-scoped
//      for the whole page — a Tab pressed outside the graph can be pulled
//      into it (text inputs and activation keys on buttons are exempt).
//      Give a canvas its own page or panel; do not sit one beside an
//      unrelated form.
//   3. The MiniMap's accessible name is an SVG <title> with a FIXED id
//      upstream, so two canvases on one page share the first one's name.
//      One canvas per page is the shape that behaves.
//   4. `@summary` is the answer to what is left: the same graph as a real
//      list of nodes and their outgoing links — sr-only by default, and
//      `visible` for anyone who would rather read it than trace it.

const EMPTY_NODES: CanvasNode[] = [];
const EMPTY_EDGES: CanvasEdge[] = [];

/** Which sides the handles (and therefore the edge endpoints) sit on. */
export type CanvasFlow = 'horizontal' | 'vertical';

const FLOW_SIDES: Record<
  CanvasFlow,
  { source: CanvasNode['sourcePosition']; target: CanvasNode['targetPosition'] }
> = {
  horizontal: { source: 'right', target: 'left' },
  vertical: { source: 'bottom', target: 'top' },
};

/** Edge routing. `bezier` is the engine's unnamed default. */
export type CanvasEdgeType =
  | 'bezier'
  | 'smoothstep'
  | 'step'
  | 'straight'
  | 'simplebezier';

/** What the default block's second parameter carries. */
export interface NodeCanvasApi {
  /** re-run `@autoLayout` over the CURRENT graph, after drags */
  relayout: () => void;
  /** select a node and move keyboard focus to it */
  focusNode: (id: string) => void;
  /** the last layout result: layers, reversed edges, crossing counts */
  layout: GraphLayoutResult | undefined;
}

/**
 * `bezier` is the engine's DEFAULT branch, reached by leaving `type`
 * unset — there is no `'bezier'` case in its path switch, so writing the
 * string through would fall into the same default but is left undefined
 * here to keep the edge records honest about what they asked for.
 */
function edgeTypeValue(type: CanvasEdgeType | undefined): string | undefined {
  return type && type !== 'bezier' ? type : undefined;
}

/** The engine's own name for the same routing, on the in-flight line. */
const CONNECTION_LINE_TYPE: Record<CanvasEdgeType, string> = {
  bezier: 'default',
  smoothstep: 'smoothstep',
  step: 'step',
  straight: 'straight',
  simplebezier: 'simplebezier',
};

const MARKER_FOR: Record<string, { type: string } | undefined> = {
  closed: { type: 'arrowclosed' },
  open: { type: 'arrow' },
  none: undefined,
};

// Memoised so the object handed to the engine keeps ONE identity for a
// given combination — a fresh object every read makes the engine treat
// every edge as replaced.
const EDGE_OPTIONS_CACHE = new Map<string, Record<string, unknown>>();

function defaultEdgeOptionsFor(
  type: CanvasEdgeType,
  arrowheads: string,
  animated: boolean,
): Record<string, unknown> {
  let key = `${type}|${arrowheads}|${animated ? 'a' : '-'}`;
  let hit = EDGE_OPTIONS_CACHE.get(key);
  if (!hit) {
    hit = {};
    let routed = edgeTypeValue(type);
    if (routed) {
      hit['type'] = routed;
    }
    let marker = MARKER_FOR[arrowheads];
    if (marker) {
      hit['markerEnd'] = marker;
    }
    if (animated) {
      hit['animated'] = true;
    }
    EDGE_OPTIONS_CACHE.set(key, hit);
  }
  return hit;
}

const SNAP_CACHE = new Map<number, [number, number]>();

/** Snapping to the drawn grid, not to a second invisible one. */
function snapGridFor(gap: number): [number, number] {
  let hit = SNAP_CACHE.get(gap);
  if (!hit) {
    hit = [gap, gap];
    SNAP_CACHE.set(gap, hit);
  }
  return hit;
}

let summarySeq = 0;

export interface NodeCanvasSignature {
  Args: {
    /**
     * The nodes to draw. Uncontrolled unless `@onNodesChange` is passed:
     * an uncontrolled canvas SEEDS from this array once and then owns its
     * own copy, so later changes to it are ignored. Pass `@onNodesChange`
     * (and keep the array yourself) whenever the graph changes from
     * outside the canvas.
     */
    nodes?: CanvasNode[];
    /** the edges to draw. Uncontrolled unless `@onEdgesChange` is passed. */
    edges?: CanvasEdge[];
    /** accessible name for the canvas. Required — it is a `role=application`. */
    label: string;
    /** take control of node changes (drag, select, remove) */
    onNodesChange?: (changes: unknown[]) => void;
    /** take control of edge changes */
    onEdgesChange?: (changes: unknown[]) => void;
    /** fires when a handle drag completes; uncontrolled canvases add the edge */
    onConnect?: (connection: unknown) => void;
    /**
     * Which sides connectors leave from, for every node that does not set
     * its own `sourcePosition`/`targetPosition`: `horizontal` (default,
     * in at the inline start and out at the inline end) or `vertical`.
     * Sets the drawn handles AND the edge endpoints together.
     */
    flow?: CanvasFlow;
    /**
     * Run the layered auto-layout and place every node, ignoring the
     * `position` on the input nodes. `right` / `down` / `left` / `up`; omit
     * for free positioning. Also pins the handle sides to match, so edges
     * leave the side they are drawn on. See `graphLayout`.
     *
     * It obeys the same controlled/uncontrolled rule as `@nodes`: an
     * UNCONTROLLED canvas lays out once and then owns its own positions, so
     * a reader's drags are never yanked back and a later change to
     * `@autoLayout` does not move anything by itself. Re-run it with the
     * outline's "Tidy layout" control or the `relayout` on the yielded API.
     * A CONTROLLED canvas (`@onNodesChange`) re-lays out whenever the nodes
     * or edges array changes identity.
     */
    autoLayout?: GraphDirection;
    /** space between layers under `@autoLayout`, in graph units (default 110) */
    rankGap?: number;
    /** space between siblings within a layer under `@autoLayout` (default 28) */
    nodeGap?: number;
    /** node width the layout assumes when a node declares none (default 200) */
    layoutNodeWidth?: number;
    /** node height the layout assumes when a node declares none (default 96) */
    layoutNodeHeight?: number;
    /**
     * Edge routing for every edge that does not set its own `type`:
     * `bezier` (default), `smoothstep`, `step`, `straight`, `simplebezier`.
     * Also picks the shape of the line drawn WHILE connecting, which the
     * engine otherwise leaves as a bezier no matter what the edges look
     * like.
     */
    edgeType?: CanvasEdgeType;
    /**
     * Arrowheads on every edge: `closed` (default — a directed graph
     * without them is ambiguous), `open`, or `none`. React Flow ships no
     * marker by default and the Ember port ships no marker DEFINITIONS at
     * all; both are fixed here.
     */
    arrowheads?: 'closed' | 'open' | 'none';
    /** dash and travel every edge that does not set its own `animated` */
    animatedEdges?: boolean;
    /**
     * Drag on empty canvas to rubber-band select instead of panning, and
     * select on TOUCH rather than full enclosure. Panning stays available
     * on the pan-activation key (Space held while dragging) and through
     * the Controls, so this does not strand anyone — but say so in the UI,
     * because a canvas that stops panning under the pointer reads as
     * broken.
     */
    marquee?: boolean;
    /** snap dragged nodes to the background grid */
    snapToGrid?: boolean;
    /** component rendered inside every node; handles are added around it */
    nodeBody?: NodeBodyComponent;
    /** per-type node components, keyed by `node.type`, for mixed graphs */
    nodeTypes?: Record<string, unknown>;
    /** background pattern: `dots` (default), `lines`, `cross` or `none` */
    pattern?: 'dots' | 'lines' | 'cross' | 'none';
    /** grid spacing of the background pattern, in graph units */
    gap?: number;
    /** dot radius / cross arm length, in graph units */
    patternSize?: number;
    /** show the zoom / fit / lock control cluster (default true) */
    controls?: boolean;
    /** corner for the control cluster */
    controlsPosition?:
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right';
    /** lay the control cluster out horizontally instead of vertically */
    controlsHorizontal?: boolean;
    /** show the minimap (default true) */
    minimap?: boolean;
    /** corner for the minimap */
    minimapPosition?:
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right';
    /** frame the whole graph on first render (default true) */
    fitView?: boolean;
    /**
     * Allow node dragging. Defaults to true — EXCEPT on a controlled canvas
     * under `@autoLayout`, where the layout owns positions and a dragged
     * node would snap straight back. See the getter for the whole rule.
     */
    draggable?: boolean;
    /** allow drawing new edges from handles (default true) */
    connectable?: boolean;
    /** allow selecting nodes and edges (default true) */
    selectable?: boolean;
    /** height of the canvas frame; any CSS length (default `26rem`) */
    height?: string;
    /** where the text form of the graph goes (default `sr-only`) */
    summary?: 'sr-only' | 'visible' | 'off';
  };
  Blocks: {
    /**
     * anything extra inside the viewport — Panels, NodeToolbars, overlays.
     * Yields the engine store first (viewport, fitView, setCenter) and the
     * canvas's own API second (`relayout`, `focusNode`, `layout`).
     */
    default: [unknown, NodeCanvasApi];
    /** a floating top-start Panel: filters, mode switches, a title */
    toolbar: [];
    /** a floating top-end Panel: a key for the node hues */
    legend: [];
    /** shown centred when there are no nodes at all */
    empty: [];
  };
  Element: HTMLDivElement;
}

export class NodeCanvas extends Component<NodeCanvasSignature> {
  private summaryId = `pretui-canvas-summary-${(summarySeq += 1)}`;
  private rootId = `pretui-canvas-root-${summarySeq}`;

  // Uncontrolled mode holds its own copy so a bare <NodeCanvas @nodes>
  // drags out of the box; controlled mode never reads these.
  @tracked private localNodes: CanvasNode[] = seed(
    this.args.nodes ?? EMPTY_NODES,
    this.args.edges ?? EMPTY_EDGES,
    this.args.flow ?? 'horizontal',
    layoutOptionsFrom(this.args),
  );
  @tracked private localEdges: CanvasEdge[] = (
    this.args.edges ?? EMPTY_EDGES
  ).map((edge) => ({ ...edge }));

  /** The node the outline last sent focus to, so it can mark its own row. */
  @tracked private activeId: string | undefined = undefined;

  get isNodeControlled() {
    return typeof this.args.onNodesChange === 'function';
  }
  get isEdgeControlled() {
    return typeof this.args.onEdgesChange === 'function';
  }

  // Identity matters: the engine warns (error002) when the node array or
  // the nodeTypes object is a fresh object on every read, and Glimmer does
  // not cache getters. The memo lives in module-level WeakMaps keyed on the
  // caller's own array/object, so the getter stays free of side effects.
  get flow(): CanvasFlow {
    // Under @autoLayout the direction IS the flow — a graph laid out
    // downward whose handles point right draws every edge leaving the wrong
    // face of the node. Explicit @flow still wins.
    if (this.args.flow) {
      return this.args.flow;
    }
    let direction = this.args.autoLayout;
    if (direction) {
      return direction === 'down' || direction === 'up'
        ? 'vertical'
        : 'horizontal';
    }
    return 'horizontal';
  }

  get nodes(): CanvasNode[] {
    return this.isNodeControlled
      ? placedCached(
          this.args.nodes ?? EMPTY_NODES,
          this.args.edges ?? EMPTY_EDGES,
          this.flow,
          layoutOptionsFrom(this.args),
        )
      : this.localNodes;
  }

  /** The layout result for the graph as it is currently drawn, or undefined. */
  get layout(): GraphLayoutResult | undefined {
    if (!this.args.autoLayout) {
      return undefined;
    }
    return layoutCached(this.nodes, this.edges, layoutOptionsFrom(this.args))
      .result;
  }

  get edges(): CanvasEdge[] {
    return this.isEdgeControlled
      ? (this.args.edges ?? EMPTY_EDGES)
      : this.localEdges;
  }

  get nodeTypes(): Record<string, unknown> {
    return nodeTypesFor(this.args.nodeBody, this.args.nodeTypes);
  }

  canvas = getCanvas(this, {
    nodes: () => this.nodes,
    edges: () => this.edges,
  });

  handleNodesChange = (changes: unknown[]) => {
    if (this.args.onNodesChange) {
      this.args.onNodesChange(changes);
      return;
    }
    this.localNodes = applyNodeChanges(changes, this.localNodes);
  };

  handleEdgesChange = (changes: unknown[]) => {
    if (this.args.onEdgesChange) {
      this.args.onEdgesChange(changes);
      return;
    }
    this.localEdges = applyEdgeChanges(changes, this.localEdges);
  };

  handleConnect = (connection: unknown) => {
    this.args.onConnect?.(connection);
    if (!this.isEdgeControlled) {
      this.localEdges = addEdge(connection, this.localEdges);
    }
  };

  // ── The keyboard connection path ───────────────────────────────────────
  // Upstream has none: "there is NO keyboard path to create or reconnect an
  // edge" is a documented gap in React Flow and in this port. The outline
  // supplies it, and it funnels through the SAME `handleConnect` a pointer
  // drag uses, so a controlled canvas cannot tell the two apart.
  private connectFromOutline = (source: string, target: string) => {
    this.handleConnect({
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
    });
  };

  /**
   * Select a node and move keyboard focus onto it. Selection goes through
   * the engine's own change protocol rather than a store poke, so a
   * controlled canvas keeps control of its own selection state.
   *
   * `data-id` is compared rather than interpolated into a selector: a node
   * id is caller data and may contain quotes or brackets, which would break
   * an attribute selector — or worse, match the wrong node.
   */
  private focusNode = (id: string) => {
    this.activeId = id;
    this.handleNodesChange(
      this.nodes.map((node) => ({
        id: node.id,
        type: 'select',
        selected: node.id === id,
      })),
    );
    let root = document.getElementById(this.rootId);
    if (!root) {
      return;
    }
    let candidates = root.querySelectorAll<HTMLElement>('.boxel-canvas__node');
    for (let element of Array.from(candidates)) {
      if (element.dataset['id'] === id) {
        element.focus();
        return;
      }
    }
  };

  /**
   * Re-run the layout over the graph AS IT IS NOW, after drags. Uncontrolled
   * canvases replace their own copy; controlled ones get position changes in
   * the engine's own change vocabulary, so a caller's `applyNodeChanges`
   * reducer handles it with no special case.
   */
  private relayout = () => {
    let options = layoutOptionsFrom(this.args);
    if (!options.direction) {
      return;
    }
    let result = graphLayout(this.nodes, this.edges, {
      direction: options.direction,
      rankGap: options.rankGap,
      nodeGap: options.nodeGap,
      nodeWidth: options.nodeWidth,
      nodeHeight: options.nodeHeight,
    });
    let changes = result.placements.map((placement) => ({
      id: placement.id,
      type: 'position',
      position: { x: placement.x, y: placement.y },
      dragging: false,
    }));
    this.handleNodesChange(changes);
  };

  get api(): NodeCanvasApi {
    return {
      relayout: this.relayout,
      focusNode: this.focusNode,
      layout: this.layout,
    };
  }

  get autoLayoutOn() {
    return Boolean(this.args.autoLayout);
  }

  get relayoutAction() {
    return this.autoLayoutOn ? this.relayout : undefined;
  }

  get connectAction() {
    return this.connectable ? this.connectFromOutline : undefined;
  }

  get edgeType(): CanvasEdgeType {
    return this.args.edgeType ?? 'bezier';
  }

  get connectionLineType() {
    return CONNECTION_LINE_TYPE[this.edgeType] ?? 'default';
  }

  get arrowheads() {
    return this.args.arrowheads ?? 'closed';
  }

  /**
   * Spread onto every edge that does not set the same key itself, by the
   * engine's `applyDefaultEdgeOptions`. Identity-stable because the engine
   * spreads it into each edge on every read.
   */
  get defaultEdgeOptions(): Record<string, unknown> {
    return defaultEdgeOptionsFor(
      this.edgeType,
      this.arrowheads,
      this.args.animatedEdges ?? false,
    );
  }

  get marquee() {
    return this.args.marquee ?? false;
  }
  get selectionMode() {
    return this.marquee ? 'partial' : 'full';
  }
  get snapToGrid() {
    return this.args.snapToGrid ?? false;
  }
  get snapGrid(): [number, number] {
    return snapGridFor(this.gap);
  }

  get pattern() {
    return this.args.pattern ?? 'dots';
  }
  get showBackground() {
    return this.pattern !== 'none';
  }
  get gap() {
    return this.args.gap ?? 22;
  }
  get patternSize() {
    return this.args.patternSize ?? (this.pattern === 'cross' ? 6 : 1.4);
  }
  get showControls() {
    return this.args.controls ?? true;
  }
  get controlsPosition() {
    return this.args.controlsPosition ?? 'bottom-left';
  }
  get controlsOrientation() {
    return this.args.controlsHorizontal ? 'horizontal' : 'vertical';
  }
  get showMinimap() {
    return this.args.minimap ?? true;
  }
  get minimapPosition() {
    return this.args.minimapPosition ?? 'bottom-right';
  }
  get fitView() {
    return this.args.fitView ?? true;
  }
  /**
   * A CONTROLLED canvas under `@autoLayout` recomputes positions whenever
   * the nodes array changes identity — and a drag changes it — so the node
   * would snap back the instant it landed. Rather than ship that, dragging
   * is off by default in exactly that combination. `@draggable={{true}}`
   * forces it back on for a caller who wants the snap.
   *
   * An UNCONTROLLED canvas seeds from the layout once and then owns its own
   * positions, so dragging works normally there and the outline's "Tidy
   * layout" control puts everything back.
   */
  get draggable() {
    if (this.args.draggable !== undefined) {
      return this.args.draggable;
    }
    return !(this.autoLayoutOn && this.isNodeControlled);
  }
  get connectable() {
    return this.args.connectable ?? true;
  }
  get selectable() {
    return this.args.selectable ?? true;
  }
  get summaryMode() {
    return this.args.summary ?? 'sr-only';
  }
  get showSummary() {
    return this.summaryMode !== 'off';
  }
  get describedBy() {
    return this.showSummary ? this.summaryId : undefined;
  }
  get isEmpty() {
    return this.nodes.length === 0;
  }
  get frameStyle() {
    return cssStyle('--pretui-canvas-height', this.args.height);
  }
  get minimapLabel() {
    return `Minimap of ${this.args.label}`;
  }

  /** `off` renders no mirror at all; otherwise GraphOutline owns the text. */
  get outlineMode(): 'sr-only' | 'visible' {
    return this.summaryMode === 'visible' ? 'visible' : 'sr-only';
  }

  <template>
    <div
      id={{this.rootId}}
      class='pretui-node-canvas'
      style={{this.frameStyle}}
      data-pattern={{this.pattern}}
      data-summary={{this.summaryMode}}
      data-layout={{if this.autoLayoutOn @autoLayout 'free'}}
      data-test-pretui-node-canvas
      {{canvasStylesheet}}
      ...attributes
    >
      <Canvas
        @canvas={{this.canvas}}
        @nodes={{this.nodes}}
        @edges={{this.edges}}
        @nodeTypes={{this.nodeTypes}}
        @defaultEdgeOptions={{this.defaultEdgeOptions}}
        @connectionLineType={{this.connectionLineType}}
        @onNodesChange={{this.handleNodesChange}}
        @onEdgesChange={{this.handleEdgesChange}}
        @onConnect={{this.handleConnect}}
        @fitView={{this.fitView}}
        @nodesDraggable={{this.draggable}}
        @nodesConnectable={{this.connectable}}
        @elementsSelectable={{this.selectable}}
        @selectionOnDrag={{this.marquee}}
        @selectionMode={{this.selectionMode}}
        @snapToGrid={{this.snapToGrid}}
        @snapGrid={{this.snapGrid}}
        {{! @glint-expect-error - the vendored Canvas bundle declares no element type }}
        aria-label={{@label}}
        aria-describedby={{this.describedBy}}
        as |store|
      >
        {{#if this.showBackground}}
          <Background
            @variant={{this.pattern}}
            @gap={{this.gap}}
            @size={{this.patternSize}}
            @patternColor='var(--pretui-canvas-grid-ink, color-mix(in oklch, var(--foreground) 22%, transparent))'
          />
        {{/if}}

        {{#if (has-block 'toolbar')}}
          <Panel @position='top-left'>
            <div class='pnv-bar'>{{yield to='toolbar'}}</div>
          </Panel>
        {{/if}}

        {{#if (has-block 'legend')}}
          <Panel @position='top-right'>
            <div class='pnv-bar'>{{yield to='legend'}}</div>
          </Panel>
        {{/if}}

        {{#if this.showControls}}
          <Controls
            @position={{this.controlsPosition}}
            @orientation={{this.controlsOrientation}}
          />
        {{/if}}

        {{#if this.showMinimap}}
          <MiniMap
            @position={{this.minimapPosition}}
            @ariaLabel={{this.minimapLabel}}
            @bgColor='var(--pretui-canvas-minimap-bg, var(--card))'
            @maskColor='var(--pretui-canvas-minimap-mask, color-mix(in oklch, var(--muted) 78%, transparent))'
            @nodeColor='var(--pretui-canvas-minimap-node, color-mix(in oklch, var(--foreground) 24%, var(--card)))'
          />
        {{/if}}

        {{yield store this.api}}
      </Canvas>

      {{#if this.isEmpty}}
        <div class='pnv-empty'>
          {{#if (has-block 'empty')}}
            {{yield to='empty'}}
          {{else}}
            <p class='pnv-empty-line'>No nodes to draw.</p>
          {{/if}}
        </div>
      {{/if}}

      {{!-- The graph as text. GraphOutline is a separate module — see its
            header for why — and it is the ONLY route to a node, an edge or
            a new connection that does not require a pointer. --}}
      {{#if this.showSummary}}
        <GraphOutline
          @outlineId={{this.summaryId}}
          @nodes={{this.nodes}}
          @edges={{this.edges}}
          @label={{@label}}
          @mode={{this.outlineMode}}
          @activeId={{this.activeId}}
          @onSelect={{this.focusNode}}
          @onConnect={{this.connectAction}}
          @onRelayout={{this.relayoutAction}}
          data-test-pretui-node-canvas-summary
        />
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        /* Every colour the engine reads lives in its `--xy-*` channel, so
           the whole re-skin happens here — inherited into the engine's
           subtree, no selector ever reaching into its markup. Each one is
           fronted by a `--pretui-canvas-*` knob so a consumer can retune a
           single part without forking. */
        .pretui-node-canvas {
          position: relative;
          height: var(--pretui-canvas-height, 26rem);
          min-height: var(--pretui-canvas-min-height, 12rem);
          border-radius: var(--pretui-canvas-radius, var(--radius-surface, 10px));
          overflow: hidden;
          background: var(--pretui-canvas-bg, var(--card));
          font-family: var(--font-sans);
          /* Law 1 — the frame is a hairline plus a shadow, one property. */
          box-shadow: var(
            --pretui-canvas-shadow,
            var(--pretui-shadow-card, 0 0 0 1px var(--border), 0 1px 2px
                rgb(0 0 0 / 0.12))
          );

          --xy-background-color: transparent;
          --xy-background-pattern-color: var(
            --pretui-canvas-grid-ink,
            color-mix(in oklch, var(--foreground) 22%, transparent)
          );

          --xy-edge-stroke: var(
            --pretui-canvas-edge,
            color-mix(in oklch, var(--foreground) 34%, transparent)
          );
          --xy-edge-stroke-width: var(--pretui-canvas-edge-width, 1.5);
          --xy-edge-stroke-selected: var(
            --pretui-canvas-edge-selected,
            var(--primary)
          );
          --xy-edge-label-background-color: var(--card);
          --xy-edge-label-color: var(--card-foreground);

          --xy-connectionline-stroke: var(
            --pretui-canvas-edge-selected,
            var(--primary)
          );
          --xy-connectionline-stroke-width: 1.5;

          --xy-handle-background-color: var(
            --pretui-handle-bg,
            var(--card)
          );
          --xy-handle-border-color: var(
            --pretui-handle-border,
            color-mix(in oklch, var(--foreground) 40%, transparent)
          );

          /* the stock node treatment, in case a caller mixes in an
             untyped engine node alongside Pretui ones */
          --xy-node-background-color: var(--card);
          --xy-node-color: var(--card-foreground);
          --xy-node-border: none;
          --xy-node-border-selected: none;
          --xy-node-border-radius: var(
            --pretui-node-radius,
            var(--radius-surface, 10px)
          );
          --xy-node-boxshadow-hover: 0 0 0 1px var(--border),
            0 2px 8px rgb(0 0 0 / 0.12);
          --xy-node-boxshadow-selected: 0 0 0 1px var(--primary),
            0 0 0 4px color-mix(in oklch, var(--primary) 18%, transparent);

          --xy-selection-background-color: color-mix(
            in oklch,
            var(--primary) 10%,
            transparent
          );
          --xy-selection-border: 1px dashed
            color-mix(in oklch, var(--primary) 55%, transparent);

          --xy-controls-box-shadow: var(
            --pretui-canvas-chrome-shadow,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.12)
          );
          --xy-controls-button-background-color: var(--card);
          --xy-controls-button-background-color-hover: var(--muted);
          --xy-controls-button-border-color: var(--border);
          --xy-controls-button-color: var(--muted-foreground);
          --xy-controls-button-color-hover: var(--foreground);

          --xy-minimap-background-color: var(--card);
          --xy-minimap-mask-background-color: color-mix(
            in oklch,
            var(--muted) 78%,
            transparent
          );
          --xy-minimap-node-background-color: color-mix(
            in oklch,
            var(--foreground) 24%,
            var(--card)
          );

          --xy-attribution-background-color: transparent;
        }

        /* Floating Panel contents — the toolbar and legend slots. Pretui
           cloth on a surface the engine only positions. */
        .pnv-bar {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          padding: var(--space-2, 5px) var(--space-3, 8px);
          border-radius: var(--pretui-canvas-chrome-radius, 8px);
          background: var(--pretui-canvas-panel-bg, var(--card));
          color: var(--card-foreground);
          font-size: var(--text-ui-sm, 11.5px);
          box-shadow: var(
            --pretui-canvas-chrome-shadow,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.12)
          );
        }

        .pnv-empty {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          pointer-events: none;
          padding: var(--space-6, 18px);
          text-align: center;
        }

        .pnv-empty-line {
          margin: 0;
          font-size: var(--text-ui-md, 12.5px);
          color: var(--muted-foreground);
        }

        /* The text mirror lives in GraphOutline now, which owns its own
           scoped CSS (scoped CSS does not cross a component boundary). All
           that stays here is the KNOB the skin sheet reads to lift the
           engine's bottom-corner panels clear of the strip. */
      }
    </style>
  </template>
}

/** Node name for the text summary and for the engine's per-node aria-label. */
function nameOf(node: CanvasNode): string {
  let data = node.data ?? {};
  return (
    node.ariaLabel ??
    data.title ??
    (typeof data.label === 'string' ? data.label : undefined) ??
    node.id
  );
}

/**
 * Point every node at Pretui's node shell, pin the handle sides so the
 * engine's edge geometry lands on the handles the shell actually draws,
 * and give the node a screen-reader name. The engine's own fallback name
 * is the raw node id, which is meaningless out loud; this fills it from
 * the data before the id is ever reached. `data` is defaulted because the
 * engine's stock label getter reads `node.data['label']` unguarded.
 */
function decorate(
  nodes: CanvasNode[],
  flow: CanvasFlow,
  placements?: Map<string, { x: number; y: number }>,
  sidesOverride?: { source: CanvasNode['sourcePosition']; target: CanvasNode['targetPosition'] },
): CanvasNode[] {
  let sides = sidesOverride ?? FLOW_SIDES[flow] ?? FLOW_SIDES.horizontal;
  return nodes.map((node) => {
    let placed = placements?.get(node.id);
    return {
      ...node,
      type: node.type ?? 'pretui',
      data: node.data ?? {},
      position: placed ?? node.position,
      sourcePosition: node.sourcePosition ?? sides.source,
      targetPosition: node.targetPosition ?? sides.target,
      ariaLabel: nameOf(node),
    };
  });
}

// ── Auto-layout plumbing ─────────────────────────────────────────────────
// `graphLayout` is a pure function; everything below is only about keeping
// its result IDENTITY-STABLE. The engine warns (error002) when the node
// array is a fresh object on every read, and Glimmer does not cache
// getters, so the memo lives in module-level WeakMaps keyed on the caller's
// own arrays. A getter can therefore read it without writing to `this`
// (ember/no-side-effects).

/** The subset of the args that changes a layout. */
export interface CanvasLayoutOptions {
  direction?: GraphDirection;
  rankGap?: number;
  nodeGap?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

function layoutOptionsFrom(args: {
  autoLayout?: GraphDirection;
  rankGap?: number;
  nodeGap?: number;
  layoutNodeWidth?: number;
  layoutNodeHeight?: number;
}): CanvasLayoutOptions {
  return {
    direction: args.autoLayout,
    rankGap: args.rankGap,
    nodeGap: args.nodeGap,
    nodeWidth: args.layoutNodeWidth,
    nodeHeight: args.layoutNodeHeight,
  };
}

function layoutKey(options: CanvasLayoutOptions): string {
  return [
    options.direction ?? '-',
    options.rankGap ?? '-',
    options.nodeGap ?? '-',
    options.nodeWidth ?? '-',
    options.nodeHeight ?? '-',
  ].join('|');
}

const NO_LAYOUT: { result: GraphLayoutResult | undefined } = {
  result: undefined,
};

const LAYOUT_CACHE = new WeakMap<
  object,
  WeakMap<object, Map<string, { result: GraphLayoutResult | undefined }>>
>();

function layoutCached(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  options: CanvasLayoutOptions,
): { result: GraphLayoutResult | undefined } {
  if (!options.direction) {
    return NO_LAYOUT;
  }
  let byEdges = LAYOUT_CACHE.get(nodes as unknown as object);
  if (!byEdges) {
    byEdges = new WeakMap();
    LAYOUT_CACHE.set(nodes as unknown as object, byEdges);
  }
  let byKey = byEdges.get(edges as unknown as object);
  if (!byKey) {
    byKey = new Map();
    byEdges.set(edges as unknown as object, byKey);
  }
  let key = layoutKey(options);
  let hit = byKey.get(key);
  if (!hit) {
    hit = {
      result: graphLayout(nodes, edges, {
        direction: options.direction,
        rankGap: options.rankGap,
        nodeGap: options.nodeGap,
        nodeWidth: options.nodeWidth,
        nodeHeight: options.nodeHeight,
      }),
    };
    byKey.set(key, hit);
  }
  return hit;
}

/** Decorate, and place from the layout when `@autoLayout` is on. */
function place(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  flow: CanvasFlow,
  options: CanvasLayoutOptions,
): CanvasNode[] {
  let laid = layoutCached(nodes, edges, options).result;
  if (!laid || !options.direction) {
    return decorate(nodes, flow);
  }
  let positions = new Map<string, { x: number; y: number }>();
  for (let placement of laid.placements) {
    positions.set(placement.id, { x: placement.x, y: placement.y });
  }
  return decorate(nodes, flow, positions, handleSidesFor(options.direction));
}

/** The uncontrolled canvas's one-time seed. Never shared with the memo. */
function seed(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  flow: CanvasFlow,
  options: CanvasLayoutOptions,
): CanvasNode[] {
  return place(nodes, edges, flow, options);
}

// Keyed on (flow, nodes identity, edges identity, option string). The edges
// arm matters: adding one edge replaces the edges array and nothing else,
// and a layout that ignored it would keep drawing the previous shape.
const PLACED_CACHE: Record<
  CanvasFlow,
  WeakMap<object, WeakMap<object, Map<string, CanvasNode[]>>>
> = {
  horizontal: new WeakMap(),
  vertical: new WeakMap(),
};

function placedCached(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  flow: CanvasFlow,
  options: CanvasLayoutOptions,
): CanvasNode[] {
  let cache = PLACED_CACHE[flow] ?? PLACED_CACHE.horizontal;
  let byEdges = cache.get(nodes as unknown as object);
  if (!byEdges) {
    byEdges = new WeakMap();
    cache.set(nodes as unknown as object, byEdges);
  }
  let byKey = byEdges.get(edges as unknown as object);
  if (!byKey) {
    byKey = new Map();
    byEdges.set(edges as unknown as object, byKey);
  }
  let key = layoutKey(options);
  let hit = byKey.get(key);
  if (!hit) {
    hit = place(nodes, edges, flow, options);
    byKey.set(key, hit);
  }
  return hit;
}

const NO_EXTRA_TYPES: Record<string, unknown> = {};
const TYPES_CACHE = new WeakMap<
  object,
  WeakMap<object, Record<string, unknown>>
>();

function nodeTypesFor(
  body: NodeBodyComponent | undefined,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  let shell = shellFor(
    body ?? (NodeCard as unknown as NodeBodyComponent),
  ) as object;
  let byExtra = TYPES_CACHE.get(shell);
  if (!byExtra) {
    byExtra = new WeakMap();
    TYPES_CACHE.set(shell, byExtra);
  }
  let key = (extra ?? NO_EXTRA_TYPES) as object;
  let hit = byExtra.get(key);
  if (!hit) {
    hit = { pretui: shell, ...(extra ?? {}) };
    byExtra.set(key, hit);
  }
  return hit;
}
