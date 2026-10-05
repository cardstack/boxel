// Pretui — Grid usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Grid } from './grid';
import type { FittedFormatId } from '@cardstack/boxel-ui/helpers';

// ── Grid ← grid-container/usage.gts ──────────────────────────────────────
// Dropped knobs: @tag (wrapper renders boxel's default div — same
// narrowing as Pretui Panel's fixed section) and the itemless
// free-content mode (@items is required in the wrap; use plain CSS grid
// for custom content). The upstream size list is the full fitted-format
// table; a representative subset keeps the knob readable.
const GRID_ITEMS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];

const GRID_SIZES = [
  'small-tile',
  'regular-tile',
  'large-tile',
  'compact-card',
  'single-strip',
  'double-strip',
];

const GRID_VIEW_FORMATS = ['grid', 'list'];

class GridUsage extends Component {
  items = GRID_ITEMS;
  sizeOptions = GRID_SIZES;
  viewFormatOptions = GRID_VIEW_FORMATS;
  @tracked size = 'regular-tile';
  @tracked viewFormat = 'grid';
  @tracked fullWidthItem = false;
  setSize = (v: string) => (this.size = v);
  setViewFormat = (v: string) => (this.viewFormat = v);
  setFullWidthItem = (v: boolean) => (this.fullWidthItem = v);
  get sizeVal() {
    return this.size as FittedFormatId;
  }
  get viewFormatVal() {
    return this.viewFormat as 'grid' | 'list';
  }
  get usage() {
    let bits = [
      '@items={{this.items}}',
      `@size='${this.size}'`,
    ];
    if (this.viewFormat !== 'grid') bits.push(`@viewFormat='${this.viewFormat}'`);
    if (this.fullWidthItem) bits.push('@fullWidthItem={{true}}');
    return `<Grid ${bits.join(' ')} as |item Cell|>\n  <Cell>…</Cell>\n</Grid>`;
  }
  <template>
    <FreestyleUsage
      @name='Grid'
      @description="Collection layout over the fitted-format spec table: an auto-fill CSS grid whose column width and row height come from @size, with a one-column list mode. Wraps boxel-ui's GridContainer; each item arrives with a curried cell container that clamps the tile to the format's dimensions."
      @source={{this.usage}}
    >
      <:example>
        <Grid
          @items={{this.items}}
          @size={{this.sizeVal}}
          @viewFormat={{this.viewFormatVal}}
          @fullWidthItem={{this.fullWidthItem}}
          as |item Cell|
        >
          <Cell>
            <div class='grid-demo-card'>
              <span class='grid-demo-eyebrow'>tile</span>
              <h4 class='grid-demo-title'>{{item}}</h4>
            </div>
          </Cell>
        </Grid>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='items'
          @required={{true}}
          @value={{this.items}}
          @description='Array iterated by the grid — each entry is yielded to the block with its cell container.'
        />
        <Args.String
          @name='size'
          @value={{this.size}}
          @options={{this.sizeOptions}}
          @description='Fitted format id — sets grid column width and row height from the spec table.'
          @onInput={{this.setSize}}
        />
        <Args.String
          @name='viewFormat'
          @defaultValue='grid'
          @value={{this.viewFormat}}
          @options={{this.viewFormatOptions}}
          @description="'grid' auto-fills columns at the format width; 'list' stacks items in one full-width column."
          @onInput={{this.setViewFormat}}
        />
        <Args.Bool
          @name='fullWidthItem'
          @defaultValue={{false}}
          @value={{this.fullWidthItem}}
          @description='Stretches each cell to full row width — height still comes from @size.'
          @onInput={{this.setFullWidthItem}}
        />
        <Args.Yield
          @description='Yields (item, Cell) per entry — render tile content inside the curried Cell container.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .grid-demo-card {
        height: 100%;
        display: grid;
        align-content: start;
        gap: 2px;
        padding: var(--space-4, 11px);
        background: var(--card);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(
          --pretui-shadow-card,
          0 0 0 1px var(--border)
        );
        overflow: hidden;
      }
      .grid-demo-eyebrow {
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        font-weight: 500;
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .grid-demo-title {
        margin: 0;
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_GRID: Record<string, unknown> = {
  Grid: GridUsage,
};
