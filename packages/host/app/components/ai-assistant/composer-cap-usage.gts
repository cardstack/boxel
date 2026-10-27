import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ComposerCap, { type Gate } from './composer-cap';

type CapState =
  | 'generating'
  | 'running-tools'
  | 'stopping'
  | 'decision'
  | 'accepting-all'
  | 'question'
  | 'waiting';

let noop = () => {};

const BULK: Gate = {
  key: 'ready',
  label: 'Run 3 tool calls',
  approveLabel: 'Accept all',
  approve: noop,
  declineLabel: 'Cancel',
  decline: noop,
  review: noop,
  isBulk: true,
};
const QUESTION: Gate = {
  key: 'ask',
  label: 'A question is waiting',
  approveLabel: 'Show it',
  approve: noop,
  isPointer: true,
  noun: 'question',
};

export default class AiAssistantComposerCapUsage extends Component {
  @tracked state: CapState = 'generating';

  private get gates(): Gate[] {
    switch (this.state) {
      case 'decision':
      case 'accepting-all':
        return [BULK];
      case 'question':
        return [QUESTION];
      default:
        return [];
    }
  }

  private is = (state: CapState) => this.state === state;

  <template>
    {{! template-lint-disable no-inline-styles }}
    <FreestyleUsage @name='AiAssistant::ComposerCap'>
      <:description>
        The dark cap on the composer's top edge: one status row for what the
        assistant does now (a decision, work, or the reader's turn), with the
        moment's one primary action in solid teal.
      </:description>
      <:example>
        <div class='example-container'>
          <ComposerCap
            @gates={{this.gates}}
            @gateBusy={{this.is 'accepting-all'}}
            @gateBusyLabel='Apply Diff'
            @working={{this.isWorking}}
            @workingLabel={{if
              (this.is 'generating')
              'Generating results'
              'Running tools'
            }}
            @stop={{noop}}
            @stopping={{this.is 'stopping'}}
            @workingCalls={{if (this.is 'running-tools') 3 0}}
            @waitingDecisions={{if (this.is 'waiting') 1 0}}
          />
          <div class='example-box'>Enter a prompt</div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='state'
          @value={{this.state}}
          @options={{array
            'generating'
            'running-tools'
            'stopping'
            'decision'
            'accepting-all'
            'question'
            'waiting'
          }}
          @description='Which status the cap says'
          @onInput={{fn (mut this.state)}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .example-container {
        background-color: var(--boxel-ai-purple);
        color: var(--boxel-light);
        padding: var(--boxel-sp);
        --foreground: #f7f8fa;
        --muted-foreground: #a8a2ba;
        --primary: var(--boxel-highlight);
        --primary-foreground: var(--boxel-dark);
        --ai-composer-cap-surface: color-mix(
          in oklch,
          var(--boxel-light) 9%,
          var(--boxel-ai-purple)
        );
        --ai-composer-cap-edge: color-mix(
          in oklch,
          var(--boxel-light) 16%,
          var(--boxel-ai-purple)
        );
        --ai-composer-attention: #f0b44c;
      }
      .example-box {
        padding: var(--boxel-sp-sm);
        border-radius: 14px;
        background-color: color-mix(
          in oklch,
          var(--boxel-ai-purple) 5%,
          var(--boxel-light)
        );
        color: var(--boxel-450);
      }
    </style>
  </template>

  private get isWorking() {
    return (
      this.state === 'generating' ||
      this.state === 'running-tools' ||
      this.state === 'stopping'
    );
  }
}
