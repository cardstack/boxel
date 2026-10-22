// Pretui — demo-structure-dashboard: freestyle usage pages for the
// user-customizable dashboard (`DashboardGrid` + `DashboardItem`).
//
// Three pages, because the component has three stories to tell:
//   1. DashboardGrid — the live surface, with the serialized layout shown
//      beside it so the "layout is data" claim is visible, not asserted.
//   2. DashboardGrid · read-only — the SAME layout with `@editable={{false}}`,
//      rendered by CSS grid with no engine at all.
//   3. DashboardItem — the cell on its own, outside a grid, which is exactly
//      how it degrades when no host is supplied.
//
// Fixture data is deterministic: fixed arrays and `seedFrom`/`pick`, never
// `Math.random()` or `Date.now()` (realm law — they break index determinism).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './components/freestyle-usage';
import { Token } from './components/token';
import { DashboardGrid } from './components/dashboard-grid';
import { resolveLayout } from './internal/structure-dashboard';
import type { DashboardPlacement } from './internal/structure-dashboard';

// ── fixture ──────────────────────────────────────────────────────────────

export interface Tile {
  id: string;
  title: string;
  kind: string;
  metric: string;
  delta: number;
  level: number;
}

export const TILES: Tile[] = [
  {
    id: 'revenue',
    title: 'Revenue',
    kind: 'series/revenue@2',
    metric: '£184,220',
    delta: 12.4,
    level: 3,
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    kind: 'series/pipeline@2',
    metric: '41 deals',
    delta: -3.1,
    level: 1,
  },
  {
    id: 'churn',
    title: 'Churn',
    kind: 'series/churn@1',
    metric: '1.9%',
    delta: -0.4,
    level: 1,
  },
  {
    id: 'nps',
    title: 'NPS',
    kind: 'survey/nps@4',
    metric: '+54',
    delta: 6,
    level: 2,
  },
  {
    id: 'uptime',
    title: 'Uptime',
    kind: 'ops/uptime@1',
    metric: '99.98%',
    delta: 0.02,
    level: 3,
  },
];

export const START_LAYOUT: DashboardPlacement[] = [
  { id: 'revenue', x: 0, y: 0, w: 6, h: 3 },
  { id: 'pipeline', x: 6, y: 0, w: 6, h: 3 },
  { id: 'churn', x: 0, y: 3, w: 4, h: 2 },
  { id: 'nps', x: 4, y: 3, w: 4, h: 2 },
  { id: 'uptime', x: 8, y: 3, w: 4, h: 2 },
];

/** Deterministic sparkline path — seeded, never random. */

export function serializeLayout(layout: readonly DashboardPlacement[]): string {
  return layout
    .map((p) => `{ id: '${p.id}', x: ${p.x}, y: ${p.y}, w: ${p.w}, h: ${p.h} }`)
    .join('\n');
}

// ── 2. read-only ─────────────────────────────────────────────────────────

const READONLY_SOURCE = `<DashboardGrid
  @items={{this.tiles}}
  @layout={{this.layout}}
  @editable={{false}}
  @label='Quarterly board'
>
  <:title as |tile|>{{tile.title}}</:title>
  <:item as |tile|>…</:item>
</DashboardGrid>`;

class DashboardReadOnlyDemo extends Component {
  tiles = TILES;
  @tracked messy = false;
  setMessy = (v: boolean) => (this.messy = v);

  /** A deliberately broken layout: every tile stacked on 0,0. */
  get layout(): DashboardPlacement[] {
    if (!this.messy) {
      return START_LAYOUT;
    }
    return TILES.map((tile) => ({ id: tile.id, x: 0, y: 0, w: 4, h: 2 }));
  }

  get resolvedLabel(): string {
    return serializeLayout(resolveLayout(this.layout, 12, false));
  }

  <template>
    <FreestyleUsage
      @name='DashboardGrid · read-only'
      @description="A dashboard is edited rarely and read constantly, so @editable={{false}} never constructs an engine at all: no GridStack instance, no listeners, no ResizeObserver, no injected stylesheet, no drag affordances — one CSS grid, positioned from the same coordinates. The two modes cannot drift because both resolve through resolveLayout(), which runs gridstack's own DOM-free GridStackEngine. Turn on 'overlapping layout' to watch a broken stored layout (every tile at 0,0) get untangled by exactly the collision resolution the live grid uses."
      @source={{READONLY_SOURCE}}
      @viewportMode='fill'
    >
      <:example>
        <div class='ro-demo'>
          <DashboardGrid
            @items={{this.tiles}}
            @layout={{this.layout}}
            @editable={{false}}
            @columns={{12}}
            @cellHeight={{72}}
            @label='Quarterly board, read only'
          >
            <:title as |tile|>{{tile.title}}</:title>
            <:actions as |tile|>
              <Token @value={{tile.kind}} />
            </:actions>
            <:item as |tile placement|>
              <div class='ro-tile'>
                <span class='ro-value'>{{tile.metric}}</span>
                <span class='ro-span'>{{placement.w}}×{{placement.h}}</span>
              </div>
            </:item>
          </DashboardGrid>
          <pre class='ro-code'>{{this.resolvedLabel}}</pre>
        </div>
      </:example>

      <:api as |Args|>
        <Args.Bool
          @name='overlapping layout'
          @defaultValue={{false}}
          @value={{this.messy}}
          @description='Feed the grid a layout where every tile claims 0,0. The engine resolves it — this is a demo control, not a component argument.'
          @onInput={{this.setMessy}}
        />
        <Args.Bool
          @name='editable'
          @defaultValue={{true}}
          @description='Pinned false on this page.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='resolveLayout(layout, columns, float) is exported alongside the component: pure, DOM-free, and the same function this mode uses — call it wherever you need coordinates without a grid.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .ro-demo {
        display: grid;
        gap: var(--space-4, 11px);
      }
      .ro-tile {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--space-2, 5px);
      }
      .ro-value {
        font-size: 19px;
        font-weight: 600;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        color: var(--card-foreground);
      }
      .ro-span {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
      }
      .ro-code {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
        white-space: pre;
        overflow-x: auto;
      }
    </style>
  </template>
}

export const DEMOS_STRUCTURE_DASHBOARD: Record<string, unknown> = {
  'DashboardGrid · read-only': DashboardReadOnlyDemo,
};
