// Pretui — OriginGrid usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import type { Point2 } from './joystick';
import { OriginGrid } from './origin-grid';

// ── OriginGrid ───────────────────────────────────────────────────────────
class OriginGridUsage extends Component {
  @tracked point: Point2 = { x: 50, y: 50 };
  @tracked drag = true;
  @tracked fields = false;
  @tracked disabled = false;

  set = (v: Point2) => (this.point = v);
  setDrag = (v: boolean) => (this.drag = v);
  setFields = (v: boolean) => (this.fields = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  get usage() {
    return "<OriginGrid @label='Transform origin' @value={{this.point}} @onChange={{this.set}} />";
  }
  <template>
    <FreestyleUsage
      @name='OriginGrid'
      @description='The nine-point anchor picker — transform-origin, alignment, gravity. The anchors are a real role=radiogroup: one tab stop, arrows moving in TWO dimensions across the grid, Home/End to the corners, and a selected anchor announced by NAME (“Bottom right”), not by coordinates. figui3 renders the nine cells as spans with no keyboard at all. Free positions between the anchors are an enhancement: drag snaps to the anchors and the thirds, Alt suspends snapping, and an off-anchor value reads as the word “Custom”.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-origin-demo'>
          <OriginGrid
            @label='Transform origin'
            @value={{this.point}}
            @freeform={{this.drag}}
            @fields={{this.fields}}
            @disabled={{this.disabled}}
            @onChange={{this.set}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='value'
          @description='{ x, y } as percentages, 0–100. The centre is 50/50.'
        />
        <Args.Bool
          @name='freeform'
          @defaultValue={{true}}
          @value={{this.drag}}
          @description='Allow free positions between the anchors. With it off the control is exactly nine choices.'
          @onInput={{this.setDrag}}
        />
        <Args.Bool
          @name='fields'
          @defaultValue={{false}}
          @value={{this.fields}}
          @description='Render the X/Y spinbuttons. Off by default — most panels only need the nine anchors.'
          @onInput={{this.setFields}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Number @name='precision' @defaultValue={{0}} @description='Decimal places in the fields and the status line.' />
        <Args.Action @name='onChange' @description='Receives { x, y }.' />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-origin-size'
          @type='length'
          @description='Edge of the square pad (default 76px).'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-origin-demo {
        max-width: 220px;
      }
    </style>
  </template>
}

export const DEMOS_ORIGIN_GRID: Record<string, unknown> = {
  OriginGrid: OriginGridUsage,
};
