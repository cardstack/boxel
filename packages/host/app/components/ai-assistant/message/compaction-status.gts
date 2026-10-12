import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import type { MessageCompaction } from '@cardstack/host/lib/matrix-classes/message';

import CodeBlockToolCallHeader from '../code-block/tool-call-header';

import type { ApplyButtonState } from '../apply-button';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    compaction: MessageCompaction;
  };
}

const descriptions: Record<MessageCompaction['status'], string> = {
  running: 'Summarizing earlier conversation',
  done: 'Summarized earlier conversation',
  failed: 'Could not summarize earlier conversation',
};

const states: Record<MessageCompaction['status'], ApplyButtonState> = {
  running: 'applying',
  done: 'applied',
  failed: 'failed',
};

// Shows a compaction like a bot-executed tool call: a spinner while ai-bot
// summarizes the earlier conversation, then the result, with the summary
// behind the info button.
export default class CompactionStatus extends Component<Signature> {
  @tracked private isDisplayingSummary = false;

  private get description() {
    return descriptions[this.args.compaction.status];
  }

  private get state() {
    return states[this.args.compaction.status];
  }

  private get summary() {
    return this.args.compaction.summary ?? '';
  }

  private get toggleSummary() {
    return this.summary ? this.toggle : undefined;
  }

  private toggle = () => {
    this.isDisplayingSummary = !this.isDisplayingSummary;
  };

  private noop = () => {};

  <template>
    <div
      class='compaction-status'
      data-test-compaction-status={{@compaction.status}}
      ...attributes
    >
      <CodeBlockToolCallHeader
        @action={{this.noop}}
        @actionVerb=''
        @code={{this.summary}}
        @commandDescription={{this.description}}
        @toolCallState={{this.state}}
        @isCompact={{true}}
        @isDisplayingCode={{this.isDisplayingSummary}}
        @toggleCode={{this.toggleSummary}}
      />
      {{#if this.isDisplayingSummary}}
        <div class='summary' data-test-compaction-summary>
          {{this.summary}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      .compaction-status {
        margin-bottom: var(--boxel-sp-xs);
      }
      .summary {
        margin-top: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-650);
        color: var(--boxel-300);
        font: var(--boxel-font-sm);
        white-space: pre-wrap;
        overflow-wrap: break-word;
      }
    </style>
  </template>
}
