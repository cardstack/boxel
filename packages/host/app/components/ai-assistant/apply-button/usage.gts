import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ApplyButton, { type ApplyButtonState } from './index';

export default class AiAssistantApplyButtonUsage extends Component {
  @tracked state: ApplyButtonState = 'ready';

  @action handleApplyButtonClick() {
    switch (this.state) {
      case 'ready':
        this.state = 'applying';
        break;
      case 'applying':
        this.state = 'applied';
        break;
      case 'applied':
        this.state = 'failed';
        break;
      case 'failed':
        this.state = 'ready';
        break;
    }
  }
  <template>
    <FreestyleUsage @name='AiAssistant::ApplyButton'>
      <:description>
        Displays button for applying change proposed by AI Assistant. Includes
        ready, applying, applied and failed states.
      </:description>
      <:example>
        <div class='example-container'>
          <ApplyButton
            @state={{this.state}}
            {{on 'click' this.handleApplyButtonClick}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='state'
          @value={{this.state}}
          @options={{array 'ready' 'applying' 'applied' 'failed'}}
          @description='Button state'
          @onInput={{fn (mut this.state)}}
        />
      </:api>
    </FreestyleUsage>

    <style>
      .example-container {
        background: var(--boxel-ai-purple);
        overflow: hidden;
        position: relative;
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}
