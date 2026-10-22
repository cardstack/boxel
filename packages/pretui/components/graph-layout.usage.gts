// Pretui — GraphLayout usage page.
import { SUMMARIES } from '../internal/surfaces-canvas-fixtures';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { CanvasEdge, CanvasNode } from '../internal/surfaces-canvas';
import { graphLayout } from '../surfaces-canvas-layout';
import type { GraphDirection } from '../surfaces-canvas-layout';
import { addEdge, applyEdgeChanges, applyNodeChanges } from '../surfaces/canvas/index.js';
import { FreestyleUsage } from './freestyle-usage';
import { NodeCanvas } from './node-canvas';
import type { CanvasEdgeType } from './node-canvas';
import { Token } from './token';


// ── GraphLayout ──────────────────────────────────────────────────────────
// The auto-layout page. Its fixture carries NO POSITIONS AT ALL — that is
// the whole demonstration: `@autoLayout` is what puts the nodes anywhere.
//
// The graph is a release pipeline with a deliberate CYCLE in it
// ("regressions" feeds back into "build"), because a cycle is what every
// naive layered layout hangs on. `graphLayout` breaks it, reports which
// edge it reversed, and the page prints that alongside the crossing counts
// so the pass is legible rather than magic.

interface StageSpec {
  id: string;
  title: string;
  kind: string;
  meta: string;
  status: string;
}

const PIPELINE: StageSpec[] = [
  { id: 'commit', title: 'Commit', kind: 'SRC', meta: 'main', status: 'merged' },
  { id: 'lint', title: 'Lint', kind: 'JOB-01', meta: '38s', status: 'passing' },
  { id: 'types', title: 'Typecheck', kind: 'JOB-02', meta: '1m 12s', status: 'passing' },
  { id: 'build', title: 'Build', kind: 'JOB-03', meta: '4m 06s', status: 'passing' },
  { id: 'unit', title: 'Unit tests', kind: 'JOB-04', meta: '2m 41s', status: 'passing' },
  { id: 'browser', title: 'Browser tests', kind: 'JOB-05', meta: '9m 18s', status: 'flaky' },
  { id: 'regressions', title: 'Regressions', kind: 'JOB-06', meta: '3 open', status: 'held' },
  { id: 'stage', title: 'Staging', kind: 'ENV-1', meta: 'auto', status: 'in transit' },
  { id: 'canary', title: 'Canary', kind: 'ENV-2', meta: '5% traffic', status: 'watching' },
  { id: 'release', title: 'Release', kind: 'ENV-3', meta: 'manual gate', status: 'blocked' },
];

const PIPELINE_EDGES: CanvasEdge[] = [
  { id: 'p1', source: 'commit', target: 'lint' },
  { id: 'p2', source: 'commit', target: 'types' },
  { id: 'p3', source: 'lint', target: 'build' },
  { id: 'p4', source: 'types', target: 'build' },
  { id: 'p5', source: 'build', target: 'unit' },
  { id: 'p6', source: 'build', target: 'browser' },
  { id: 'p7', source: 'browser', target: 'regressions', label: 'on failure' },
  { id: 'p8', source: 'unit', target: 'stage' },
  { id: 'p9', source: 'browser', target: 'stage' },
  { id: 'p10', source: 'stage', target: 'canary', label: 'soak 30m' },
  { id: 'p11', source: 'canary', target: 'release', label: 'gate' },
  // The back edge. Without cycle-breaking this is where a layered layout
  // spins forever.
  { id: 'p12', source: 'regressions', target: 'build', label: 'retry' },
];

// No `position` anywhere: the layout supplies every coordinate.
const PIPELINE_NODES: CanvasNode[] = PIPELINE.map((spec) => ({
  id: spec.id,
  position: { x: 0, y: 0 },
  data: {
    title: spec.title,
    kind: spec.kind,
    meta: spec.meta,
    status: spec.status,
  },
}));

const DIRECTIONS = ['right', 'down', 'left', 'up'];
const EDGE_TYPES = ['bezier', 'smoothstep', 'step', 'straight', 'simplebezier'];
const ARROWHEADS = ['closed', 'open', 'none'];

class GraphLayoutUsage extends Component {
  directionOptions = DIRECTIONS;
  edgeTypeOptions = EDGE_TYPES;
  arrowheadOptions = ARROWHEADS;
  summaryOptions = SUMMARIES;

  @tracked label = 'Release pipeline';
  @tracked direction = 'right';
  @tracked edgeType = 'smoothstep';
  @tracked arrowheads = 'closed';
  @tracked animatedEdges = false;
  @tracked marquee = false;
  @tracked snapToGrid = false;
  @tracked rankGap = 110;
  @tracked nodeGap = 28;
  @tracked summary = 'visible';

  @tracked nodes: CanvasNode[] = PIPELINE_NODES.map((node) => ({ ...node }));
  @tracked edges: CanvasEdge[] = PIPELINE_EDGES.map((edge) => ({ ...edge }));

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
  setDirection = (v: string) => (this.direction = v);
  setEdgeType = (v: string) => (this.edgeType = v);
  setArrowheads = (v: string) => (this.arrowheads = v);
  setAnimatedEdges = (v: boolean) => (this.animatedEdges = v);
  setMarquee = (v: boolean) => (this.marquee = v);
  setSnapToGrid = (v: boolean) => (this.snapToGrid = v);
  setRankGap = (v: number | null) => (this.rankGap = v ?? 110);
  setNodeGap = (v: number | null) => (this.nodeGap = v ?? 28);
  setSummary = (v: string) => (this.summary = v);

  get directionVal() {
    return this.direction as GraphDirection;
  }
  get edgeTypeVal() {
    return this.edgeType as CanvasEdgeType;
  }
  get arrowheadsVal() {
    return this.arrowheads as 'closed' | 'open' | 'none';
  }
  get summaryVal() {
    return this.summary as 'sr-only' | 'visible' | 'off';
  }

  /**
   * The same pure function the canvas runs, called directly so the page can
   * SHOW its work. Nothing here touches the engine.
   */
  get report() {
    let result = graphLayout(this.nodes, this.edges, {
      direction: this.directionVal,
      rankGap: this.rankGap,
      nodeGap: this.nodeGap,
    });
    let names = new Map(
      this.nodes.map((node) => [node.id, String(node.data?.title ?? node.id)]),
    );
    return {
      layerCount: result.layers.length,
      crossingsBefore: result.crossingsBefore,
      crossingsAfter: result.crossingsAfter,
      reversed: result.reversed.map((index) => {
        let edge = this.edges[index];
        if (!edge) {
          return 'unknown';
        }
        return `${names.get(edge.source) ?? edge.source} to ${
          names.get(edge.target) ?? edge.target
        }`;
      }),
      hasReversed: result.reversed.length > 0,
    };
  }

  get usage() {
    let bits = [
      `@label='${this.label}'`,
      '@nodes={{this.nodes}}',
      '@edges={{this.edges}}',
      `@autoLayout='${this.direction}'`,
    ];
    if (this.edgeType !== 'bezier') bits.push(`@edgeType='${this.edgeType}'`);
    if (this.arrowheads !== 'closed') {
      bits.push(`@arrowheads='${this.arrowheads}'`);
    }
    if (this.animatedEdges) bits.push('@animatedEdges={{true}}');
    if (this.marquee) bits.push('@marquee={{true}}');
    if (this.snapToGrid) bits.push('@snapToGrid={{true}}');
    if (this.rankGap !== 110) bits.push(`@rankGap={{${this.rankGap}}}`);
    if (this.nodeGap !== 28) bits.push(`@nodeGap={{${this.nodeGap}}}`);
    if (this.summary !== 'sr-only') bits.push(`@summary='${this.summary}'`);
    return `<NodeCanvas\n  ${bits.join('\n  ')}\n/>`;
  }

  <template>
    <FreestyleUsage
      @name='NodeCanvas · auto-layout, edges and the outline'
      @description="The same NodeCanvas, with the three things a node graph needs and xyflow does not ship. This page is CONTROLLED and auto-laid-out, so the layout owns every position and dragging is off — that combination is the one where a dragged node would snap straight back, so NodeCanvas turns dragging off rather than shipping the snap. Drop @onNodesChange and the same markup lays out once and then drags freely, with the outline's Tidy layout control to put it back. AUTO-LAYOUT: the fixture below carries no coordinates at all — a layered pass (cycle-break, longest-path layering, barycenter ordering, median straightening) places every node, deterministically, with no Math.random anywhere, because the indexer forbids it and because two runs of one graph should not differ. React Flow's own layouting example imports dagre for this; dagre's ranker calls Math.random. EDGES: routing is a knob, and arrowheads DRAW — the port emits marker-end and ships no marker definitions at all, so markerEnd has always been silently dead. THE OUTLINE: the text mirror is now operable. Every node is a button that selects and focuses it in the picture, each edge is stated in both directions with its label, and a keyboard user can draw a NEW edge — the gesture React Flow has no answer for. Set the outline visible below and try it without touching the mouse."
      @source={{this.usage}}
    >
      <:example>
        <NodeCanvas
          @label={{this.label}}
          @nodes={{this.nodes}}
          @edges={{this.edges}}
          @onNodesChange={{this.onNodesChange}}
          @onEdgesChange={{this.onEdgesChange}}
          @onConnect={{this.onConnect}}
          @autoLayout={{this.directionVal}}
          @rankGap={{this.rankGap}}
          @nodeGap={{this.nodeGap}}
          @edgeType={{this.edgeTypeVal}}
          @arrowheads={{this.arrowheadsVal}}
          @animatedEdges={{this.animatedEdges}}
          @marquee={{this.marquee}}
          @snapToGrid={{this.snapToGrid}}
          @summary={{this.summaryVal}}
          @height='30rem'
        >
          <:toolbar>
            <span class='canvas-bar-title'>{{this.label}}</span>
            <Token @value='10 stages' />
          </:toolbar>
        </NodeCanvas>

        <dl class='layout-report'>
          <dt>Layers</dt>
          <dd>{{this.report.layerCount}}</dd>
          <dt>Crossings before ordering</dt>
          <dd>{{this.report.crossingsBefore}}</dd>
          <dt>Crossings after ordering</dt>
          <dd>{{this.report.crossingsAfter}}</dd>
          <dt>Reversed to break a cycle</dt>
          <dd>
            {{#if this.report.hasReversed}}
              {{#each this.report.reversed key='@index' as |pair|}}
                <span class='layout-reversed'>{{pair}}</span>
              {{/each}}
            {{else}}
              none — the graph is acyclic
            {{/if}}
          </dd>
        </dl>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @required={{true}}
          @value={{this.label}}
          @onInput={{this.setLabel}}
          @description='Accessible name for the canvas, and the name the outline gives itself.'
        />
        <Args.String
          @name='autoLayout'
          @options={{this.directionOptions}}
          @value={{this.direction}}
          @onInput={{this.setDirection}}
          @description='Run the layered layout and place every node, ignoring the position on the input nodes. Omit it for free positioning. It also pins the handle sides to match the direction, so edges leave the face they are drawn on.'
        />
        <Args.Number
          @name='rankGap'
          @min={{40}}
          @max={{260}}
          @step={{10}}
          @value={{this.rankGap}}
          @defaultValue={{110}}
          @onInput={{this.setRankGap}}
          @description='Space between layers, along the flow axis, in graph units.'
        />
        <Args.Number
          @name='nodeGap'
          @min={{8}}
          @max={{120}}
          @step={{4}}
          @value={{this.nodeGap}}
          @defaultValue={{28}}
          @onInput={{this.setNodeGap}}
          @description='Space between siblings within a layer, across the flow axis.'
        />
        <Args.String
          @name='edgeType'
          @options={{this.edgeTypeOptions}}
          @value={{this.edgeType}}
          @defaultValue='bezier'
          @onInput={{this.setEdgeType}}
          @description='Routing for every edge that sets no type of its own, and for the line drawn WHILE connecting — the engine otherwise leaves that a bezier however the settled edges look.'
        />
        <Args.String
          @name='arrowheads'
          @options={{this.arrowheadOptions}}
          @value={{this.arrowheads}}
          @defaultValue='closed'
          @onInput={{this.setArrowheads}}
          @description='Arrowheads on every edge. On by default: a directed graph that does not say which way its edges run is not communicating. Requires the marker definitions this kit injects, which the engine references and never ships.'
        />
        <Args.Bool
          @name='animatedEdges'
          @value={{this.animatedEdges}}
          @defaultValue={{false}}
          @onInput={{this.setAnimatedEdges}}
          @description='Dash and travel every edge that sets no animated flag of its own. Stops dead, at the END state, under prefers-reduced-motion.'
        />
        <Args.Bool
          @name='marquee'
          @value={{this.marquee}}
          @defaultValue={{false}}
          @onInput={{this.setMarquee}}
          @description='Drag on empty canvas to rubber-band select instead of panning. Partial selection: a node only has to be touched by the band, not enclosed by it.'
        />
        <Args.Bool
          @name='snapToGrid'
          @value={{this.snapToGrid}}
          @defaultValue={{false}}
          @onInput={{this.setSnapToGrid}}
          @description='Snap dragged nodes to the background grid — the one that is actually drawn, not a second invisible one.'
        />
        <Args.String
          @name='summary'
          @options={{this.summaryOptions}}
          @value={{this.summary}}
          @defaultValue='sr-only'
          @onInput={{this.setSummary}}
          @description='Where the graph outline goes. sr-only is clipped until focus enters it and then unclips, because a hidden region holding real buttons would otherwise strand a keyboard user. visible keeps it as a caption strip. off removes it, and removes the only keyboard route to a connection with it.'
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .layout-report {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 2px var(--space-4, 11px);
        margin: var(--space-4, 11px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
      }

      .layout-report dt {
        color: var(--muted-foreground);
      }

      .layout-report dd {
        margin: 0;
        font-family: var(--font-mono);
      }

      .layout-reversed {
        margin-inline-end: var(--space-2, 5px);
      }
    </style>
  </template>
}

export const DEMOS_GRAPH_LAYOUT: Record<string, unknown> = {
  GraphLayout: GraphLayoutUsage,
};
