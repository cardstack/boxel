// Pretui — Meter usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { Meter } from '../ink';

class MeterUsage extends GlimmerComponent {
  @tracked level = 3;
  @tracked label = 'High confidence';
  setLevel = (v: number | null) => (this.level = v ?? 0);
  setLabel = (v: string) => (this.label = v);
  <template>
    <FreestyleUsage
      @name='Meter'
      @description='Discrete strength meter (role=meter). Discrete beats continuous: qualitative judgments get countable bars, not percentages — Progress is for quantities.'
    >
      <:example>
        <Meter @level={{this.level}} @label={{this.label}} />
        <Meter @level={{1}} @label='Weak' @hue='var(--warning)' />
        <Meter @level={{0}} @label='No signal' />
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='level'
          @value={{this.level}}
          @min={{0}}
          @max={{3}}
          @description='How many of the three bars are lit.'
          @onInput={{this.setLevel}}
        />
        <Args.String
          @name='label'
          @value={{this.label}}
          @description='The judgment the bars quantify; also the accessible name.'
          @onInput={{this.setLabel}}
        />
        <Args.Base
          @name='hue'
          @typeLabel='String'
          @description='Optional hue override; defaults to primary.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_METER: Record<string, unknown> = {
  Meter: MeterUsage,
};
