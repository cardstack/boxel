// Pretui — EasingCurve usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { EasingCurve, bezierCss } from './easing-curve';
import type { CubicBezier } from './easing-curve';

class EasingCurveUsage extends Component {
  @tracked curve: CubicBezier = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
  @tracked presets = true;
  @tracked fields = true;
  @tracked preview = true;
  @tracked duration: number | null = 1200;
  @tracked precision = 2;
  @tracked disabled = false;

  set = (v: CubicBezier) => (this.curve = v);
  setPresets = (v: boolean) => (this.presets = v);
  setFields = (v: boolean) => (this.fields = v);
  setPreview = (v: boolean) => (this.preview = v);
  setDuration = (v: number | null) => (this.duration = v);
  setPrecision = (v: number) => (this.precision = v);
  setDisabled = (v: boolean) => (this.disabled = v);

  get durationVal() {
    return this.duration ?? 1200;
  }
  get css() {
    return bezierCss(this.curve);
  }
  get usage() {
    return (
      '<EasingCurve @value={{this.curve}} @onChange={{this.set}} />\n' +
      '{{! yields ' + this.css + ' }}'
    );
  }
  <template>
    <FreestyleUsage
      @name='EasingCurve'
      @description='A cubic-bezier editor: drag either control point, press anywhere on the plot to grab the nearer one, or type the four numbers. The plot spans y ∈ [−0.5, 1.5] with rules at 0 and 1, so overshoot curves like back-out are reachable by dragging — figui3 clamps the handles to the box and makes them unreachable. Each handle is the shared Handle primitive, so arrows move it with the same Shift/Alt multipliers as every other gesture in the kit. The travelling dot uses the value as its own animation-timing-function, and rests at the end state under prefers-reduced-motion. Ported from figui3 fig-easing-curve; its spring mode is deliberately left to the motion territory.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-curve-demo'>
          <EasingCurve
            @value={{this.curve}}
            @presets={{this.presets}}
            @fields={{this.fields}}
            @preview={{this.preview}}
            @previewDuration={{this.durationVal}}
            @precision={{this.precision}}
            @disabled={{this.disabled}}
            @onInput={{this.set}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='value'
          @description='{ x1, y1, x2, y2 } — the four cubic-bezier coordinates. Controlled; omit and seed @defaultValue for uncontrolled use.'
        />
        <Args.Bool
          @name='presets'
          @defaultValue={{true}}
          @value={{this.presets}}
          @description='Render the preset picker (the CSS-named easings plus back-in / back-out / anticipate).'
          @onInput={{this.setPresets}}
        />
        <Args.Bool
          @name='fields'
          @defaultValue={{true}}
          @value={{this.fields}}
          @description='Render the four numeric fields — the exact-value path that makes dragging an enhancement rather than the only way to author a curve.'
          @onInput={{this.setFields}}
        />
        <Args.Bool
          @name='preview'
          @defaultValue={{true}}
          @value={{this.preview}}
          @description='Render the travelling preview dot.'
          @onInput={{this.setPreview}}
        />
        <Args.Number
          @name='previewDuration'
          @defaultValue={{1200}}
          @value={{this.duration}}
          @min={{100}}
          @max={{4000}}
          @description='Preview duration in ms. Clamped to 100–10000 before it reaches CSS.'
          @onInput={{this.setDuration}}
        />
        <Args.Number
          @name='precision'
          @defaultValue={{2}}
          @value={{this.precision}}
          @min={{1}}
          @max={{4}}
          @onInput={{this.setPrecision}}
        />
        <Args.Bool
          @name='disabled'
          @defaultValue={{false}}
          @value={{this.disabled}}
          @onInput={{this.setDisabled}}
        />
        <Args.String @name='label' @description='Accessible name for the control group.' />
        <Args.Action @name='onInput' @description='Continuous, while dragging.' />
        <Args.Action @name='onChange' @description='On release, and on every field or preset commit.' />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-curve-demo {
        max-width: 240px;
        container-type: inline-size;
      }
    </style>
  </template>
}

export const DEMOS_EASING_CURVE: Record<string, unknown> = {
  EasingCurve: EasingCurveUsage,
};
