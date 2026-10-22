// Pretui — Tooltip usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Tooltip } from './tooltip';
import { Button } from './button';
import { SIDE_OPTIONS } from '../demo-structure';

// Note: Pretui Tooltip is CSS-only — it reveals on hover/focus-within, with
// no floating-ui positioning or JS listeners (prerender-safe by design).
// Dropped knobs: offset (fixed 6px gap, no arg); variant (single always-dark
// treatment — "the lining"); the six boxel-tooltip-* CSS-variable knobs
// (CSS knob layer not yet ported).
class TooltipUsage extends GlimmerComponent {
  @tracked content = 'Tooltip Content';
  @tracked side = 'top';
  setContent = (v: string) => (this.content = v);
  setSide = (v: string) => (this.side = v);
  get sideVal() {
    return this.side as 'top' | 'bottom' | 'left' | 'right';
  }
  <template>
    <FreestyleUsage
      @name='Tooltip'
      @description='Tooltips provide additional information when hovering over an element. Pretui Tooltip is CSS-only — it reveals on hover and focus-within, always dark in both modes, with no JS positioning.'
    >
      <:example>
        <Tooltip @content={{this.content}} @side={{this.sideVal}}>
          <Button @tone='neutral' @appearance='outlined'>Button With Tooltip</Button>
        </Tooltip>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='side'
          @description='The positioning of the tooltip relative to the reference element.'
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
        <Args.Yield
          @description='The element the tooltip is attached to; the tooltip reveals on its hover and focus-within.'
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
