// Pretui — Slider usage page (single + range cuts of the same component).
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { FreestyleUsage } from './freestyle-usage';
import { Slider } from './slider';

export class SliderSingleUsage extends Component {
  @tracked value = 64;
  ticks = [40, 50, 60, 70, 80];
  setValue = (value: number) => (this.value = value);
  <template>
    <FreestyleUsage
      @name='Slider'
      @description='A native range input with a visible label, tabular value and token-driven rail. Keyboard, touch and pointer behavior stay with the platform. Both thumb pseudo-elements are styled, so Firefox gets the same control as WebKit rather than the UA default.'
      @source='<Slider @label="Humidity" @min="40" @max="80" … />'
    >
      <:example>
        <Slider @label='Curing-room humidity' @value={{this.value}} @min={{40}} @max={{80}} @step={{1}} @ticks={{this.ticks}} @onValueChange={{this.setValue}} />
      </:example>
      <:api as |Args|>
        <Args.Number @name='value' @value={{this.value}} @min={{40}} @max={{80}} @onInput={{this.setValue}} />
        <Args.Number @name='min' @defaultValue={{0}} />
        <Args.Number @name='max' @defaultValue={{100}} />
        <Args.Number @name='step' @defaultValue={{1}} />
        <Args.Object @name='ticks' @value={{this.ticks}} @description='Optional visible tick labels.' />
        <Args.Action @name='onValueChange' />
      </:api>
    </FreestyleUsage>
  </template>
}

// Range mode is the same component, not a second one: two overlaid native
// range inputs on one rail, so the keyboard, touch and pointer capture stay
// the platform's.
export class SliderRangeUsage extends Component {
  @tracked values: [number, number] = [1960, 2000];
  setValues = (values: [number, number]) => (this.values = values);
  formatYear = (v: number) => String(v);
  <template>
    <FreestyleUsage
      @name='Slider (range)'
      @description='Two thumbs over a derived ladder of intervals. One native range input cannot carry two thumbs, so range mode is two of them stacked on one rail — which keeps arrows, PageUp/PageDown, Home/End, touch and pointer capture as the platform’s rather than a re-implementation. The two failures that pattern usually has are both closed: the rail ignores the pointer and only the thumbs take it, so the two never swallow each other’s drags, and when they coincide the trapped thumb is the one raised, not always the lower one. @interval widens the rail to the enclosing interval boundaries so every stop is a meaningful decade, price band or size bucket, and @formatValue feeds aria-valuetext so the reader hears “1960”, not “2”.'
      @source='<Slider @label="Vintage" @range={{true}} @values={{this.values}} @min={{1954}} @max={{2004}} @interval={{10}} @formatValue={{this.formatYear}} @onValuesChange={{this.setValues}} />'
    >
      <:example>
        <Slider
          @label='Vintage'
          @values={{this.values}}
          @min={{1954}}
          @max={{2004}}
          @interval={{10}}
          @formatValue={{this.formatYear}}
          @onValuesChange={{this.setValues}}
        />
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='range'
          @description='Two-thumb mode. Inferred whenever values or defaultValues is supplied, so it is rarely written.'
        />
        <Args.Object
          @name='values'
          @value={{this.values}}
          @description='The [lower, upper] pair. Each thumb clamps against its sibling rather than against its own bounds, so an over-drag parks on the neighbour instead of silently doing nothing.'
        />
        <Args.Number
          @name='interval'
          @defaultValue={{10}}
          @description='Snap to a derived ladder and widen the rail to floor(min/interval)·interval … ceil(max/interval)·interval.'
        />
        <Args.Action
          @name='formatValue'
          @description='Renders a value for aria-valuetext and for derived tick labels. Without it a stepped slider announces the raw number.'
        />
        <Args.Number
          @name='maxTicks'
          @defaultValue={{12}}
          @description='Cap on derived tick labels; every Nth is drawn, so a 1–1000 rail does not try to paint a thousand markers.'
        />
        <Args.Action
          @name='onValuesChange'
          @description='Fires with the whole next [lower, upper] pair.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

// The Slider page shows both cuts of the same component — one thumb and two.
// Registered once, because it IS one component.
export const SliderUsage: TemplateOnlyComponent = <template>
  <SliderSingleUsage />
  <SliderRangeUsage />
</template>;

export const DEMOS_SLIDER: Record<string, unknown> = {
  Slider: SliderUsage,
};
