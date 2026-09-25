// Pretui — ProgressRadial usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { ProgressRadial } from './progress-radial';

// ── ProgressRadial ← progress-radial/usage.gts ───────────────────────────
class ProgressRadialUsage extends GlimmerComponent {
  @tracked value = 20;
  @tracked max = 100;
  @tracked size = 48;
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
  setSize = (v: number | null) => {
    if (v !== null) {
      this.size = v;
    }
  };
  <template>
    <FreestyleUsage
      @name='ProgressRadial'
      @description='A circular progress indicator to show completion of a task'
    >
      <:example>
        <ProgressRadial
          @value={{this.value}}
          @max={{this.max}}
          @size={{this.size}}
        />
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
        <Args.Number
          @name='size'
          @description='Ring diameter in px (Pretui addition).'
          @defaultValue={{28}}
          @value={{this.size}}
          @min={{16}}
          @max={{96}}
          @step={{4}}
          @onInput={{this.setSize}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_PROGRESS_RADIAL: Record<string, unknown> = {
  ProgressRadial: ProgressRadialUsage,
};
