import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import { ComposerCap } from '@cardstack/pretui/components/composer-cap';
import { TaskChecklist } from '@cardstack/pretui/components/task-checklist';
import { motion } from 'glimmer-motion';

import type { ToolPlanStep as TaskStep } from '@cardstack/pretui/components/tool-plan';

// One decision the assistant waits on: a call held for approval, or the
// calls that wait for this tab's click to run.
export interface Gate {
  // stable key for the list
  key: string;
  // what approving does, in a few words: "Run 3 tool calls", "Publish post"
  label: string;
  // what it acts on, or the assistant's reason
  detail?: string;
  approveLabel: string;
  approve: () => void;
  declineLabel?: string;
  decline?: () => void;
  // bring the call into view in the transcript
  review?: () => void;
  // the bulk gate keeps the old Accept All / Cancel test hooks
  isBulk?: boolean;
  // a decision answered in its row: the cap only points back to it, as one
  // line that brings the row into view
  isPointer?: boolean;
  // what waits, in a word: 'question', 'approval'
  noun?: string;
}

interface Signature {
  Element: HTMLDivElement;
  Args: {
    // decisions waiting on the reader, most urgent first
    gates: Gate[];
    gateBusy?: boolean;
    gateBusyLabel?: string;
    // the assistant's loop is running: a reply arriving or tools running
    working: boolean;
    workingLabel?: string;
    stop: () => void;
    stopping: boolean;
    // calls running in this tab right now
    workingCalls: number;
    // decisions the last turn waits on, asked in rows still in view
    waitingDecisions: number;
    // the plan a running script works through, while its row is out of view
    plan?: { steps: TaskStep[]; activity?: string };
  };
}

// The cap on the composer's top edge says one thing: what the assistant does
// now. Read down, the panel is a timeline (transcript, now, the box), so the
// most urgent status wins the row: a decision waiting, then work. "New
// messages" is about the transcript and floats above the cap instead.
// Each status row declares itself `cap-status` (motion/composer-motion.gts):
// a change from one kind of status to another renders a new row, which
// pairs with the old one, and the composer region crossfades them.
export default class AiAssistantComposerCap extends Component<Signature> {
  private get first() {
    return this.args.gates[0];
  }

  private get pointerCount() {
    return this.args.gates.filter((gate) => gate.isPointer).length;
  }

  private get pointerTitle() {
    let count = this.pointerCount;
    if (count > 1) {
      return `${count} decisions waiting`;
    }
    return this.first?.label ?? '';
  }

  private get gateDetail() {
    let count = this.args.gates.length;
    return count > 1 ? `1 of ${count}` : undefined;
  }

  private get callsDetail() {
    let n = this.args.workingCalls;
    if (this.args.stopping) {
      return n > 0 ? 'ending the running call' : undefined;
    }
    return n > 0 ? `${n} call${n === 1 ? '' : 's'}` : undefined;
  }

  private get waitingDetail() {
    let n = this.args.workingCalls;
    return n > 0
      ? `${n} call${n === 1 ? '' : 's'} working`
      : 'nothing else running';
  }

  <template>
    <ComposerCap
      class='composer-cap'
      data-test-composer-cap
      ...attributes
      as |cap|
    >
      {{#if this.first.isPointer}}
        {{! a decision asked in its row, scrolled out of view: the cap points
            back to it }}
        <cap.Status
          {{motion id='cap-status' role='cap-status'}}
          @tone='waiting'
          @title={{this.pointerTitle}}
          data-gate-stack
          data-test-gate-stack
          data-test-gate-pointer
        >
          <cap.Button
            @kind='primary'
            @glyph='jump'
            {{on 'click' this.first.approve}}
            data-test-gate-approve
          >{{if
              (gt this.pointerCount 1)
              'Jump'
              this.first.approveLabel
            }}</cap.Button>
        </cap.Status>
      {{else if this.first}}
        {{! the calls that run on this tab's click, as one decision: Accept
            all is the moment's one primary }}
        <cap.Status
          {{motion id='cap-status' role='cap-status'}}
          @tone='waiting'
          @title={{this.first.label}}
          @detail={{this.gateDetail}}
          data-gate-stack
          data-test-gate-stack
        >
          {{#if this.first.review}}
            <cap.Button
              {{on 'click' this.first.review}}
              data-cap-optional
              data-test-gate-review
            >Review</cap.Button>
          {{/if}}
          <cap.Button
            @kind='primary'
            @busy={{@gateBusy}}
            disabled={{@gateBusy}}
            {{on 'click' this.first.approve}}
            data-test-accept-all={{if this.first.isBulk true}}
            data-test-gate-approve
          >{{if @gateBusy @gateBusyLabel this.first.approveLabel}}</cap.Button>
          {{#if this.first.decline}}
            <cap.Button
              @kind='icon'
              @glyph='remove'
              disabled={{@gateBusy}}
              aria-label={{this.first.declineLabel}}
              title={{this.first.declineLabel}}
              {{on 'click' this.first.decline}}
              data-test-cancel={{if this.first.isBulk true}}
              data-test-gate-decline
            />
          {{/if}}
        </cap.Status>
      {{else if @working}}
        <cap.Status
          {{motion id='cap-status' role='cap-status'}}
          @title={{if @workingLabel @workingLabel 'Generating results'}}
          @dots={{true}}
          @detail={{this.callsDetail}}
          data-test-ai-assistant-action-bar
        >
          <cap.Button
            @kind='primary'
            @glyph='stop'
            @busy={{@stopping}}
            disabled={{@stopping}}
            {{on 'click' @stop}}
            data-test-stop-generating
          >Stop</cap.Button>
        </cap.Status>
      {{else if @plan}}
        <cap.Status
          {{motion id='cap-status' role='cap-status'}}
          @title='Running a script'
          @detail={{@plan.activity}}
          data-test-transcript-status
        />
      {{else if @waitingDecisions}}
        {{! the decision is asked in its row, on screen: the cap only says
            whose turn it is }}
        <cap.Status
          {{motion id='cap-status' role='cap-status'}}
          @tone='idle'
          @title='Waiting for you'
          @detail={{this.waitingDetail}}
          data-test-transcript-status
        />
      {{else if @workingCalls}}
        <cap.Status
          {{motion id='cap-status' role='cap-status'}}
          @title='Running tools'
          @detail={{this.callsDetail}}
          data-test-transcript-status
        />
      {{/if}}
      {{#if @plan}}
        {{! the plan belongs to the status, so it opens under it }}
        <cap.Section>
          <TaskChecklist
            class='turn-plan'
            @steps={{@plan.steps}}
            @activity={{@plan.activity}}
            data-test-turn-plan
          />
        </cap.Section>
      {{/if}}
    </ComposerCap>
    <style scoped>
      /* the cap reads at the UI size whatever the composer's own size is,
         and runs 12px down behind the box, whose rounded top covers its
         lower corners, as the showcase's composer draws it */
      .composer-cap {
        position: relative;
        z-index: 1;
        padding-bottom: var(--step-12, 12px);
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        --pretui-cap-surface: var(--ai-composer-cap-surface);
        --pretui-cap-edge: var(--ai-composer-cap-edge);
        /* the cap spans the composer's full width, its top edge continued */
        --pretui-cap-inset: var(--ai-composer-cap-inset, 0px);
      }
    </style>
  </template>
}

function gt(a: number, b: number) {
  return a > b;
}
