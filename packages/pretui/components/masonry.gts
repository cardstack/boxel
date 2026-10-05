// Pretui — Masonry: native CSS multi-column masonry: no measurement, no JavaScript.
import Component from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import { cssDeclaration, cssNumber, cssStyleFrom } from '../pretui-css';

// ── Masonry ──────────────────────────────────────────────────────────────
// Staggered multi-column layout with no measuring engine at all.
//
// READING ORDER — the correctness trap, stated plainly rather than
// discovered later. This uses native CSS multi-column, so:
//   • DOM order, keyboard order, and screen-reader order are the order you
//     pass @items. Always. That is the accessible order and it never moves.
//   • The VISUAL order is column-major: item 1 is top-left, and the next item
//     is BELOW it, not to its right; a column fills to the bottom before the
//     next column starts.
// So Masonry is right for a wall of peers (a moodboard, a gallery, tasting
// notes) and WRONG for ranked content where "first" must read top-left then
// rightwards — for that use <Grid>, which is row-major. A JS masonry engine
// buys row-major fill at the price of measuring every child on every resize
// AND a DOM whose order no longer matches what anyone sees; this component
// refuses that trade. Under a narrow container it collapses to one column,
// where column-major and row-major are the same thing.
//
// Dropped from the JS originals: per-item measured placement, animated
// re-flow on resize, and infinite-scroll integration (that is <Feed>'s job).

export interface MasonrySignature<T = unknown> {
  Args: {
    /** the items to lay out — rendered through the <:item> block, in the
     * caller's own row type */
    items: readonly T[];
    /** maximum number of columns (default 3); the browser uses fewer when
     * @min would not fit */
    columns?: number;
    /** minimum column width as a CSS length (default 16rem) */
    min?: string;
    /** gutter in px (default 14) — also settable as --pretui-masonry-gap */
    gap?: number;
  };
  Blocks: {
    /** one cell — receives the item and its 0-based index */
    item: [item: T, index: number];
  };
  Element: HTMLDivElement;
}

export class Masonry<T = unknown> extends Component<MasonrySignature<T>> {
  get style(): ReturnType<typeof htmlSafe> | undefined {
    let columns = cssNumber(this.args.columns, 1, 64);
    let gap = cssNumber(this.args.gap, 0, 512);
    return cssStyleFrom([
      columns === undefined
        ? undefined
        : `--pretui-masonry-columns: ${Math.floor(columns)}`,
      cssDeclaration('--pretui-masonry-min', this.args.min),
      gap === undefined ? undefined : `--pretui-masonry-gap: ${gap}px`,
    ]);
  }

  <template>
    <div
      class='pretui-masonry'
      style={{this.style}}
      data-test-pretui-masonry
      ...attributes
    >
      <div class='pretui-masonry-columns'>
        {{#each @items key='@index' as |item index|}}
          <div class='pretui-masonry-cell'>{{yield item index to='item'}}</div>
        {{/each}}
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-masonry {
          container-type: inline-size;
          min-width: 0;
        }
        .pretui-masonry-columns {
          columns: var(--pretui-masonry-min, 16rem)
            var(--pretui-masonry-columns, 3);
          column-gap: var(--pretui-masonry-gap, 14px);
        }
        .pretui-masonry-cell {
          /* multicol has no row-gap: the cell's own margin is the gutter */
          margin: 0 0 var(--pretui-masonry-gap, 14px);
          break-inside: avoid;
          /* Safari still needs the legacy alias */
          -webkit-column-break-inside: avoid;
          min-width: 0;
        }
      }
    </style>
  </template>
}
