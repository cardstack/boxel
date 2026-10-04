// Pretui — Stack: one-axis layout with a gap on the kit scale, items and an optional rule between them.
import Component from '@glimmer/component';
import { cssDeclaration, cssStyleFrom } from '../pretui-css';
import type { PretuiSize } from '../pretui-primitives';
import { pretuiOrientation, pretuiSize } from '../internal/structure-layout';
import type { Orientation, OrientationAlias, SizeAlias } from '../internal/structure-layout';

// ── Stack ────────────────────────────────────────────────────────────────
//
// Sources read: mantine/packages/@mantine/core/src/components/Stack,
// .../Group, .../Flex; chakra-ui/packages/react/src/components/stack.
//
// What every one of them gets wrong, and what is fixed here:
//
//   1. **The divider prop is a `Children` walk, and it changes the box model.**
//      Chakra interleaves a cloned separator through
//      `Children.toArray(children).filter(isValidElement)` — which silently
//      DISCARDS raw string and number children — and then drops `gap` from the
//      flex container entirely, re-creating the spacing as margins on the
//      separator. So `gap` and `separator` interact in a way nothing in the
//      API hints at. MUI is worse: `useFlexGap` defaults to FALSE, so the
//      default Stack spaces its children with `& > :not(style) ~ :not(style) {
//      margin-top }`, which breaks under wrapping, under `row-reverse`, and
//      whenever a child is a fragment. Glimmer has no children array at all,
//      so the honest port is: hand me the ITEMS and I will lay them out.
//      `@items` + `<:item>` cannot miscount, keeps `gap` as the one spacing
//      mechanism in both modes, and is typed.
//   2. **`min-width: 0` is missing everywhere.** A flex row child defaults to
//      `min-width: auto`, so one long unbroken label blows the row out of its
//      container. The fix is four declarations, not one: the cell gets `min-inline-size: 0` here and `.pretui-truncate` is
//      the caller's half.
//   3. **Physical `direction: 'row-reverse'` and `left`/`right` alignment.**
//      Everything here is logical (`flex-direction: row`, `inset-inline`,
//      `align-self`), so RTL is free rather than a second stylesheet.
//   4. **`spacing` is a free-form CSS length in Mantine.** Here `@gap` rides
// the kit's size scale so a season recompile re-rhythms every
//      Stack in the kit at once; a raw length is still accepted through
//      `@gapLength`, validated by the kit guard.

export type StackGap = 'none' | PretuiSize;
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify =
  | 'start'
  | 'center'
  | 'end'
  | 'between'
  | 'around'
  | 'evenly';

export interface StackSignature<T = unknown> {
  Args: {
    /** `vertical` (default) or `horizontal`. */
    orientation?: Orientation;
    /** Alias for `@orientation`; also accepts `row` / `column`. */
    direction?: OrientationAlias;
    /** Gap on the kit's size scale. `sm`/`md`/`lg`/`default` resolve too. */
    gap?: StackGap | SizeAlias;
    /**
     * A raw CSS length for the gap, when the scale is genuinely wrong (a
     * pixel-matched port, a `calc()` tied to a sibling). Validated by the
     * kit's caller-value guard; a rejected value falls back to `@gap`.
     */
    gapLength?: string;
    /** Cross-axis alignment. Default `stretch` vertical, `center` horizontal. */
    align?: StackAlign;
    /** Main-axis distribution. Default `start`. */
    justify?: StackJustify;
    /** Allow items to wrap onto more lines. */
    wrap?: boolean;
    /** Render as `inline-flex` rather than `flex`. */
    inline?: boolean;
    /**
     * Draw a hairline between items. **Only effective in the `@items` form**
     * — the rule is an element this component authors, and a component
     * cannot author anything between two yielded children.
     */
    dividers?: boolean;
    /**
     * The items to lay out. Supplying this switches Stack to the `<:item>`
     * form, which is what unlocks `@dividers` and the per-cell overflow fix.
     */
    items?: T[];
  };
  Blocks: {
    /** Free-form children. No dividers, no per-child overflow fix. */
    default: [];
    /** One item, with its index. Enables `@dividers`. */
    item: [T, number];
  };
  Element: HTMLDivElement;
}

/**
 * The default layout atom: one axis, one gap, logical alignment.
 *
 * ```hbs
 * <Stack @orientation='horizontal' @gap='s' @align='center'>
 *   <Button>Save</Button>
 *   <Button @appearance='plain'>Cancel</Button>
 * </Stack>
 *
 * <Stack @items={{this.rows}} @gap='m' @dividers={{true}}>
 *   <:item as |row|><RowFace @row={{row}} /></:item>
 * </Stack>
 * ```
 *
 * A class rather than a `TemplateOnlyComponent` for one reason: a
 * `const … : TemplateOnlyComponent<S>` cannot carry a type parameter, and `T`
 * flowing into `<:item>` is worth the extra lines. Same call Grid makes.
 */
export class Stack<T = unknown> extends Component<StackSignature<T>> {
  get orientation(): Orientation {
    return pretuiOrientation(
      this.args.orientation,
      this.args.direction,
      'vertical',
    );
  }
  get gap(): StackGap {
    let raw = this.args.gap;
    if (raw === undefined) {
      return 'm';
    }
    if (raw === 'none') {
      return 'none';
    }
    return pretuiSize(raw);
  }
  get align(): StackAlign {
    return (
      this.args.align ??
      (this.orientation === 'horizontal' ? 'center' : 'stretch')
    );
  }
  get justify(): StackJustify {
    return this.args.justify ?? 'start';
  }
  /** A caller length reaches CSS only through the kit guard — never
   * interpolated, never `htmlSafe`d raw. */
  get style() {
    return cssStyleFrom([
      cssDeclaration('--pretui-stack-gap', this.args.gapLength),
    ]);
  }
  /** The `<:item>` form is chosen by BOTH a block and items being present, so
   * a caller who passes items but writes free-form children still renders. */
  get usesItems(): boolean {
    return this.args.items !== undefined;
  }
  isFirst = (index: number) => index === 0;

  <template>
    <div
      class='pretui-stack'
      style={{this.style}}
      data-orientation={{this.orientation}}
      data-gap={{this.gap}}
      data-align={{this.align}}
      data-justify={{this.justify}}
      data-wrap={{if @wrap 'true' 'false'}}
      data-inline={{if @inline 'true' 'false'}}
      data-dividers={{if @dividers 'true' 'false'}}
      data-test-pretui-stack
      ...attributes
    >
      {{#if this.usesItems}}
        {{#each @items key='@identity' as |item index|}}
          {{#unless (this.isFirst index)}}
            {{#if @dividers}}
              {{! Decorative by construction: a Stack rule separates LAYOUT,
                  not sections. `role='separator'` would put a landmark in
                  the accessibility tree for a hairline that carries no
                  meaning; Radix's Separator defaults to decorative for the
                  same reason. A caller who needs the semantic one composes
                  Divider into the item. }}
              <span class='pretui-stack-rule' aria-hidden='true'></span>
            {{/if}}
          {{/unless}}
          <div class='pretui-stack-cell'>{{yield item index to='item'}}</div>
        {{/each}}
      {{else}}
        {{yield}}
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-stack {
          display: flex;
          min-inline-size: 0;
          font-size: inherit;
        }
        .pretui-stack[data-inline='true'] {
          display: inline-flex;
        }
        .pretui-stack[data-orientation='vertical'] {
          flex-direction: column;
        }
        .pretui-stack[data-orientation='horizontal'] {
          flex-direction: row;
        }
        .pretui-stack[data-wrap='true'] {
          flex-wrap: wrap;
        }
        /* Gap rides the kit's size scale, so a season recompile re-rhythms every
           Stack at once. `--pretui-stack-gap` (from @gapLength or any ancestor)
           wins where a caller genuinely needs a length. */
        .pretui-stack[data-gap='none'] {
          gap: var(--pretui-stack-gap, 0);
        }
        .pretui-stack[data-gap='xs'] {
          gap: var(--pretui-stack-gap, var(--space-1, 4px));
        }
        .pretui-stack[data-gap='s'] {
          gap: var(--pretui-stack-gap, var(--space-2, 6px));
        }
        .pretui-stack[data-gap='m'] {
          gap: var(--pretui-stack-gap, var(--space-4, 11px));
        }
        .pretui-stack[data-gap='l'] {
          gap: var(--pretui-stack-gap, var(--space-6, 19px));
        }
        .pretui-stack[data-gap='xl'] {
          gap: var(--pretui-stack-gap, var(--space-8, 34px));
        }
        /* Logical alignment throughout — RTL costs nothing. */
        .pretui-stack[data-align='start'] {
          align-items: flex-start;
        }
        .pretui-stack[data-align='center'] {
          align-items: center;
        }
        .pretui-stack[data-align='end'] {
          align-items: flex-end;
        }
        .pretui-stack[data-align='stretch'] {
          align-items: stretch;
        }
        .pretui-stack[data-align='baseline'] {
          align-items: baseline;
        }
        .pretui-stack[data-justify='start'] {
          justify-content: flex-start;
        }
        .pretui-stack[data-justify='center'] {
          justify-content: center;
        }
        .pretui-stack[data-justify='end'] {
          justify-content: flex-end;
        }
        .pretui-stack[data-justify='between'] {
          justify-content: space-between;
        }
        .pretui-stack[data-justify='around'] {
          justify-content: space-around;
        }
        .pretui-stack[data-justify='evenly'] {
          justify-content: space-evenly;
        }
        /* The cell exists to carry the overflow fix: a flex child defaults to min-size auto, so one long token blows the row
           out. The caller's half is `.pretui-truncate` on their own text. */
        .pretui-stack-cell {
          min-inline-size: 0;
          min-block-size: 0;
        }
        .pretui-stack[data-orientation='horizontal'] .pretui-stack-cell {
          display: flex;
          align-items: inherit;
        }
        .pretui-stack-rule {
          flex: none;
          align-self: stretch;
          background: var(--pretui-stack-rule-color, var(--border));
        }
        .pretui-stack[data-orientation='horizontal'] .pretui-stack-rule {
          inline-size: 1px;
        }
        .pretui-stack[data-orientation='vertical'] .pretui-stack-rule {
          block-size: 1px;
        }
      }
    </style>
  </template>
}
