// Pretui — StatusChip usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from '../freestyle';
import { StatusChip } from '../ink';

class StatusChipUsage extends GlimmerComponent {
  @tracked value = 'in progress';
  setValue = (v: string) => (this.value = v);
  <template>
    <FreestyleUsage
      @name='StatusChip'
      @description='A Chip whose hue is derived by hashing the value — same value, same color, every card, no configuration. Type any status below and watch it keep a stable hue.'
    >
      <:example>
        <StatusChip @value={{this.value}} />
        <StatusChip @value='overdue' />
        <StatusChip @value='review' />
        <StatusChip @value='active' />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @value={{this.value}}
          @required={{true}}
          @description='The status text; its hash picks one of the five chart hues deterministically.'
          @onInput={{this.setValue}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_STATUS_CHIP: Record<string, unknown> = {
  StatusChip: StatusChipUsage,
};
