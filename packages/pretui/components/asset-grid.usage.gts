// Pretui — AssetGrid usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import type { MediaAssetSpec, ResolvedMediaAsset } from '../internal/media-viewer';
import { AssetGrid } from './asset-grid';
import type { SelectionMode } from '../data-component';
import { SAMPLE_ASSETS } from '../media-examples';
import { Token } from './token';

// ── AssetGrid ────────────────────────────────────────────────────────────
const MODES: string[] = ['none', 'single', 'multi'];

const EMPTY_ASSETS: readonly MediaAssetSpec[] = [];

class AssetGridUsage extends Component {
  modes = MODES;
  assets = SAMPLE_ASSETS;
  empty = EMPTY_ASSETS;

  @tracked selectionMode = 'multi';
  @tracked tileSize = 148;
  @tracked showLabels = true;
  @tracked populated = true;
  @tracked opened = '—';
  @tracked selectedCount = 0;

  setSelectionMode = (v: string) => (this.selectionMode = v);
  setTileSize = (v: number | null) => (this.tileSize = v ?? 148);
  setShowLabels = (v: boolean) => (this.showLabels = v);
  setPopulated = (v: boolean) => (this.populated = v);
  onOpen = (asset: ResolvedMediaAsset) => (this.opened = asset.label);
  onSelectionChange = (keys: readonly unknown[]) =>
    (this.selectedCount = keys.length);

  get selectedCountText(): string {
    return String(this.selectedCount);
  }

  get rows(): readonly MediaAssetSpec[] {
    return this.populated ? SAMPLE_ASSETS : EMPTY_ASSETS;
  }
  get selectionModeValue(): SelectionMode {
    return this.selectionMode as SelectionMode;
  }
  get keyFor(): (row: MediaAssetSpec, index: number) => string {
    return (row) => row.src + (row.name ?? '');
  }
  get usage(): string {
    return [
      '<AssetGrid',
      '  @rows={{this.assets}}',
      `  @selectionMode='${this.selectionMode}'`,
      `  @tileSize={{${this.tileSize}}}`,
      '  @onOpen={{this.onOpen}}',
      '/>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='AssetGrid'
      @description="The shelf — and a demonstration of what the DataComponent<T> foundation is for. Loading, empty, error, selection, the active cursor, stale-response guarding and the polite result-count announcement are all inherited, not rewritten; this component adds a grid, a tile and a keyboard map. Flip 'rows present' off and the empty state you see is DataShell's, unchanged. Keyboard: Tab reaches exactly one tile, arrows move within (up/down cross the REAL column count, measured with a ResizeObserver rather than guessed from a tile width), Home/End jump, Space selects, Enter opens, Ctrl/Cmd+A selects all. The markup is a listbox built with the kit's face/overlay split, because realm lint forbids an <img> inside a role='option' — which turns out to be the right ARIA anyway: the option's name is computed rather than scraped out of its ink."
      @source={{this.usage}}
    >
      <:example>
        <AssetGrid
          @rows={{this.rows}}
          @key={{this.keyFor}}
          @selectionMode={{this.selectionModeValue}}
          @tileSize={{this.tileSize}}
          @showLabels={{this.showLabels}}
          @label='Sourcing shelf'
          @itemNoun='asset'
          @onOpen={{this.onOpen}}
          @onSelectionChange={{this.onSelectionChange}}
        />
        <p class='ag-readout'>
          <span class='ag-readoutLabel'>@onOpen</span>
          <Token @value={{this.opened}} />
          <span class='ag-readoutLabel'>selected</span>
          <Token @value={{this.selectedCountText}} />
        </p>
      </:example>

      <:api as |Args|>
        <Args.Bool
          @name='rows present (demo knob)'
          @value={{this.populated}}
          @defaultValue={{true}}
          @description="Off hands the component an empty array, which is 'empty' — a different status from 'loading' and from 'error', and the distinction is the foundation's, not this component's."
          @onInput={{this.setPopulated}}
        />
        <Args.String
          @name='selectionMode'
          @value={{this.selectionMode}}
          @options={{this.modes}}
          @defaultValue='none'
          @description="'none', 'single' or 'multi'. Selection carries three channels — a check glyph, a ring, and aria-selected — because a blue border alone disappears in greyscale and says nothing to a screen reader."
          @onInput={{this.setSelectionMode}}
        />
        <Args.Number
          @name='tileSize'
          @value={{this.tileSize}}
          @defaultValue={{148}}
          @min={{72}}
          @max={{320}}
          @description='Minimum tile width in pixels; the grid fits as many as will go. Change it and the arrow keys keep working, because the column count is measured after every resize rather than assumed.'
          @onInput={{this.setTileSize}}
        />
        <Args.Bool
          @name='showLabels'
          @value={{this.showLabels}}
          @defaultValue={{true}}
          @description='Name and size under each thumbnail. Turning it off changes nothing about the accessible name, which is computed from the asset either way.'
          @onInput={{this.setShowLabels}}
        />
        <Args.String
          @name='label'
          @defaultValue='Assets'
          @description='Accessible name for the listbox.'
          @hideControls={{true}}
        />
        <Args.Action
          @name='onOpen'
          @description='(asset) => void on Enter and on double-click, with the RESOLVED asset — kind and label already derived. This is how a shelf drives a MediaViewer.'
        />
        <Args.Yield
          @name='tile'
          @description='Replaces the tile face; receives the resolved asset. Whatever you put here lands inside the aria-hidden layer, so components and images are free — the option overlay carries the semantics.'
        />
        <Args.Base
          @name='every DataComponent arg'
          @description='rows, load, loadKey, key, selected, defaultSelected, onSelectionChange, activeKey, onActiveChange, sort, comparator, itemNoun, silentCount, emptyTitle, emptyMessage, loadingLabel and skeletonRows all work here exactly as they do on DataComponent, because they ARE DataComponent — this component holds a DataSource and points DataShell at it, which is the delegation route that foundation documents.'
        />
      </:api>

      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-assets-tile'
          @type='length'
          @description='Minimum tile width. Set through @tileSize; override here for a wrapper that wants a different shelf at a different breakpoint.'
        />
        <Css.Basic
          @name='pretui-assets-aspect'
          @type='ratio'
          @description="Per-tile reserved ratio, derived from the asset's own width and height, falling back to 4 / 3."
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .ag-readout {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin: 12px 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .ag-readoutLabel {
        font-family: var(--font-mono);
      }
    </style>
  </template>
}

export const DEMOS_ASSET_GRID: Record<string, unknown> = {
  AssetGrid: AssetGridUsage,
};
