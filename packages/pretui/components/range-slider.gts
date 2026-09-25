// Pretui — RangeSlider: Slider with range mode forced on, under the Mantine / Ant / MUI name.
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { Slider } from './slider';
import type { SliderSignature } from './slider';

export interface RangeSliderSignature {
  Args: Omit<
    SliderSignature['Args'],
    'range' | 'value' | 'defaultValue' | 'onChange' | 'onValueChange'
  >;
  Element: HTMLDivElement;
}

// Slider with range mode forced on, under the Mantine / Ant / MUI name; the
// single-value args have no meaning here and are not forwarded.
export const RangeSlider: TemplateOnlyComponent<RangeSliderSignature> =
  <template>
    <Slider
      @range={{true}}
      @values={{@values}}
      @defaultValues={{@defaultValues}}
      @onValuesChange={{@onValuesChange}}
      @onRangeChange={{@onRangeChange}}
      @label={{@label}}
      @min={{@min}}
      @max={{@max}}
      @step={{@step}}
      @ticks={{@ticks}}
      @interval={{@interval}}
      @formatValue={{@formatValue}}
      @maxTicks={{@maxTicks}}
      ...attributes
    />
  </template>;
