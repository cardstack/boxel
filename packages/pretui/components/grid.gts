// Pretui — Grid: a fitted-format card grid, a thin wrap of boxel-ui GridContainer.
import Component from '@glimmer/component';
import { GridContainer as BoxelGridContainer } from '@cardstack/boxel-ui/components';
import type { FittedFormatId } from '@cardstack/boxel-ui/helpers';

// ── Grid — WRAPS boxel-ui ────────────────────────────────────────────────
// boxel-ui's GridContainer layout engine: an auto-fill CSS grid whose
// column width and row height come from the fitted-format spec table
// (@size), with a one-column list mode (@viewFormat='list'). Yields each
// item with a curried GridItemContainer that clamps the tile to the
// format's dimensions (@fullWidthItem stretches width, keeps height).
// Wave-0 adaptations: @items is required (boxel's itemless free-content
// mode is dropped — use plain CSS grid for that) and @tag is dropped
// (the container renders boxel's default div).

export interface GridSignature<T = unknown> {
  Args: {
    /** the tiles to lay out — yielded back in the caller's own row type */
    items: T[];
    /** fitted format id — sets column width and row height */
    size?: FittedFormatId;
    /** 'grid' (default) auto-fills columns; 'list' stacks one column */
    viewFormat?: 'list' | 'grid';
    /** stretch each item to full row width (height still from @size) */
    fullWidthItem?: boolean;
  };
  Blocks: {
    /* eslint-disable @typescript-eslint/no-explicit-any -- the SECOND param
       is boxel-ui's curried GridItemContainer, whose signature is not
       exported from the components barrel; the first is the caller's row */
    default: [item: T, gridItemContainer: any];
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
  Element: HTMLDivElement;
}

// A class rather than a TemplateOnlyComponent for one reason: a
// `const … : TemplateOnlyComponent<S>` cannot carry a type parameter, and
// `T` flowing into the yielded block is worth the extra three lines. The
// rendered DOM is byte-identical.
export class Grid<T = unknown> extends Component<GridSignature<T>> {
  <template>
    <div class='pretui-grid' data-test-pretui-grid ...attributes>
      <BoxelGridContainer
        @items={{@items}}
        @size={{@size}}
        @viewFormat={{@viewFormat}}
        @fullWidthItem={{@fullWidthItem}}
        as |item ItemContainer|
      >
        {{yield item ItemContainer}}
      </BoxelGridContainer>
    </div>
    <style scoped>
      @layer PretComponent {
        /* The engine's cell gap reads --boxel-sp — remapped to the Pretui
           spacing scale so grid rhythm follows the season sheet. */
        .pretui-grid {
          width: 100%;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
          --boxel-sp: var(--space-4, 11px);
        }
      }
    </style>
  </template>
}
