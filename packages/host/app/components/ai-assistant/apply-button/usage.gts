import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ApplyButton, { type ApplyButtonState } from './index';

let noop = () => {};

export default class AiAssistantApplyButtonUsage extends Component {
  @tracked state: ApplyButtonState = 'ready';

  @action cycleState() {
    switch (this.state) {
      case 'ready':
        this.state = 'applying';
        break;
      case 'applying':
        this.state = 'applied';
        break;
      case 'applied':
        this.state = 'applied-with-error';
        break;
      case 'applied-with-error':
        this.state = 'failed';
        break;
      case 'failed':
        this.state = 'preparing';
        break;
      case 'preparing':
        this.state = 'ready';
        break;
    }
  }
  <template>
    {{! template-lint-disable no-inline-styles no-invalid-interactive }}
    <FreestyleUsage @name='AiAssistant::ApplyButton'>
      <:description>
        Displays button for applying change proposed by AI Assistant. Includes
        ready, applying, applied, failed, and preparing states.
      </:description>
      <:example>
        <div
          class='example-container'
          style='--ai-bot-message-background-color: #3b394b;'
          {{on 'click' this.cycleState}}
        >
          <ApplyButton @state={{this.state}} {{on 'click' noop}} />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='state'
          @value={{this.state}}
          @options={{array
            'ready'
            'applying'
            'applied'
            'applied-with-error'
            'failed'
            'preparing'
          }}
          @description='Button state'
          @onInput={{fn (mut this.state)}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .example-container {
        background: var(--boxel-ai-purple);
        overflow: hidden;
        position: relative;
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}
