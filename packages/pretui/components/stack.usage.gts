// Pretui — Stack usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { SizeAlias } from '../internal/structure-layout';
import { Button } from './button';
import { FreestyleUsage } from './freestyle-usage';
import { Stack } from './stack';
import type { StackAlign, StackGap, StackJustify } from './stack';
import { StackDivider } from './stack-divider';
import { LOTS } from '../internal/structure-layout-fixtures';

// ── Stack ────────────────────────────────────────────────────────────────

export class StackUsage extends Component {
  @tracked orientation: 'horizontal' | 'vertical' = 'vertical';
  @tracked gap: string = 'm';
  @tracked align: string = 'stretch';
  @tracked justify: string = 'start';
  @tracked wrap = false;
  @tracked dividers = true;

  orientationOptions = ['vertical', 'horizontal'];
  gapOptions = ['none', 'xs', 's', 'm', 'l', 'xl'];
  alignOptions = ['start', 'center', 'end', 'stretch', 'baseline'];
  justifyOptions = ['start', 'center', 'end', 'between', 'around', 'evenly'];
  lots = LOTS;

  setOrientation = (v: string) => {
    this.orientation = v as 'horizontal' | 'vertical';
  };
  setGap = (v: string) => {
    this.gap = v;
  };
  setAlign = (v: string) => {
    this.align = v;
  };
  setJustify = (v: string) => {
    this.justify = v;
  };
  setWrap = (v: boolean) => {
    this.wrap = v;
  };
  setDividers = (v: boolean) => {
    this.dividers = v;
  };

  // The knob rows carry plain strings; the component takes exhaustive unions.
  // Narrowing in one getter per knob keeps the cast at the boundary instead of
  // spreading `as` through the template.
  get gapValue(): StackGap | SizeAlias {
    return this.gap as StackGap | SizeAlias;
  }
  get alignValue(): StackAlign {
    return this.align as StackAlign;
  }
  get justifyValue(): StackJustify {
    return this.justify as StackJustify;
  }

  get usage(): string {
    return [
      '<Stack',
      "  @orientation='" + this.orientation + "'",
      "  @gap='" + this.gap + "'",
      '  @items={{this.lots}}',
      '  @dividers={{' + String(this.dividers) + '}}',
      '>',
      '  <:item as |lot|>…</:item>',
      '</Stack>',
    ].join('\n');
  }

  <template>
    <FreestyleUsage
      @name='Stack'
      @description='One axis, one gap, logical alignment. Two shapes: free-form children for the ordinary case, and an items form that unlocks dividers and the per-cell overflow fix. The second shape exists because a component can only style elements it authored — a rule between two yielded children is not something CSS can reach.'
      @source={{this.usage}}
    >
      <:example>
        <div class='layout-stage'>
          <Stack
            @orientation={{this.orientation}}
            @gap={{this.gapValue}}
            @align={{this.alignValue}}
            @justify={{this.justifyValue}}
            @wrap={{this.wrap}}
            @dividers={{this.dividers}}
            @items={{this.lots}}
          >
            <:item as |lot|>
              <div class='layout-cell'>
                <p class='layout-id'>{{lot.id}}</p>
                <p class='layout-tea'>{{lot.tea}}</p>
                <p class='layout-meta'>{{lot.place}} · {{lot.chests}} chests</p>
              </div>
            </:item>
          </Stack>
        </div>

        <p class='layout-note'>Free-form children, no dividers — the shape you
          reach for nine times out of ten:</p>
        <div class='layout-stage'>
          <Stack @orientation='horizontal' @gap='s' @align='center'>
            <Button @size='s'>Save</Button>
            <Button @size='s' @appearance='outlined' @tone='neutral'>Cancel</Button>
            <StackDivider @orientation='horizontal' />
            <Button @size='s' @appearance='plain' @tone='danger'>Discard</Button>
          </Stack>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='orientation'
          @description='vertical (default) or horizontal. The alias direction is accepted too, and so are row and column, because that is what an agent copying flexbox will type.'
          @options={{this.orientationOptions}}
          @value={{this.orientation}}
          @onInput={{this.setOrientation}}
          @defaultValue='vertical'
        />
        <Args.String
          @name='gap'
          @description='Gap on the kit size scale, so a season recompile re-rhythms every Stack at once. sm, md, lg and default resolve to s, m, l and m.'
          @options={{this.gapOptions}}
          @value={{this.gap}}
          @onInput={{this.setGap}}
          @defaultValue='m'
        />
        <Args.String
          @name='gapLength'
          @description='A raw CSS length, for the case where the scale is genuinely wrong. Validated by the kit caller-value guard; a rejected value falls back to the scale.'
        />
        <Args.String
          @name='align'
          @description='Cross-axis alignment. Defaults to stretch when vertical and center when horizontal, which is what each axis actually wants.'
          @options={{this.alignOptions}}
          @value={{this.align}}
          @onInput={{this.setAlign}}
          @defaultValue='stretch'
        />
        <Args.String
          @name='justify'
          @description='Main-axis distribution.'
          @options={{this.justifyOptions}}
          @value={{this.justify}}
          @onInput={{this.setJustify}}
          @defaultValue='start'
        />
        <Args.Bool
          @name='wrap'
          @description='Allow items onto more lines.'
          @defaultValue={{false}}
          @value={{this.wrap}}
          @onInput={{this.setWrap}}
        />
        <Args.Bool
          @name='dividers'
          @description='Draw a hairline between items. Only effective in the items form — a rule is an element this component authors, and nothing can be authored between two yielded children.'
          @defaultValue={{false}}
          @value={{this.dividers}}
          @onInput={{this.setDividers}}
        />
        <Args.Array
          @name='items'
          @description='Supplying items switches Stack to the item block form, where each cell carries min-inline-size 0 — the flex overflow bug fixed by construction rather than by remembering.'
        />
        <Args.Yield
          @name='item'
          @description='One item and its index. The typed replacement for React Children.map, which miscounts across fragments and conditional branches.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-stack-gap'
          @type='dimension'
          @description='Overrides the gap scale from any ancestor.'
          @defaultValue='var(--space-4)'
        />
        <Css.Basic
          @name='pretui-stack-rule-color'
          @type='color'
          @description='The hairline colour used by dividers.'
          @defaultValue='var(--border)'
        />
      </:cssVars>
    </FreestyleUsage>

    <style scoped>
      .layout-stage {
        padding: var(--space-5, 14px);
        border-radius: var(--radius-surface, 10px);
        background: var(--card);
        box-shadow: var(
          --pretui-shadow-hairline,
          0 0 0 1px var(--border)
        );
      }
      .layout-note {
        margin: var(--space-5, 14px) 0 var(--space-3, 8px);
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .layout-cell {
        padding: var(--space-3, 8px);
      }
      .layout-id {
        margin: 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-eyebrow, 0.08em);
        color: var(--muted-foreground);
      }
      .layout-tea {
        margin: 2px 0 0;
        font-size: var(--text-ui-md, 12.5px);
        font-weight: 600;
      }
      .layout-meta {
        margin: 1px 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_STACK: Record<string, unknown> = {
  Stack: StackUsage,
};
