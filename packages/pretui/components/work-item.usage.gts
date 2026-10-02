// Pretui — WorkItem usage page.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { WorkItem } from './work-item';

const WORK_TIERS = ['step', 'action', 'run'];

const WORK_STATES = [
  'pending',
  'preparing',
  'running',
  'applying',
  'handoff',
  'reconnecting',
  'host-attached',
  'fallback',
  'ready',
  'awaiting-approval',
  'ask',
  'input',
  'completed',
  'kept',
  'delivered',
  'failed',
  'invalid',
  'reverted',
  'canceled',
];

class WorkItemUsage extends GlimmerComponent {
  @tracked tier = 'action';
  @tracked state = 'awaiting-approval';
  @tracked verb = 'EDIT';
  @tracked title = 'menu.json — add two teas';
  setTier = (v: string) => (this.tier = v);
  setState = (v: string) => (this.state = v);
  setVerb = (v: string) => (this.verb = v);
  setTitle = (v: string) => (this.title = v);
  get tierVal() {
    return this.tier as 'step' | 'action' | 'run';
  }
  <template>
    <FreestyleUsage
      @name='WorkItem'
      @description='The agentic work row at three densities (step / action / run) across the full state machine. Color never carries state alone — every state renders status text; the magenta attention treatment is reserved for "a human must act now".'
    >
      <:example>
        <WorkItem
          @tier={{this.tierVal}}
          @state={{this.state}}
          @verb={{this.verb}}
          @title={{this.title}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='tier'
          @value={{this.tier}}
          @options={{WORK_TIERS}}
          @defaultValue='step'
          @description='Density: step (one line in a run), action (approvable work), run (a whole delegated session).'
          @onInput={{this.setTier}}
        />
        <Args.String
          @name='state'
          @value={{this.state}}
          @options={{WORK_STATES}}
          @defaultValue='pending'
          @description='The full state machine; each state maps to a tone (idle/running/attention/done/failed) and default status text.'
          @onInput={{this.setState}}
        />
        <Args.String
          @name='verb'
          @value={{this.verb}}
          @description='The mono VERB tier of the transmutation grammar (EDIT, RUN, SEARCH…).'
          @onInput={{this.setVerb}}
        />
        <Args.String
          @name='title'
          @value={{this.title}}
          @required={{true}}
          @description='What the work is, in label terms.'
          @onInput={{this.setTitle}}
        />
        <Args.Base
          @name='progressValue / progressMax / count / activity'
          @typeLabel='Number/String'
          @description='Run-tier extras: progress bar, count text, and the mono activity line.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='default / footer'
          @description='Body content (result cards, diffs) and the approval footer.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}

export const DEMOS_WORK_ITEM: Record<string, unknown> = {
  WorkItem: WorkItemUsage,
};
