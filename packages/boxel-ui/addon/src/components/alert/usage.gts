import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import Alert from './index.gts';

interface Signature {
  Element: HTMLElement;
}

export default class AlertUsage extends Component<Signature> {
  @tracked messageType: 'error' | 'warning' = 'error';
  @tracked firstMessageText =
    'Failed to process your request. Please try again.';
  @tracked secondMessageText = 'Some fields may be incomplete.';
  @tracked showRetryButton = true;

  get messages() {
    let _messages = [];
    if (this.firstMessageText !== '') {
      _messages.push(this.firstMessageText);
    }
    if (this.secondMessageText !== '') {
      _messages.push(this.secondMessageText);
    }
    return _messages;
  }

  get retryHandler() {
    return this.showRetryButton
      ? () => {
          console.log('Retry action triggered');
        }
      : undefined;
  }

  <template>
    <FreestyleUsage @name='Alert'>
      <:description>
        A component that displays error or warning messages with optional retry
        action.
      </:description>
      <:example>
        <div class='usage-examples'>
          <Alert
            @type={{this.messageType}}
            @messages={{this.messages}}
            @retryAction={{this.retryHandler}}
          />
        </div>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='messageType'
          @description='Type of the first message'
          @value={{this.messageType}}
          @options={{array 'error' 'warning'}}
          @onInput={{fn (mut this.messageType)}}
        />
        <Args.String
          @name='messageText'
          @description='Text of the first message'
          @value={{this.firstMessageText}}
          @onInput={{fn (mut this.firstMessageText)}}
        />
        <Args.String
          @name='secondMessageText'
          @description='Text of the first message'
          @value={{this.secondMessageText}}
          @onInput={{fn (mut this.secondMessageText)}}
        />
        <Args.Action
          @name='retryAction'
          @description='Optional callback function that is triggered when the retry button is clicked'
          @optional={{true}}
        />
        <Args.Bool
          @name='showRetryButton'
          @description='Show the retry button'
          @value={{this.showRetryButton}}
          @onInput={{fn (mut this.showRetryButton)}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .usage-examples {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
      }

      h3 {
        margin: 0;
        font: var(--boxel-font-sm);
        font-weight: 600;
      }
    </style>
  </template>
}
