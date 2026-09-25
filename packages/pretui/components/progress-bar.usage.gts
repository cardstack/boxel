// Pretui — ProgressBar usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { ProgressBar } from '../feedback';

// ── ProgressBar ← progress-bar/usage.gts ─────────────────────────────────
// Dropped knobs: position (the label/count header layout is fixed — label
// left, count right).
class ProgressBarUsage extends GlimmerComponent {
  @tracked value = 20;
  @tracked max = 100;
  @tracked label = 'Task progress';
  @tracked count = '';
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
  toggleSteps = (v: boolean) => (this.steps = v);
  get labelVal() {
    return this.label || undefined;
  }
  get countVal() {
    return this.count || undefined;
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
          @description='Custom label for the progress bar'
          @value={{this.label}}
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='count'
          @description='Override the count text, e.g. "3 / 6" — defaults to a percentage (Pretui addition).'
          @value={{this.count}}
          @onInput={{this.setCount}}
        />
        <Args.Bool
          @name='steps'
          @description='Discrete stepped track for small totals (Pretui addition).'
          @defaultValue={{false}}
          @value={{this.steps}}
          @onInput={{this.toggleSteps}}
        />
      </:api>
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
