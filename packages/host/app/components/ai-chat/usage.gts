import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import AiChat from './index';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { action } from '@ember/object';

const validModes = Object.values(AiChat);

export default class SearchSheetUsage extends Component {
  defaultMode: AiMode = AiMode.Closed;
  @tracked mode: AiMode = AiMode.Closed;

  @action onOpen() {
    if (this.mode == AiMode.Closed) {
      this.mode = AiMode.SearchPrompt;
    }
  }

  @action onClose() {
    this.mode = AiMode.Closed;
  }

  //@action onSearch() {}

  <template>
    <FreestyleUsage @name='AiChat'>
      <:description>
        A chat interface to an AI system
      </:description>
      <:example>
        <div class='example-container'>
          <AiChat
            @onOpen={{this.onOpen}}
            @onClose={{this.onClose}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='mode'
          @description='The mode of the sheet'
          @onInput={{fn (mut this.mode)}}
          @options={{validModes}}
          @value={{this.mode}}
          @defaultValue={{this.defaultMode}}
        />
        <Args.Action
          @name='onOpen'
          @description='Action to call when the user opens the chat'
        />
        <Args.Action
          @name='onClose'
          @description='Action to call when the user closes the chat'
        />
        <Args.Action
          @name='aiApi'
          @description='The API available to the AI system'
        />
      </:api>
    </FreestyleUsage>
    <style>
      .example-container {
        background: #494559;
        min-height: 300px;
        overflow: hidden;
        position: relative;
      }
    </style>
  </template>
}
