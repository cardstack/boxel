// Pretui — GraphOutline usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { GraphOutline } from './graph-outline';
import type { OutlineEdge, OutlineNode } from './graph-outline';

const OUTLINE_NODES: OutlineNode[] = [
  { id: 'origin', data: { title: 'Wuyi Origins', status: 'contracted' } },
  { id: 'lot', data: { title: 'Spring Lot 14', status: 'curing' } },
  { id: 'port', data: { title: 'Rotterdam', status: 'in transit' } },
];

const OUTLINE_EDGES: OutlineEdge[] = [
  { id: 'origin-lot', source: 'origin', target: 'lot', label: 'books' },
  { id: 'lot-port', source: 'lot', target: 'port', label: 'ships to' },
];

const OUTLINE_MODES = ['visible', 'sr-only'];

class GraphOutlineUsage extends GlimmerComponent {
  nodes = OUTLINE_NODES;
  edges = OUTLINE_EDGES;
  @tracked label = 'Spring supply chain';
  @tracked mode = 'visible';
  @tracked activeId = 'lot';

  setLabel = (value: string) => (this.label = value);
  setMode = (value: string) => (this.mode = value);
  setActiveId = (value: string) => (this.activeId = value);
  select = (id: string) => (this.activeId = id);

  get modeValue() {
    return this.mode as 'visible' | 'sr-only';
  }

  <template>
    <FreestyleUsage
      @name='GraphOutline'
      @description='The node graph as text: a named region, one real button per node and every incoming and outgoing connection spoken in full. It is the keyboard-readable peer of NodeCanvas, not a canvas fallback screenshot.'
      @source='<GraphOutline @nodes={{this.nodes}} @edges={{this.edges}} @mode="visible" />'
      @viewportMode='wide'
    >
      <:example>
        <GraphOutline
          @nodes={{this.nodes}}
          @edges={{this.edges}}
          @label={{this.label}}
          @mode={{this.modeValue}}
          @activeId={{this.activeId}}
          @onSelect={{this.select}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object @name='nodes' @value={{this.nodes}} />
        <Args.Object @name='edges' @value={{this.edges}} />
        <Args.String
          @name='label'
          @value={{this.label}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='mode'
          @options={{OUTLINE_MODES}}
          @value={{this.mode}}
          @defaultValue='sr-only'
          @onInput={{this.setMode}}
        />
        <Args.String
          @name='activeId'
          @value={{this.activeId}}
          @onInput={{this.setActiveId}}
        />
        <Args.Action
          @name='onSelect'
          @description='Receives the id when a node row is activated.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// Through the same duplicate-key guard as the registered bundles: an
// extraction that left its entry here would otherwise win the spread silently.

export const DEMOS_GRAPH_OUTLINE: Record<string, unknown> = {
  GraphOutline: GraphOutlineUsage,
};
