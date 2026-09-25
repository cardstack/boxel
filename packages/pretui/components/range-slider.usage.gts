// Pretui — RangeSlider usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { RangeSlider } from './range-slider';

class RangeSliderUsage extends Component {
  @tracked values: [number, number] = [1960, 2000];
  setValues = (values: [number, number]) => (this.values = values);
  formatYear = (v: number) => String(v);
  <template>
    <FreestyleUsage
      @name='RangeSlider'
      @description='Slider with range mode forced on, under the Mantine / Ant / MUI name: two thumbs over one rail, each a native range input. Reach for this import when a port or an agent already speaks that vocabulary and the value is always a pair; the engine, its accessibility and its theming are Slider’s.'
      @source="<RangeSlider @label='Vintage' @values={{this.values}} @min={{1954}} @max={{2004}} @interval={{10}} @onValuesChange={{this.setValues}} />"
    >
      <:example>
        <RangeSlider
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
        <Args.Object @name='values' @value={{this.values}} @description='The [lower, upper] pair; MUI’s value array, Mantine’s value tuple.' />
        <Args.Object @name='defaultValues' @description='Uncontrolled seed for the pair.' />
        <Args.Action @name='onValuesChange' @description='Fires with the whole next pair. @onRangeChange is the Radix / Mantine spelling of the same callback.' />
        <Args.Number @name='min' @defaultValue={{0}} />
        <Args.Number @name='max' @defaultValue={{100}} />
        <Args.Number @name='step' @defaultValue={{1}} />
        <Args.Number @name='interval' @description='Snap to a derived ladder and widen the rail to its boundaries.' />
        <Args.Action @name='formatValue' @description='Feeds aria-valuetext and derived tick labels.' />
        <Args.Object @name='ticks' @description='Optional visible tick labels.' />
        <Args.Number @name='maxTicks' @defaultValue={{12}} />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_RANGE_SLIDER: Record<string, unknown> = {
  RangeSlider: RangeSliderUsage,
};
