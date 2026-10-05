// Pretui — DashboardGrid usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { Button } from './button';
import { FreestyleUsage } from './freestyle-usage';
import { Delta } from './delta';
import { Meter } from './meter';
import { Token } from './token';
import { seedFrom } from '../examples';
import { DashboardGrid } from './dashboard-grid';
import type { DashboardPlacement } from '../internal/structure-dashboard';
import { START_LAYOUT, TILES, serializeLayout } from '../demo-structure-dashboard';
import type { Tile } from '../demo-structure-dashboard';

// ── 1. DashboardGrid ─────────────────────────────────────────────────────
function sparkline(id: string): string {
  let seed = seedFrom(id);
  const points: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const y = 4 + ((seed >> 8) % 22);
    points.push(`${i * 9},${y}`);
  }
  return points.join(' ');
}

const GRID_SOURCE = `<DashboardGrid
  @items={{this.tiles}}
  @layout={{this.layout}}
  @columns={{12}}
  @cellHeight={{72}}
  @label='Quarterly board'
  @onLayoutChange={{this.saveLayout}}
>
  <:title as |tile|>{{tile.title}}</:title>
  <:actions as |tile|><Token @value={{tile.kind}} /></:actions>
  <:item as |tile placement|>
    …tile body, and {{placement.w}}×{{placement.h}} if you want it…
  </:item>
</DashboardGrid>`;

class DashboardGridUsage extends Component {
  @tracked layout: DashboardPlacement[] = START_LAYOUT;
  @tracked columns = 12;
  @tracked cellHeight = 72;
  @tracked gap = 8;
  @tracked float = false;
  @tracked animate = true;
  @tracked editable = true;
  @tracked changes = 0;

  tiles = TILES;

  saveLayout = (next: DashboardPlacement[]) => {
    this.layout = next;
    this.changes += 1;
  };

  reset = () => {
    this.layout = START_LAYOUT;
    this.changes = 0;
  };

  setColumns = (v: number) => (this.columns = v);
  setCellHeight = (v: number) => (this.cellHeight = v);
  setGap = (v: number) => (this.gap = v);
  setFloat = (v: boolean) => (this.float = v);
  setAnimate = (v: boolean) => (this.animate = v);
  setEditable = (v: boolean) => (this.editable = v);

  get serialized(): string {
    return serializeLayout(this.layout);
  }

  get changeLabel(): string {
    if (this.changes === 0) {
      return 'no changes yet — drag a tile by its grip, or focus a grip and press Enter';
    }
    return `${this.changes} layout change${this.changes === 1 ? '' : 's'} emitted`;
  }

  sparkFor = (tile: Tile) => sparkline(tile.id);

  <template>
    <FreestyleUsage
      @name='DashboardGrid'
      @description="A grid the END USER arranges: drag a tile by its grip to move it, drag the corner to resize it, and everything else reflows around it. The arrangement is plain data — an {id,x,y,w,h}[] kept separately from the items, exactly as Board keeps KanbanPlacement separate from cards — so a Boxel card can hold it in a field and restore it verbatim. Runs on gridstack 13.1.2 plus 18 commits (d9c9bc41; MIT, no dependencies) with a strict DOM-ownership split: Glimmer renders the tiles, the engine only positions them."
      @source={{GRID_SOURCE}}
      @viewportMode='fill'
    >
      <:example>
        <div class='dash-demo'>
          <DashboardGrid
            @items={{this.tiles}}
            @layout={{this.layout}}
            @columns={{this.columns}}
            @cellHeight={{this.cellHeight}}
            @gap={{this.gap}}
            @float={{this.float}}
            @animate={{this.animate}}
            @editable={{this.editable}}
            @label='Quarterly board'
            @onLayoutChange={{this.saveLayout}}
          >
            <:title as |tile|>{{tile.title}}</:title>
            <:actions as |tile|>
              <Token @value={{tile.kind}} />
            </:actions>
            <:item as |tile|>
              <div class='dash-tile'>
                <div class='dash-metric'>
                  <span class='dash-value'>{{tile.metric}}</span>
                  <Delta @value={{tile.delta}} />
                </div>
                <svg
                  class='dash-spark'
                  viewBox='0 0 99 30'
                  preserveAspectRatio='none'
                  aria-hidden='true'
                >
                  <polyline points={{this.sparkFor tile}} />
                </svg>
                <Meter @level={{tile.level}} @label='Target' />
              </div>
            </:item>
          </DashboardGrid>

          <div class='dash-ledger'>
            <div class='dash-ledger-head'>
              <span class='dash-ledger-title'>@onLayoutChange</span>
              <Button @size='xs' @appearance='outlined' {{on 'click' this.reset}}>
                Reset
              </Button>
            </div>
            <p class='dash-ledger-note'>{{this.changeLabel}}</p>
            <pre class='dash-ledger-code'>{{this.serialized}}</pre>
          </div>
        </div>
      </:example>

      <:api as |Args|>
        <Args.Object
          @name='items'
          @description='The tiles. Their array order is presentation-neutral — position lives in @layout, never on the item.'
          @hideControls={{true}}
        />
        <Args.Object
          @name='layout'
          @description='The arrangement: DashboardPlacement[] = {id,x,y,w,h}[], keyed by id. Ids with no placement are auto-positioned; placements with no item are ignored. Round-trips through JSON unchanged.'
          @hideControls={{true}}
        />
        <Args.Number
          @name='columns'
          @defaultValue={{12}}
          @value={{this.columns}}
          @min={{4}}
          @max={{16}}
          @description='Column count at full width.'
          @onInput={{this.setColumns}}
        />
        <Args.Number
          @name='cellHeight'
          @defaultValue={{72}}
          @value={{this.cellHeight}}
          @min={{32}}
          @max={{140}}
          @description='Row height in px.'
          @onInput={{this.setCellHeight}}
        />
        <Args.Number
          @name='gap'
          @defaultValue={{8}}
          @value={{this.gap}}
          @min={{0}}
          @max={{24}}
          @description='Gutter in px, drawn as an inset on the tile content rather than a margin on the tile.'
          @onInput={{this.setGap}}
        />
        <Args.Bool
          @name='float'
          @defaultValue={{false}}
          @value={{this.float}}
          @description='Off, tiles pack upwards into any gap above them. On, a tile stays exactly where it was dropped.'
          @onInput={{this.setFloat}}
        />
        <Args.Bool
          @name='animate'
          @defaultValue={{true}}
          @value={{this.animate}}
          @description='Animate the tiles a drag displaces — the one motion here, and it encodes where a pushed tile went. Always off under prefers-reduced-motion, landing on the end state.'
          @onInput={{this.setAnimate}}
        />
        <Args.Bool
          @name='editable'
          @defaultValue={{true}}
          @value={{this.editable}}
          @description='False renders the identical layout with no engine, no listeners and no affordances — see the read-only page.'
          @onInput={{this.setEditable}}
        />
        <Args.String
          @name='label'
          @defaultValue='Dashboard'
          @description='Accessible name for the grid region.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='idFor'
          @description='(item, index) => string. Defaults to item.id, falling back to the index.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='labelFor'
          @description="(item, index) => string. The drag handle's accessible name. Defaults to item.title, then item.label, then the id."
          @hideControls={{true}}
        />
        <Args.Object
          @name='breakpoints'
          @description='Responsive column steps, narrowest first: [{w,c}] means "below a plane width of w, use c columns". Defaults to [{w:560,c:2},{w:900,c:6}], capped by @columns. A responsive re-flow never reaches @onLayoutChange — the authored layout is the one that persists.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onLayoutChange'
          @description='Fires with the serialized layout after a USER-driven change (a drag, a resize, or a committed keyboard adjustment). Adding or removing an item does not fire it — the caller did that and already knows. Where the layout is stored is entirely yours.'
          @hideControls={{true}}
        />
        <Args.Yield
          @description='Three blocks, each receiving the item and its index: <:title>, <:actions> (the tile bar), and <:item>, which additionally receives the resolved placement.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .dash-demo {
        display: grid;
        gap: var(--space-4, 11px);
      }
      .dash-tile {
        display: grid;
        align-content: start;
        gap: var(--space-2, 5px);
        min-width: 0;
      }
      .dash-metric {
        display: flex;
        align-items: baseline;
        gap: var(--space-2, 5px);
      }
      .dash-value {
        font-size: 19px;
        font-weight: 600;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
        color: var(--card-foreground);
      }
      .dash-spark {
        width: 100%;
        height: 30px;
        overflow: visible;
      }
      .dash-spark polyline {
        fill: none;
        stroke: var(--chart-1);
        stroke-width: 1.5;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
      }
      .dash-ledger {
        border-radius: var(--radius);
        background: var(--inset, var(--boxel-100));
        box-shadow: 0 0 0 1px var(--border);
        padding: var(--space-3, 8px);
      }
      .dash-ledger-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2, 5px);
      }
      .dash-ledger-title {
        font-family: var(--font-mono);
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        color: var(--foreground);
      }
      .dash-ledger-note {
        margin: var(--space-1, 3px) 0 var(--space-2, 5px);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .dash-ledger-code {
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

export const DEMOS_DASHBOARD_GRID: Record<string, unknown> = {
  DashboardGrid: DashboardGridUsage,
};
