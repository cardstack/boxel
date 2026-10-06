// Pretui — NodeCanvas usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Chip } from './chip';
import { Token } from './token';
import { statusHue } from '../internal/ink';
import { NodeCanvas } from './node-canvas';
import type { CanvasFlow } from './node-canvas';
import type { CanvasEdge, CanvasNode } from '../internal/surfaces-canvas';
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from '../surfaces/canvas/index.js';
import { NO_NODES, SUMMARIES } from '../internal/surfaces-canvas-fixtures';

// ── NodeCanvas ───────────────────────────────────────────────────────────
// Stage index and lane are stored rather than raw coordinates so the
// `@flow` knob can transpose the whole layout without inventing numbers.
interface GraphSpec {
  id: string;
  stage: number;
  lane: number;
  title: string;
  kind: string;
  meta: string;
  status: string;
}

const GRAPH: GraphSpec[] = [
  {
    id: 'sup-wuyi',
    stage: 0,
    lane: 0.4,
    title: 'Wuyi Origins',
    kind: 'SUP-014',
    meta: 'Wuyishan · direct contract',
    status: 'contracted',
  },
  {
    id: 'sup-uji',
    stage: 0,
    lane: 2.1,
    title: 'Uji Valley Growers',
    kind: 'SUP-031',
    meta: 'Uji · cooperative',
    status: 'sourcing',
  },
  {
    id: 'lot-dahongpao',
    stage: 1,
    lane: 0,
    title: 'Da Hong Pao',
    kind: 'LOT-1181',
    meta: '96 kg · spring pick',
    status: 'curing',
  },
  {
    id: 'lot-silverneedle',
    stage: 1,
    lane: 1.2,
    title: 'Silver Needle',
    kind: 'LOT-1213',
    meta: '11.2 kg · first flush',
    status: 'graded',
  },
  {
    id: 'lot-gyokuro',
    stage: 1,
    lane: 2.4,
    title: 'Gyokuro',
    kind: 'LOT-1207',
    meta: '48 crates · shade grown',
    status: 'cupping',
  },
  {
    id: 'shp-rotterdam',
    stage: 2,
    lane: 0.5,
    title: 'Rotterdam',
    kind: 'SHP-0447',
    meta: 'ETA 2026-05-07',
    status: 'in transit',
  },
  {
    id: 'shp-osaka',
    stage: 2,
    lane: 2.2,
    title: 'Osaka',
    kind: 'SHP-0452',
    meta: 'awaiting paperwork',
    status: 'held',
  },
];

const GRAPH_EDGES: CanvasEdge[] = [
  { id: 'e-wuyi-dhp', source: 'sup-wuyi', target: 'lot-dahongpao' },
  { id: 'e-wuyi-sn', source: 'sup-wuyi', target: 'lot-silverneedle' },
  { id: 'e-uji-gyo', source: 'sup-uji', target: 'lot-gyokuro' },
  {
    id: 'e-dhp-rot',
    source: 'lot-dahongpao',
    target: 'shp-rotterdam',
    label: 'sea',
    animated: true,
  },
  { id: 'e-sn-rot', source: 'lot-silverneedle', target: 'shp-rotterdam' },
  {
    id: 'e-gyo-osa',
    source: 'lot-gyokuro',
    target: 'shp-osaka',
    label: 'air',
    animated: true,
  },
];

function buildNodes(flow: CanvasFlow): CanvasNode[] {
  return GRAPH.map((spec) => ({
    id: spec.id,
    position:
      flow === 'vertical'
        ? { x: spec.lane * 235, y: spec.stage * 200 }
        : { x: spec.stage * 285, y: spec.lane * 135 },
    data: {
      title: spec.title,
      kind: spec.kind,
      meta: spec.meta,
      status: spec.status,
    },
  }));
}

function buildEdges(): CanvasEdge[] {
  return GRAPH_EDGES.map((edge) => ({ ...edge }));
}

// Stable identities for the empty state, so toggling it does not churn
// the arrays the engine keys its node lookup on.

const NO_EDGES: CanvasEdge[] = [];

const PATTERNS = ['dots', 'lines', 'cross', 'none'];

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

const FLOWS = ['horizontal', 'vertical'];

// Ported from @cardstack/boxel-canvas (a Glimmer port of xyflow / React
// Flow). Knob set follows the React Flow `<ReactFlow>` prop surface where
// it maps: nodes/edges, background variant + gap + size, controls and
// minimap placement, nodesDraggable / nodesConnectable /
// elementsSelectable, fitView. Dropped from that surface, deliberately:
// the viewport/translateExtent/snapGrid/zoom-limit family (engine-level
// tuning that belongs to the caller's `getCanvas`, not to the cloth), the
// twelve per-element pointer callbacks (onNodeClick, onNodeMouseEnter,
// …), and `colorMode='dark'` — Pretui never branches on dark, the tokens
// do it.
class NodeCanvasUsage extends Component {
  patternOptions = PATTERNS;
  cornerOptions = CORNERS;
  flowOptions = FLOWS;
  summaryOptions = SUMMARIES;

  @tracked label = 'Spring 2026 tea supply chain';
  @tracked flow = 'horizontal';
  @tracked pattern = 'dots';
  @tracked gap = 22;
  @tracked patternSize = 1.4;
  @tracked controls = true;
  @tracked controlsPosition = 'bottom-left';
  @tracked controlsHorizontal = false;
  @tracked minimap = true;
  @tracked minimapPosition = 'bottom-right';
  @tracked draggable = true;
  @tracked connectable = true;
  @tracked selectable = true;
  @tracked height = '26rem';
  @tracked summary = 'sr-only';
  @tracked emptyState = false;

  @tracked nodes: CanvasNode[] = buildNodes('horizontal');
  @tracked edges: CanvasEdge[] = buildEdges();

  // Controlled wiring: the engine reports changes, the page owns the
  // arrays. `applyNodeChanges` / `applyEdgeChanges` / `addEdge` are the
  // engine's own reducers, re-exported from the realm bundle.
  onNodesChange = (changes: unknown[]) => {
    this.nodes = applyNodeChanges(changes, this.nodes);
  };
  onEdgesChange = (changes: unknown[]) => {
    this.edges = applyEdgeChanges(changes, this.edges);
  };
  onConnect = (connection: unknown) => {
    this.edges = addEdge(connection, this.edges);
  };

  setLabel = (v: string) => (this.label = v);
  setFlow = (v: string) => {
    this.flow = v;
    // Rebuild once, on the knob — never inside a getter, so the array
    // identity the engine keys on stays stable between renders.
    this.nodes = buildNodes(v as CanvasFlow);
  };
  setPattern = (v: string) => (this.pattern = v);
  setGap = (v: number | null) => (this.gap = v ?? 22);
  setPatternSize = (v: number | null) => (this.patternSize = v ?? 1.4);
  setControls = (v: boolean) => (this.controls = v);
  setControlsPosition = (v: string) => (this.controlsPosition = v);
  setControlsHorizontal = (v: boolean) => (this.controlsHorizontal = v);
  setMinimap = (v: boolean) => (this.minimap = v);
  setMinimapPosition = (v: string) => (this.minimapPosition = v);
  setDraggable = (v: boolean) => (this.draggable = v);
  setConnectable = (v: boolean) => (this.connectable = v);
  setSelectable = (v: boolean) => (this.selectable = v);
  setHeight = (v: string) => (this.height = v);
  setSummary = (v: string) => (this.summary = v);
  setEmptyState = (v: boolean) => (this.emptyState = v);

  get flowVal() {
    return this.flow as CanvasFlow;
  }
  get patternVal() {
    return this.pattern as 'dots' | 'lines' | 'cross' | 'none';
  }
  get controlsPositionVal() {
    return this.controlsPosition as
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right';
  }
  get minimapPositionVal() {
    return this.minimapPosition as
      | 'top-left'
      | 'top-right'
      | 'bottom-left'
      | 'bottom-right';
  }
  get summaryVal() {
    return this.summary as 'sr-only' | 'visible' | 'off';
  }
  get canvasNodes() {
    return this.emptyState ? NO_NODES : this.nodes;
  }
  get canvasEdges() {
    return this.emptyState ? NO_EDGES : this.edges;
  }

  /** Hues are derived from the status string, so the key cannot drift. */
  get legend() {
    return ['contracted', 'curing', 'in transit', 'held'].map((status) => ({
      status,
      hue: statusHue(status),
    }));
  }

  get usage() {
    let bits = [
      `@label='${this.label}'`,
      '@nodes={{this.nodes}}',
      '@edges={{this.edges}}',
      '@onNodesChange={{this.onNodesChange}}',
      '@onEdgesChange={{this.onEdgesChange}}',
      '@onConnect={{this.onConnect}}',
    ];
    if (this.flow !== 'horizontal') bits.push(`@flow='${this.flow}'`);
    if (this.pattern !== 'dots') bits.push(`@pattern='${this.pattern}'`);
    if (this.gap !== 22) bits.push(`@gap={{${this.gap}}}`);
    if (!this.controls) bits.push('@controls={{false}}');
    if (!this.minimap) bits.push('@minimap={{false}}');
    if (this.summary !== 'sr-only') bits.push(`@summary='${this.summary}'`);
    if (this.height !== '26rem') bits.push(`@height='${this.height}'`);
    return `<NodeCanvas\n  ${bits.join('\n  ')}\n>\n  <:toolbar>…</:toolbar>\n  <:legend>…</:legend>\n  <:empty>…</:empty>\n</NodeCanvas>`;
  }

  <template>
    <FreestyleUsage
      @name='NodeCanvas'
      @description="An infinite pan/zoom node graph — drag nodes, draw edges between handles, ride the minimap — for supply chains, pipelines, dependency maps and flow editors. Wraps the boxel-canvas engine (xyflow ported to Glimmer): the engine keeps pointer capture, viewport transforms and edge routing; Pretui supplies the cloth. Node content is a component slot (@nodeBody), never a label string, and the handles are drawn for you. ACCESSIBILITY, honestly: the canvas root is role=application with a real accessible name, every node is focusable, Tab walks the graph, Enter activates, arrows move or nudge the selection, Delete removes it and Escape clears it — but there is NO keyboard path to create or reconnect an edge, pan and zoom are reachable only through the Controls buttons, and the engine listens for those keys on the window, so a canvas takes the page's keys while it is mounted. Give it a page of its own, keep @summary on (the graph rendered as a real list, sr-only by default), and ship a non-canvas editing path if the graph is editable."
      @source={{this.usage}}
    >
      <:example>
        <NodeCanvas
          @label={{this.label}}
          @nodes={{this.canvasNodes}}
          @edges={{this.canvasEdges}}
          @onNodesChange={{this.onNodesChange}}
          @onEdgesChange={{this.onEdgesChange}}
          @onConnect={{this.onConnect}}
          @flow={{this.flowVal}}
          @pattern={{this.patternVal}}
          @gap={{this.gap}}
          @patternSize={{this.patternSize}}
          @controls={{this.controls}}
          @controlsPosition={{this.controlsPositionVal}}
          @controlsHorizontal={{this.controlsHorizontal}}
          @minimap={{this.minimap}}
          @minimapPosition={{this.minimapPositionVal}}
          @draggable={{this.draggable}}
          @connectable={{this.connectable}}
          @selectable={{this.selectable}}
          @height={{this.height}}
          @summary={{this.summaryVal}}
        >
          <:toolbar>
            <span class='canvas-bar-title'>Spring 2026</span>
            <Token @value='7 lots' />
          </:toolbar>
          <:legend>
            {{#each this.legend key='status' as |item|}}
              <Chip @label={{item.status}} @hue={{item.hue}} />
            {{/each}}
          </:legend>
          <:empty>
            <p class='canvas-empty'>No lots booked for this window yet.</p>
          </:empty>
        </NodeCanvas>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @required={{true}}
          @value={{this.label}}
          @onInput={{this.setLabel}}
          @description='Accessible name for the canvas. Required — the engine root is a role=application, which is silent without one.'
        />
        <Args.Object
          @name='nodes'
          @value={{this.canvasNodes}}
          @description='CanvasNode[] — { id, position: {x,y}, data, type?, width?, height?, ariaLabel? }. Uncontrolled canvases SEED from this once and then own their copy; pass @onNodesChange to keep control.'
        />
        <Args.Object
          @name='edges'
          @value={{this.canvasEdges}}
          @description='CanvasEdge[] — { id, source, target, label?, animated? }. Animated edges dash their stroke, and stop dead under prefers-reduced-motion.'
        />
        <Args.String
          @name='flow'
          @options={{this.flowOptions}}
          @value={{this.flow}}
          @defaultValue='horizontal'
          @onInput={{this.setFlow}}
          @description='Which sides connectors leave from for nodes that set no position of their own. Sets the DRAWN handles and the ENGINE edge endpoints together — upstream lets those two disagree, which is why stock React Flow graphs with custom nodes sprout edges from the wrong side.'
        />
        <Args.String
          @name='pattern'
          @options={{this.patternOptions}}
          @value={{this.pattern}}
          @defaultValue='dots'
          @onInput={{this.setPattern}}
          @description='Background pattern: dots, lines, cross, or none. Chrome only — it never carries information (Law 6).'
        />
        <Args.Number
          @name='gap'
          @min={{8}}
          @max={{64}}
          @step={{1}}
          @value={{this.gap}}
          @defaultValue={{22}}
          @onInput={{this.setGap}}
          @description='Grid spacing of the background pattern, in graph units.'
        />
        <Args.Number
          @name='patternSize'
          @min={{0.5}}
          @max={{10}}
          @step={{0.5}}
          @value={{this.patternSize}}
          @defaultValue={{1.4}}
          @onInput={{this.setPatternSize}}
          @description='Dot radius, or cross arm length, in graph units. Defaults to 6 for the cross pattern.'
        />
        <Args.Bool
          @name='controls'
          @value={{this.controls}}
          @defaultValue={{true}}
          @onInput={{this.setControls}}
          @description='Show the zoom / fit / lock cluster. These are real buttons with labels, and the only keyboard route to pan or zoom — turning them off removes it.'
        />
        <Args.String
          @name='controlsPosition'
          @options={{this.cornerOptions}}
          @value={{this.controlsPosition}}
          @defaultValue='bottom-left'
          @onInput={{this.setControlsPosition}}
          @description='Corner the control cluster docks to.'
        />
        <Args.Bool
          @name='controlsHorizontal'
          @value={{this.controlsHorizontal}}
          @defaultValue={{false}}
          @onInput={{this.setControlsHorizontal}}
          @description='Lay the control cluster out in a row instead of a column.'
        />
        <Args.Bool
          @name='minimap'
          @value={{this.minimap}}
          @defaultValue={{true}}
          @onInput={{this.setMinimap}}
          @description='Show the minimap. Pointer-only: it is a click target, never a keyboard one.'
        />
        <Args.String
          @name='minimapPosition'
          @options={{this.cornerOptions}}
          @value={{this.minimapPosition}}
          @defaultValue='bottom-right'
          @onInput={{this.setMinimapPosition}}
          @description='Corner the minimap docks to.'
        />
        <Args.Bool
          @name='draggable'
          @value={{this.draggable}}
          @defaultValue={{true}}
          @onInput={{this.setDraggable}}
          @description='Allow dragging nodes with the pointer.'
        />
        <Args.Bool
          @name='connectable'
          @value={{this.connectable}}
          @defaultValue={{true}}
          @onInput={{this.setConnectable}}
          @description='Allow drawing new edges by dragging from a handle. Pointer-only in this engine — there is no keyboard equivalent.'
        />
        <Args.Bool
          @name='selectable'
          @value={{this.selectable}}
          @defaultValue={{true}}
          @onInput={{this.setSelectable}}
          @description='Allow selecting nodes and edges.'
        />
        <Args.String
          @name='height'
          @value={{this.height}}
          @defaultValue='26rem'
          @onInput={{this.setHeight}}
          @description='Height of the canvas frame; any CSS length. The frame never collapses below --pretui-canvas-min-height (12rem).'
        />
        <Args.String
          @name='summary'
          @options={{this.summaryOptions}}
          @value={{this.summary}}
          @defaultValue='sr-only'
          @onInput={{this.setSummary}}
          @description="The graph as text — one line per node and where its outgoing edges land — wired to the canvas through aria-describedby. 'sr-only' (default) leaves the still frame unchanged, 'visible' draws it as a caption strip and lifts the bottom chrome above it, 'off' removes it. Leave it on."
        />
        <Args.Bool
          @name='empty state (demo only)'
          @value={{this.emptyState}}
          @defaultValue={{false}}
          @onInput={{this.setEmptyState}}
          @description='Not a component arg — swaps the demo to an empty node array so the <:empty> block is visible.'
        />
        <Args.Bool
          @name='fitView'
          @defaultValue={{true}}
          @hideControls={{true}}
          @description='Frame the whole graph on first render. Read once at mount; changing it later does nothing — use the fit-view control button instead.'
        />
        <Args.Component
          @name='nodeBody'
          @defaultValue='NodeCard'
          @hideControls={{true}}
          @description='Component rendered inside every node, receiving @node @id @data @selected @dragging. The shell draws the source and target handles around whatever you pass, so a custom body never has to remember them — the omission that detaches edges in stock React Flow.'
        />
        <Args.Object
          @name='nodeTypes'
          @hideControls={{true}}
          @description="Extra per-type node components keyed by node.type, for mixed graphs. Pretui's own shell is always registered under the 'pretui' key."
        />
        <Args.Action
          @name='onNodesChange'
          @hideControls={{true}}
          @description='Takes control of node changes (drag, select, remove). Pass it with applyNodeChanges to own the array; omit it and the canvas drags out of the box.'
        />
        <Args.Action
          @name='onEdgesChange'
          @hideControls={{true}}
          @description='Takes control of edge changes. Same contract, with applyEdgeChanges.'
        />
        <Args.Action
          @name='onConnect'
          @hideControls={{true}}
          @description='Fires when a handle drag completes. An uncontrolled canvas adds the edge itself; a controlled one must call addEdge, as this page does.'
        />
        <Args.Yield
          @name='default'
          @hideControls={{true}}
          @description='Rendered inside the viewport with the engine store yielded — extra Panels, NodeToolbars, overlays.'
        />
        <Args.Yield
          @name='toolbar'
          @hideControls={{true}}
          @description='A floating top-start panel: a title, filters, a mode switch.'
        />
        <Args.Yield
          @name='legend'
          @hideControls={{true}}
          @description='A floating top-end panel — here, the status hue key. The hues are derived from the status strings, so the key can never drift from the nodes.'
        />
        <Args.Yield
          @name='empty'
          @hideControls={{true}}
          @description='Shown centred when there are no nodes at all. Defaults to a plain line of copy.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-canvas-height'
          @defaultValue='26rem'
          @description='Frame height, if you would rather set it in CSS than through @height.'
        />
        <Css.Basic
          @name='pretui-canvas-grid-ink'
          @description='Background pattern colour. Defaults to 22% of the foreground token.'
        />
        <Css.Basic
          @name='pretui-canvas-edge'
          @description='Resting edge stroke. --pretui-canvas-edge-selected and --pretui-canvas-edge-width tune the rest.'
        />
        <Css.Basic
          @name='pretui-canvas-chrome-shadow'
          @description='Depth for the controls, minimap and floating panels — hairline plus shadow, one property (Law 1).'
        />
        <Css.Basic
          @name='pretui-canvas-summary-height'
          @defaultValue='8rem'
          @description="Height of the visible summary strip. The engine's bottom-corner panels lift by exactly this much."
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .canvas-bar-title {
        font-weight: 600;
        color: var(--card-foreground);
      }
      .canvas-empty {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_NODE_CANVAS: Record<string, unknown> = {
  NodeCanvas: NodeCanvasUsage,
};
