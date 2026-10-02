// Pretui — Joystick usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { Joystick } from './joystick';
import type { Point2 } from './joystick';

// ── Joystick ─────────────────────────────────────────────────────────────
const COORDINATES = ['screen', 'math'];

class JoystickUsage extends Component {
  coordinateOptions = COORDINATES;

  @tracked point: Point2 = { x: 30, y: 70 };
  @tracked coordinates = 'screen';
  @tracked fields = true;
  @tracked step = 1;
  @tracked precision = 0;
  @tracked labelled = false;
  @tracked disabled = false;

  set = (v: Point2) => (this.point = v);
  setCoordinates = (v: string) => (this.coordinates = v);
  setFields = (v: boolean) => (this.fields = v);
  setStep = (v: number) => (this.step = v);
  setPrecision = (v: number) => (this.precision = v);
  setLabelled = (v: boolean) => (this.labelled = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  get coordinatesVal() {
    return this.coordinates as 'screen' | 'math';
  }
  get axisLabels(): [string, string, string, string] | undefined {
    return this.labelled ? ['W', 'E', 'N', 'S'] : undefined;
  }
  get readout() {
    return Math.round(this.point.x) + ', ' + Math.round(this.point.y);
  }
  get usage() {
    return '<Joystick @label=\'Light source\' @value={{this.point}} @onChange={{this.set}} />';
  }
  <template>
    <FreestyleUsage
      @name='Joystick'
      @description='A 2D position pad with alignment guides and paired X/Y spinbuttons. ARIA has no two-dimensional slider, so the keyboard contract is a named handle with arrow movement (shared keyboardNudge multipliers) PLUS the two spinbuttons carrying the exact numbers — a pointer-only pad would be incomplete. Shift locks to the dominant axis, which figui3 does not do at all. Ported from figui3 fig-joystick.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-joystick-demo'>
          <Joystick
            @label='Light source'
            @value={{this.point}}
            @coordinates={{this.coordinatesVal}}
            @fields={{this.fields}}
            @step={{this.step}}
            @precision={{this.precision}}
            @axisLabels={{this.axisLabels}}
            @disabled={{this.disabled}}
            @onInput={{this.set}}
          />
          <p class='pretui-demo-readout' data-test-joystick-readout>
            reported = {{this.readout}}
          </p>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='value'
          @description='{ x, y } as percentages, 0–100. Controlled; omit and seed @defaultValue for uncontrolled use.'
        />
        <Args.String
          @name='coordinates'
          @defaultValue='screen'
          @value={{this.coordinates}}
          @options={{this.coordinateOptions}}
          @description="'screen' puts 0,0 at the top left (the CSS frame); 'math' puts it at the bottom left. Only the REPORTED y flips — the handle is drawn in screen space either way."
          @onInput={{this.setCoordinates}}
        />
        <Args.Bool
          @name='fields'
          @defaultValue={{true}}
          @value={{this.fields}}
          @description='Render the X/Y spinbuttons. They are the exact-value path and the reason the pad itself can be a plain grip.'
          @onInput={{this.setFields}}
        />
        <Args.Number
          @name='step'
          @defaultValue={{1}}
          @value={{this.step}}
          @description='Percent per arrow press, before the shared modifiers.'
          @onInput={{this.setStep}}
        />
        <Args.Number
          @name='precision'
          @defaultValue={{0}}
          @value={{this.precision}}
          @min={{0}}
          @max={{3}}
          @onInput={{this.setPrecision}}
        />
        <Args.Bool
          @name='axisLabels'
          @defaultValue={{false}}
          @value={{this.labelled}}
          @description='Demo toggle for the four edge labels [left, right, top, bottom] — aria-hidden, because the handle already announces its position.'
          @onInput={{this.setLabelled}}
        />
        <Args.Object
          @name='origin'
          @description='Where the reset control returns to. Defaults to 50/50.'
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.Action @name='onInput' @description='Continuous, in the chosen coordinate frame.' />
        <Args.Action @name='onChange' @description='On release, and on every field commit.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-joystick-demo {
        max-width: 220px;
        container-type: inline-size;
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

export const DEMOS_JOYSTICK: Record<string, unknown> = {
  Joystick: JoystickUsage,
};
