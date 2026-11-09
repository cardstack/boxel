// Pretui — Tooltip usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Tooltip } from './tooltip';
import { Button } from './button';
import { SIDE_OPTIONS } from '../demo-structure';

// Dropped knobs: offset (fixed 0.375rem gap, no arg); variant (single always-dark
// treatment — "the lining"); the six boxel-tooltip-* CSS-variable knobs
// (CSS knob layer not yet ported).
class TooltipUsage extends GlimmerComponent {
  @tracked content = 'Tooltip Content';
  @tracked side = 'top';
  @tracked disabled = false;
  setDisabled = (v: boolean) => (this.disabled = v);
  setContent = (v: string) => (this.content = v);
  setSide = (v: string) => (this.side = v);
  get sideVal() {
    return this.side as 'top' | 'bottom' | 'left' | 'right';
  }
  <template>
    <FreestyleUsage
      @name='Tooltip'
      @description='Tooltips provide additional information when hovering over an element. Shown in the top layer; takes no space while hidden.'
    >
      <:example>
        <Tooltip
          @content={{this.content}}
          @side={{this.sideVal}}
          @disabled={{this.disabled}}
        >
          <Button @tone='neutral' @appearance='outlined'>Button With Tooltip</Button>
        </Tooltip>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='side'
          @description='The side the tooltip prefers; it flips when that side has no room.'
          @value={{this.side}}
          @options={{SIDE_OPTIONS}}
          @defaultValue='top'
          @onInput={{this.setSide}}
        />
        <Args.String
          @name='content'
          @description='Tooltip text. Replaces the :content block — Pretui Tooltip takes a plain string.'
          @value={{this.content}}
          @required={{true}}
          @onInput={{this.setContent}}
        />
        <Args.Bool
          @name='disabled'
          @description='Keeps the tip hidden, as while something the trigger opened covers it.'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @onInput={{this.setDisabled}}
        />
        <Args.Yield
          @description='The element the tooltip is attached to; the tooltip opens on its hover and keyboard focus.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// Menu’s page moved to demo-menu.gts with the 2026-08-13 rebuild — the
// component grew submenus, checkmark/radio items, the full APG keyboard
// contract and a shared MenuNode tree with CommandPalette, which is more
// than a page in this file should carry.

export const DEMOS_TOOLTIP: Record<string, unknown> = {
  Tooltip: TooltipUsage,
};
