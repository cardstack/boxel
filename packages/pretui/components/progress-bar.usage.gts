// Pretui — ProgressBar usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ProgressBar } from './progress-bar';

// The hue knob's choices: the default plus the state hues every season
// defines. Info and attention are the kit's `--pretui-*` tokens; the seasons
// do not define a bare `--info` or `--attention`.
const DEFAULT_HUE = 'var(--primary)';
const HUES = [
  DEFAULT_HUE,
  'var(--success)',
  'var(--warning)',
  'var(--pretui-attention)',
  'var(--destructive)',
  'var(--pretui-info)',
];

// ── ProgressBar ← progress-bar/usage.gts ─────────────────────────────────
// Dropped knobs: position (the label/count header layout is fixed — label
// left, count right).
class ProgressBarUsage extends GlimmerComponent {
  @tracked value = 20;
  @tracked max = 100;
  @tracked label = 'Task progress';
  @tracked count = '';
  @tracked valueText = '';
  @tracked hue = DEFAULT_HUE;
  @tracked steps = false;
  setValue = (v: number | null) => {
    if (v !== null) {
      this.value = v;
    }
  };
  setMax = (v: number | null) => {
    if (v !== null) {
      this.max = v;
    }
  };
  setLabel = (v: string) => (this.label = v);
  setCount = (v: string) => (this.count = v);
  setValueText = (v: string) => (this.valueText = v);
  setHue = (v: string) => (this.hue = v);
  toggleSteps = (v: boolean) => (this.steps = v);
  get labelVal() {
    return this.label || undefined;
  }
  get countVal() {
    return this.count || undefined;
  }
  get valueTextVal() {
    return this.valueText || undefined;
  }
  get hueVal() {
    return this.hue === DEFAULT_HUE ? undefined : this.hue;
  }
  get usage() {
    let bits = [`@value={{${this.value}}}`];
    if (this.max !== 100) {
      bits.push(`@max={{${this.max}}}`);
    }
    if (this.label) {
      bits.push(`@label='${this.label}'`);
    }
    if (this.count) {
      bits.push(`@count='${this.count}'`);
    }
    if (this.valueText) {
      bits.push(`@valueText='${this.valueText}'`);
    }
    if (this.hueVal) {
      bits.push(`@hue='${this.hueVal}'`);
    }
    if (this.steps) {
      bits.push('@steps={{true}}');
    }
    return `<ProgressBar ${bits.join(' ')} />`;
  }
  <template>
    <FreestyleUsage
      @name='ProgressBar'
      @description='A progress bar component to show completion of a task'
      @source={{this.usage}}
    >
      <:example>
        <div class='bar-col'>
          <ProgressBar
            @value={{this.value}}
            @max={{this.max}}
            @label={{this.labelVal}}
            @count={{this.countVal}}
            @valueText={{this.valueTextVal}}
            @hue={{this.hueVal}}
            @steps={{this.steps}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.Number
          @name='value'
          @description='Current value of the progress'
          @value={{this.value}}
          @min={{0}}
          @max={{this.max}}
          @step={{1}}
          @onInput={{this.setValue}}
        />
        <Args.Number
          @name='max'
          @description='Maximum value of the progress'
          @defaultValue={{100}}
          @value={{this.max}}
          @min={{1}}
          @max={{100}}
          @step={{1}}
          @onInput={{this.setMax}}
        />
        <Args.String
          @name='label'
          @description='Visible label, and the progress bar’s accessible name. Without it the bar is named “Progress”; for a specific name with no header, pass aria-label or aria-labelledby, which land on the progressbar element.'
          @value={{this.label}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='count'
          @description='Override the count text, e.g. "3 / 6" — defaults to a percentage (Pretui addition).'
          @value={{this.count}}
          @onInput={{this.setCount}}
        />
        <Args.String
          @name='valueText'
          @description='Announced reading of the value (aria-valuetext) when the number alone would mislead — defaults to @count in stepped mode; a continuous bar announces a percentage (Pretui addition).'
          @value={{this.valueText}}
          @onInput={{this.setValueText}}
        />
        <Args.String
          @name='hue'
          @description='Any CSS colour for the fill and lit segments, typically a state hue. Sets --pretui-progress-hue, which can also be set on any ancestor; defaults to --primary (Pretui addition).'
          @value={{this.hue}}
          @options={{HUES}}
          @defaultValue={{DEFAULT_HUE}}
          @onInput={{this.setHue}}
        />
        <Args.Bool
          @name='steps'
          @description='Discrete stepped track for small totals (Pretui addition).'
          @defaultValue={{false}}
          @value={{this.steps}}
          @onInput={{this.toggleSteps}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-progress-hue'
          @type='color'
          @description='Colour of the fill and the lit segments. Set on the bar or any ancestor, or through @hue.'
          @defaultValue='var(--primary)'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .bar-col {
        width: min(100%, 320px);
      }
    </style>
  </template>
}

export const DEMOS_PROGRESS_BAR: Record<string, unknown> = {
  ProgressBar: ProgressBarUsage,
};
