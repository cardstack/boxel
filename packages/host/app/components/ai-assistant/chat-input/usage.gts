import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import AiAssistantChatInput from './index';

export default class AiAssistantChatInputUsage extends Component {
  @tracked value = '';

  @action onSend(message: string) {
    console.log(`message sent: ${message}`);
  }

  <template>
    <FreestyleUsage @name='AiAssistant::ChatInput'>
      <:description>
        Chat input field for AI Assistant is a BoxelInput component of type
        'textarea' with a send button. This component accepts all arguments that
        are accepted by BoxelInput component in addition to an \`onSend\`
        argument for action to take when input is submitted.
      </:description>
      <:example>
        <AiAssistantChatInput
          @value={{this.value}}
          @onInput={{fn (mut this.value)}}
          @onSend={{this.onSend}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='value'
          @description='Chat input field'
          @onInput={{fn (mut this.value)}}
          @value={{this.value}}
        />
        <Args.Action
          @name='onInput'
          @description='Action to be called when input is entered'
        />
        <Args.Action
          @name='onSend'
          @description='Action to be called when "enter" key is pressed or send button is clicked'
          @value={{this.onSend}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
