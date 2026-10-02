// Pretui — GradientEditor usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { DEFAULT_GRADIENT } from '../color-engine';
import type { GradientSpec } from '../color-engine';
import { FreestyleUsage } from './freestyle-usage';
import { GradientEditor } from './gradient-editor';

// ── GradientEditor ───────────────────────────────────────────────────────
class GradientEditorUsage extends Component {
  @tracked spec: GradientSpec = DEFAULT_GRADIENT;
  @tracked lockInterpolation = false;
  setSpec = (next: GradientSpec) => (this.spec = next);
  setLock = (v: boolean) => (this.lockInterpolation = v);
  get css() {
    return this.spec.stops.length ? this.spec.interpolation : '';
  }
  get usage() {
    return '<GradientEditor @value={{this.spec}} @onValueChange={{this.setSpec}} />';
  }
  <template>
    <FreestyleUsage
      @name='GradientEditor'
      @description="Gradient type, angle and centre, a stop list with add / distribute / flip / rotate, and — the part most pickers miss — the INTERPOLATION colour space. Switch it from OKLab to sRGB and watch the middle go muddy; that difference is exactly why OKLCH matters. Click the bar to insert a stop: the new stop SAMPLES the ramp at that point, so insertion is a no-op on what is rendered."
      @source={{this.usage}}
    >
      <:example>
        <GradientEditor
          @value={{this.spec}}
          @lockInterpolation={{this.lockInterpolation}}
          @onValueChange={{this.setSpec}}
        />
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='value'
          @description='The gradient spec: kind, angle, centre, interpolation space, hue path, and stops.'
          @value={{this.spec}}
        />
        <Args.Bool
          @name='lockInterpolation'
          @defaultValue={{false}}
          @description='Hide the interpolation-space control.'
          @value={{this.lockInterpolation}}
          @onInput={{this.setLock}}
        />
        <Args.Action
          @name='onValueChange'
          @description='Receives the whole spec on every change.'
        />
      </:api>
      <:description>
        <p>The
          <code>&lt;:bar&gt;</code>
          block is the seam with the design-tools port: this component owns the
          model, the stop colours and the interpolation space; a
          <code>GradientInput</code>
          rendered in that block owns stop positions and dragging. Until one
          lands, the built-in bar is the default.</p>
        <p>Stops are sorted only at paint time, so a stop dragged past its
          neighbour keeps its identity and its selection.</p>
      </:description>
    </FreestyleUsage>
  </template>
}

export const DEMOS_GRADIENT_EDITOR: Record<string, unknown> = {
  GradientEditor: GradientEditorUsage,
};
