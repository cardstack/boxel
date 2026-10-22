// Pretui — TaskRow usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { TaskRow } from './task-row';
import type { TaskRowDetail } from './task-row';

const TASK_STATES = ['pending', 'running', 'completed', 'failed'];

const TASK_DETAILS: TaskRowDetail[] = [
  { id: 'd1', label: 'Lots repriced', meta: '7 of 18' },
  { id: 'd2', label: 'Median move', meta: '+9.4%' },
  { id: 'd3', label: 'Receipt', meta: 'changeset-m3k1' },
];

class TaskRowUsage extends GlimmerComponent {
  @tracked state = 'running';
  @tracked open = true;
  @tracked flat = false;

  setState = (state: string) => (this.state = state);
  setOpen = (open: boolean) => (this.open = open);
  setFlat = (flat: boolean) => (this.flat = flat);

  get stateValue(): 'pending' | 'running' | 'completed' | 'failed' {
    return this.state as 'pending' | 'running' | 'completed' | 'failed';
  }
  get statusText(): string | undefined {
    return this.stateValue === 'failed'
      ? 'Failed — Colombo freight quote expired'
      : undefined;
  }

  <template>
    <FreestyleUsage
      @name='TaskRow'
      @description='One row of an agent work queue, closed by default because settled work has earned quiet, and opening it shows the receipt — the named sub-results with their figures. State is never colour alone: completed carries a check AND the word, failed carries a cross AND the named error (pass @statusText and name it — the default "Failed" is a placeholder, not an explanation), and pending/running carry the queue position inside the ring. The row header is a real button with aria-expanded and aria-controls; the details panel is `inert` while shut, so a keyboard user cannot tab into rows they cannot see — the original left it in the tab order and mutated borderRadius inline instead of expressing it as a CSS state.'
    >
      <:example>
        <div class='demo-stack'>
          <TaskRow
            @state={{this.stateValue}}
            @index={{3}}
            @label='Reprice the Kandy lots against the 2025 mean'
            @amount='18 lots'
            @statusText={{this.statusText}}
            @details={{TASK_DETAILS}}
            @open={{this.open}}
            @onOpenChange={{this.setOpen}}
            @flat={{this.flat}}
          />
          <TaskRow
            @state='completed'
            @label='Draft the buying note'
            @amount='1 doc'
            @details={{TASK_DETAILS}}
            @flat={{this.flat}}
          />
          <TaskRow
            @state='pending'
            @index={{5}}
            @label='Submit the bid (waiting on approval)'
            @flat={{this.flat}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='state'
          @description='pending · running · completed · failed. Running spins the ring arc; reduced motion stops it at a static arc rather than at a blank circle.'
          @value={{this.state}}
          @options={{TASK_STATES}}
          @onInput={{this.setState}}
          @defaultValue='pending'
        />
        <Args.Object
          @name='details'
          @description='The receipt: { id, label, meta? }. Meta is set as a machine value (mono, tabular). With no details the row renders as a static line rather than a button that opens nothing — a control that does nothing is worse than no control.'
          @value={{TASK_DETAILS}}
        />
        <Args.Bool
          @name='open'
          @description='Controlled disclosure; uncontrolled it starts from @defaultOpen.'
          @value={{this.open}}
          @onInput={{this.setOpen}}
          @defaultValue={{false}}
        />
        <Args.Bool
          @name='flat'
          @description='Drops the capsule shadow and radius for a dense stack — the same row in a list frame rather than on its own.'
          @value={{this.flat}}
          @onInput={{this.setFlat}}
          @defaultValue={{false}}
        />
        <Args.Base
          @name='label / index / amount / statusText / onOpenChange'
          @description='The claim, the queue position shown inside the ring, the right-hand tabular figure (hidden below a 24rem container), the pill wording, and the disclosure callback.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='default'
          @description='Extra receipt content below the detail rows — a DiffBlock, a ResultCard, an embedded chart.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .demo-stack {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
    </style>
  </template>
}

export const DEMOS_TASK_ROW: Record<string, unknown> = {
  TaskRow: TaskRowUsage,
};
