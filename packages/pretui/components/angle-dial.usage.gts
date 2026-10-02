// Pretui — AngleDial usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { AngleDial } from './angle-dial';
import type { AngleUnit } from './angle-dial';

// ── AngleDial ────────────────────────────────────────────────────────────
const ANGLE_UNITS = ['deg', 'rad', 'turn'];

class AngleDialUsage extends Component {
  unitOptions = ANGLE_UNITS;

  @tracked degrees = 45;
  @tracked unit = 'deg';
  @tracked snap = 15;
  @tracked step = 1;
  @tracked precision = 1;
  @tracked showDial = true;
  @tracked showInput = true;
  @tracked rotations = true;
  @tracked disabled = false;

  set = (v: number) => (this.degrees = v);
  setUnit = (v: string) => (this.unit = v);
  setSnap = (v: number) => (this.snap = v);
  setStep = (v: number) => (this.step = v);
  setPrecision = (v: number) => (this.precision = v);
  setDial = (v: boolean) => (this.showDial = v);
  setInput = (v: boolean) => (this.showInput = v);
  setRotations = (v: boolean) => (this.rotations = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  get unitVal() {
    return this.unit as AngleUnit;
  }
  get usage() {
    return (
      "<AngleDial @label='Rotation' @value={{this.degrees}}" +
      (this.unit === 'deg' ? '' : " @unit='" + this.unit + "'") +
      ' @rotations={{true}} @onInput={{this.set}} />'
    );
  }
  <template>
    <FreestyleUsage
      @name='AngleDial'
      @description='A circular angle dial paired with a numeric field. Dragging accumulates the SHORTEST signed delta each frame, so winding clockwise through 359°→1° adds +2 rather than −358 — which is what lets the value pass 360° and keep going, and what the ×N rotation badge counts. Shift snaps to 15° while dragging; arrows step, Shift/Alt change the rate, Home/End go to the bounds. Ported from figui3 fig-input-angle.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-angle-demo'>
          <AngleDial
            @label='Rotation'
            @value={{this.degrees}}
            @unit={{this.unitVal}}
            @snap={{this.snap}}
            @step={{this.step}}
            @precision={{this.precision}}
            @showDial={{this.showDial}}
            @showInput={{this.showInput}}
            @rotations={{this.rotations}}
            @disabled={{this.disabled}}
            @onInput={{this.set}}
          />
          <p class='pretui-demo-readout' data-test-angle-readout>
            {{this.degrees}}° stored (the model is always degrees)
          </p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @value={{this.degrees}}
          @description='Angle in DEGREES, always — @unit is a display concern only. Unbounded unless @min/@max are given, so 765 stays 765.'
          @onInput={{this.set}}
        />
        <Args.String
          @name='unit'
          @defaultValue='deg'
          @value={{this.unit}}
          @options={{this.unitOptions}}
          @description='Display unit for the paired field. figui3 stores the value in this unit, which silently re-interprets the model when it changes; here the conversion is one documented function at the edge.'
          @onInput={{this.setUnit}}
        />
        <Args.Number
          @name='snap'
          @defaultValue={{15}}
          @value={{this.snap}}
          @min={{0}}
          @max={{90}}
          @description='Degrees the dial snaps to while Shift is held during a drag. 0 disables snapping.'
          @onInput={{this.setSnap}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{1}}
          @value={{this.step}}
          @description='Degrees per arrow press, before the shared Shift ×10 / Alt ×0.1 multipliers.'
          @onInput={{this.setStep}}
        />
        <Args.Number
          @name='precision'
          @defaultValue={{1}}
          @value={{this.precision}}
          @min={{0}}
          @max={{4}}
          @onInput={{this.setPrecision}}
        />
        <Args.Bool
          @name='showDial'
          @defaultValue={{true}}
          @value={{this.showDial}}
          @description='Render the circular dial.'
          @onInput={{this.setDial}}
        />
        <Args.Bool
          @name='showInput'
          @defaultValue={{true}}
          @value={{this.showInput}}
          @description='Render the paired ScrubInput — the exact-value path.'
          @onInput={{this.setInput}}
        />
        <Args.Bool
          @name='rotations'
          @defaultValue={{false}}
          @value={{this.rotations}}
          @description='Show the ×N badge AND fold the turn count into aria-valuetext, so a screen-reader user can tell 45° from 765°. Upstream renders the badge but never announces it.'
          @onInput={{this.setRotations}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Number @name='min' @description='Lower bound. Omit for an unbounded, winding dial.' />
        <Args.Number @name='max' @description='Upper bound.' />
        <Args.Action @name='onInput' @description='Continuous, in degrees.' />
        <Args.Action @name='onChange' @description='Committed, in degrees.' />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-dial-size'
          @type='length'
          @description='Diameter of the dial. Coarse pointers floor it at 44px regardless.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-angle-demo {
        max-width: 220px;
      }
      .pretui-demo-readout {
        margin: 8px 0 0;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        color: var(--muted-foreground);
        font-variant-numeric: tabular-nums;
      }
    </style>
  </template>
}

export const DEMOS_ANGLE_DIAL: Record<string, unknown> = {
  AngleDial: AngleDialUsage,
};
