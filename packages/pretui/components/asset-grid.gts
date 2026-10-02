// Pretui — AssetGrid: a sortable, selectable grid of media assets on the data-component shell.
//
// AssetGrid is the media territory's answer to "show me the shelf". The
// interesting thing about it is how little of it there is: loading, empty,
// error, selection, the active cursor, stale-response guarding and the
// polite result-count announcement are ALL inherited from the
// `DataComponent<T>` foundation, through the delegation route that
// foundation documents — a `DataSource<T>` held as a field, with `DataShell`
// pointed at it. This file adds a grid, a tile and a keyboard map, and
// nothing else. Appendix M.5 is explicit that it "should not reimplement
// any of that".
//
// BETTER THAN THE INSPIRATION — the three defects the catalog sweep found in
// every thumbnail grid it looked at, and what happens here instead:
//
//   1. **Tiles are divs with click handlers.** Here the shelf is a real
//      listbox: one tab stop, arrows within (including up/down across the
//      real column count, measured rather than assumed), Home/End,
//      Space to select, Enter to open, Ctrl/Cmd+A to select all.
//   2. **Thumbnails reflow the grid as they load.** Here every tile
//      reserves its aspect ratio before a byte arrives.
//   3. **Selection is a blue border and nothing else.** Here it is a check
//      glyph, a ring, and `aria-selected` — never colour alone.
//
// The listbox markup uses the kit's face/overlay split: the visible tile is
// `aria-hidden` and pointer-transparent, and a bare `role='option'` div
// covers it. That is not decoration — realm lint's
// `require-presentational-children` errors on ANY element inside a
// `role='option'` that is not a span or a div, which includes `<img>`. The
// split satisfies the rule and the ARIA at the same time, and it means the
// option's accessible name is computed rather than scraped out of the
// subtree.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import type { SafeString } from '@ember/template';
import { modifier } from 'ember-modifier';
import { DataShell, DataSource } from '../data-component';
import type { DataArgs, RowKey } from '../data-component';
import { formatBytes, resolveAsset } from '../internal/media-viewer';
import type { AssetKind, MediaAssetSpec, ResolvedMediaAsset } from '../internal/media-viewer';
import { formatClock } from '../internal/reading-format';
import { cssStyle } from '../pretui-css';
import { KIND_WORD } from '../internal/media-assets';

// ── shared bits ──────────────────────────────────────────────────────────

/** One glyph per kind, so the tile says what it is without a colour and
 * without an icon font. Text, therefore greyscale-proof (Law 8). */
const KIND_GLYPH: Readonly<Record<AssetKind, string>> = {
  image: '▣',
  video: '▶',
  audio: '∿',
  model: '◈',
  unknown: '?',
};

/** Hands an element to the host and drops it on teardown. The kit has three
 * of these now; this one is local until the focus foundation named in
 * Appendix L is consolidated. */
const captureElement = modifier(
  (el: HTMLElement, [sink]: [(el: HTMLElement | null) => void]) => {
    sink(el);
    return () => sink(null);
  },
);

/**
 * Reports the REAL column count of a CSS grid, by reading the resolved
 * `grid-template-columns` whenever the element resizes.
 *
 * A grid with `auto-fill` does not know its own column count in JS, and
 * every keyboard implementation surveyed either hard-codes it or guesses
 * from a tile width — which is how up-arrow ends up on the wrong tile at
 * some breakpoints. `ResizeObserver` is measurement, not a timer (Appendix
 * L is explicit about the distinction), and it disconnects on teardown.
 */
const trackColumns = modifier(
  (el: HTMLElement, [sink]: [(columns: number) => void]) => {
    const measure = () => {
      const resolved = getComputedStyle(el).gridTemplateColumns;
      const count =
        resolved && resolved !== 'none'
          ? resolved.split(' ').filter((part) => part.length > 0).length
          : 1;
      sink(Math.max(1, count));
    };
    // ResizeObserver delivers its first record asynchronously, AFTER the
    // render transaction — which is what makes the tracked write below
    // legal. Measuring here instead would be the backtracking assertion.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  },
);

// ── AssetGrid ────────────────────────────────────────────────────────────

export interface AssetGridSignature {
  Args: DataArgs<MediaAssetSpec> & {
    /** Minimum tile width in pixels; the grid fits as many as will go.
     * @default 148 */
    tileSize?: number;
    /** Show the name and size under each thumbnail. @default true */
    showLabels?: boolean;
    /** Accessible name for the shelf. @default 'Assets' */
    label?: string;
    /** Fired on Enter, and on double-click, with the resolved asset. This
     * is how a shelf drives a `MediaViewer`. */
    onOpen?: (asset: ResolvedMediaAsset) => void;
  };
  Blocks: {
    /** Replaces the tile face. Receives the resolved asset. Whatever you
     * put here is inside the `aria-hidden` layer, so it may contain
     * components and images freely — the option overlay carries the
     * semantics. */
    tile: [ResolvedMediaAsset];
  };
  Element: HTMLDivElement;
}

interface AssetRow {
  index: number;
  key: RowKey;
  asset: ResolvedMediaAsset;
  glyph: string;
  kindWord: string;
  size: string;
  clock: string;
  selected: boolean;
  active: boolean;
  tabStop: boolean;
  name: string;
  /** `undefined` when the ratio failed `cssValue` — the tile then falls back
   * to the stylesheet's own default rather than rendering an empty style. */
  aspectStyle: SafeString | undefined;
}

export class AssetGrid extends Component<AssetGridSignature> {
  /** The whole state machine, delegated. Nothing below re-implements a
   * single thing it owns. */
  data = new DataSource<MediaAssetSpec>(() => this.args);

  @tracked private columns = 1;
  private grid: HTMLElement | null = null;

  private takeGrid = (el: HTMLElement | null) => {
    this.grid = el;
  };
  private takeColumns = (columns: number) => {
    this.columns = columns;
  };

  get tileSize(): number {
    return Math.max(72, Math.floor(this.args.tileSize ?? 148));
  }
  get showLabels(): boolean {
    return this.args.showLabels ?? true;
  }
  get label(): string {
    return this.args.label ?? 'Assets';
  }
  get multi(): boolean {
    return this.data.selectionMode === 'multi';
  }
  get multiAttr(): string | undefined {
    return this.multi ? 'true' : undefined;
  }
  get gridStyle(): SafeString {
    return htmlSafe(`--pretui-assets-tile: ${this.tileSize}px`);
  }

  get rows(): AssetRow[] {
    const raw = this.data.rows;
    const activeKey = this.data.activeKey;
    const hasActive = raw.some(
      (row, i) => this.data.keyFor(row, i) === activeKey,
    );
    return raw.map((row, index) => {
      const asset = resolveAsset(row);
      const key = this.data.keyFor(row, index);
      const active = hasActive ? key === activeKey : false;
      const size = formatBytes(row.bytes);
      const clock = row.duration ? formatClock(row.duration) : '';
      const ratio = asset.aspectRatio ?? '4 / 3';
      return {
        index,
        key,
        asset,
        glyph: KIND_GLYPH[asset.kind],
        kindWord: KIND_WORD[asset.kind],
        size,
        clock,
        selected: this.data.isSelected(row, index),
        active,
        // The tab stop is the active tile, or the first one when nothing is
        // active — never zero tab stops and never two.
        tabStop: hasActive ? active : index === 0,
        name: asset.label,
        // Validate-or-drop through the shared guard, never interpolate a
        // caller string into a style. A denylist that strips `;{}<>` looks
        // like a guard and lets `url(https://…)` through untouched.
        aspectStyle: cssStyle('--pretui-assets-aspect', ratio),
      };
    });
  }

  /** The option's accessible name, computed rather than scraped: the
   * subtree is children-presentational, so a name assembled here is both
   * required and strictly better than whatever the tile's ink would fold
   * together. */
  nameFor = (row: AssetRow): string => {
    const bits = [row.name, row.kindWord];
    if (row.clock) {
      bits.push(row.clock);
    }
    if (row.size) {
      bits.push(row.size);
    }
    return bits.join(', ');
  };

  private focusTile(index: number): void {
    const nodes = this.grid?.querySelectorAll('[data-test-pretui-asset]');
    const node = nodes ? (nodes[index] as HTMLElement | undefined) : undefined;
    node?.focus();
  }

  private moveTo(index: number): void {
    const raw = this.data.rows;
    if (raw.length === 0) {
      return;
    }
    const next = Math.max(0, Math.min(raw.length - 1, index));
    this.data.setActive(raw[next], next);
    this.focusTile(next);
  }

  selectRow = (row: AssetRow): void => {
    const raw = this.data.rows;
    this.data.setActive(raw[row.index], row.index);
    this.data.toggleSelected(raw[row.index], row.index);
  };

  openRow = (row: AssetRow): void => {
    this.args.onOpen?.(row.asset);
  };

  onTileClick = (row: AssetRow): void => {
    this.selectRow(row);
  };

  onTileDoubleClick = (row: AssetRow): void => {
    this.openRow(row);
  };

  // Typed `Event`, not `KeyboardEvent`: `{{on}}`'s Glint signature is
  // `(event: Event) => void`, and a narrower parameter is a type error at
  // the call site rather than at the handler. One cast, at the boundary.
  onTileKeydown = (row: AssetRow, raw: Event): void => {
    const event = raw as KeyboardEvent;
    const cols = this.columns;
    const last = this.data.rows.length - 1;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        this.moveTo(row.index + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveTo(row.index - 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        this.moveTo(Math.min(last, row.index + cols));
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.moveTo(Math.max(0, row.index - cols));
        break;
      case 'Home':
        event.preventDefault();
        this.moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        this.moveTo(last);
        break;
      case ' ':
        event.preventDefault();
        this.selectRow(row);
        break;
      case 'Enter':
        event.preventDefault();
        this.openRow(row);
        break;
      case 'a':
      case 'A':
        if ((event.metaKey || event.ctrlKey) && this.multi) {
          event.preventDefault();
          this.data.selectAll();
        }
        break;
      default:
        break;
    }
  };

  <template>
    <DataShell
      @state={{this.data}}
      @emptyTitle='Nothing on the shelf'
      @emptyMessage='No assets match this view. Widen the filter, or upload something for the desk to look at.'
      @loadingLabel='Reading the shelf'
      @skeletonRows={{4}}
      data-test-pretui-asset-shell
      ...attributes
    >
      <:default>
        <div
          class='pretui-assets'
          role='listbox'
          aria-label={{this.label}}
          aria-multiselectable={{this.multiAttr}}
          style={{this.gridStyle}}
          data-test-pretui-asset-grid
          {{captureElement this.takeGrid}}
          {{trackColumns this.takeColumns}}
        >
          {{#each this.rows key='key' as |row|}}
            <div
              class='pretui-assets-cell'
              role='presentation'
              style={{row.aspectStyle}}
              data-selected={{if row.selected 'true'}}
            >
              <span class='pretui-assets-face' aria-hidden='true'>
                {{#if (has-block 'tile')}}
                  {{yield row.asset to='tile'}}
                {{else}}
                  <span class='pretui-assets-thumb'>
                    {{#if row.asset.thumbnail}}
                      <img
                        src={{row.asset.thumbnail}}
                        alt=''
                        loading='lazy'
                        decoding='async'
                      />
                    {{/if}}
                    <span class='pretui-assets-kind'>{{row.glyph}}</span>
                    {{#if row.clock}}
                      <span class='pretui-assets-clock'>{{row.clock}}</span>
                    {{/if}}
                    <span class='pretui-assets-check'>✓</span>
                  </span>
                  {{#if this.showLabels}}
                    <span class='pretui-assets-label'>
                      <span class='pretui-assets-name'>{{row.name}}</span>
                      <span class='pretui-assets-sub'>{{row.kindWord}}{{#if
                          row.size
                        }} · {{row.size}}{{/if}}</span>
                    </span>
                  {{/if}}
                {{/if}}
              </span>
              <div
                class='pretui-assets-hit'
                role='option'
                aria-selected={{if row.selected 'true' 'false'}}
                aria-label={{this.nameFor row}}
                tabindex={{if row.tabStop '0' '-1'}}
                data-active={{if row.active 'true'}}
                data-test-pretui-asset
                {{on 'click' (fn this.onTileClick row)}}
                {{on 'dblclick' (fn this.onTileDoubleClick row)}}
                {{on 'keydown' (fn this.onTileKeydown row)}}
              ></div>
            </div>
          {{/each}}
        </div>
      </:default>
    </DataShell>

    <style scoped>
      @layer PretComponent {
        .pretui-assets {
          --pretui-assets-tile: 148px;
          display: grid;
          grid-template-columns: repeat(
            auto-fill,
            minmax(var(--pretui-assets-tile), 1fr)
          );
          gap: 14px;
          min-width: 0;
        }
        .pretui-assets-cell {
          --pretui-assets-aspect: 4 / 3;
          position: relative;
          min-width: 0;
        }
        /* The face paints above the option overlay but is transparent to the
           pointer, so every click, hover and focus lands on the option. */
        .pretui-assets-face {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          gap: 7px;
          pointer-events: none;
          min-width: 0;
        }
        .pretui-assets-hit {
          position: absolute;
          inset: -4px;
          z-index: 0;
          border-radius: calc(var(--radius) + 4px);
          cursor: pointer;
        }
        .pretui-assets-hit:hover {
          background: var(
            --hover,
            color-mix(in oklch, var(--foreground) 6%, transparent)
          );
        }
        .pretui-assets-hit:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 0;
        }

        .pretui-assets-thumb {
          position: relative;
          display: block;
          /* Reserved before the bytes land — nothing reflows. */
          aspect-ratio: var(--pretui-assets-aspect);
          border-radius: var(--radius);
          overflow: hidden;
          background: color-mix(
            in oklch,
            var(--foreground) 7%,
            var(--card)
          );
          box-shadow: var(--pretui-shadow-hairline, 0 0 0 1px var(--border));
        }
        .pretui-assets-thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .pretui-assets-kind {
          position: absolute;
          inset-block-start: 6px;
          inset-inline-start: 6px;
          display: grid;
          place-items: center;
          min-width: 18px;
          height: 18px;
          padding: 0 4px;
          border-radius: 999px;
          font-size: 10px;
          line-height: 1;
          color: var(--pretui-on-neutral, var(--boxel-light));
          background: color-mix(
            in oklch,
            var(--foreground) 72%,
            transparent
          );
        }
        .pretui-assets-clock {
          position: absolute;
          inset-block-end: 6px;
          inset-inline-end: 6px;
          padding: 1px 5px;
          border-radius: 4px;
          font-size: 10px;
          font-variant-numeric: tabular-nums;
          color: var(--pretui-on-neutral, var(--boxel-light));
          background: color-mix(
            in oklch,
            var(--foreground) 72%,
            transparent
          );
        }
        /* Selection carries three channels: the check glyph, the ring, and
           aria-selected. Never colour alone. */
        .pretui-assets-check {
          position: absolute;
          inset-block-start: 6px;
          inset-inline-end: 6px;
          display: none;
          place-items: center;
          width: 18px;
          height: 18px;
          border-radius: 999px;
          font-size: 11px;
          line-height: 1;
          color: var(--primary-foreground);
          background: var(--primary);
        }
        .pretui-assets-cell[data-selected='true'] .pretui-assets-check {
          display: grid;
        }
        .pretui-assets-cell[data-selected='true'] .pretui-assets-thumb {
          box-shadow:
            0 0 0 2px var(--primary),
            0 0 0 4px
              color-mix(in oklch, var(--primary) 24%, transparent);
        }

        .pretui-assets-label {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
          padding-inline: 1px;
        }
        .pretui-assets-name {
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 500;
          color: var(--foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-assets-sub {
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          font-variant-numeric: tabular-nums;
        }

        @media (any-pointer: coarse) {
          .pretui-assets {
            --pretui-assets-tile: 132px;
          }
          .pretui-assets-hit {
            inset: -8px;
          }
        }
      }
    </style>
  </template>
}
