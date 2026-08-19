import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import ActionBar from './action-bar';

type ActionBarState = 'actions' | 'generating' | 'accepting-all' | 'unread';

let noop = () => {};

export default class AiAssistantActionBarUsage extends Component {
  @tracked state: ActionBarState = 'accepting-all';

  <template>
    {{! template-lint-disable no-inline-styles }}
    <FreestyleUsage @name='AiAssistant::ActionBar'>
      <:description>
        Bar shown above the chat input while code patches are pending:
        Accept-All/Cancel actions, the "Generating results…" stop affordance,
        the "Apply Diff" progress spinner, and the unread-messages jump button.
      </:description>
      <:example>
        <div
          class='example-container'
          style='--chat-input-area-border-radius: 16px;'
        >
          <ActionBar
            @acceptAll={{noop}}
            @cancel={{noop}}
            @acceptingAll={{eqState this.state 'accepting-all'}}
            @generatingResults={{eqState this.state 'generating'}}
            @stop={{noop}}
            @stopping={{false}}
            @showUnreadIndicator={{eqState this.state 'unread'}}
            @unreadMessageText='2 unread messages'
            @scrollToFirstUnread={{noop}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='state'
          @value={{this.state}}
          @options={{array 'actions' 'generating' 'accepting-all' 'unread'}}
          @description='Which of the mutually exclusive bar states to render'
          @onInput={{fn (mut this.state)}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .example-container {
        background: var(--boxel-ai-purple);
        color: var(--boxel-light);
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}

function eqState(a: ActionBarState, b: ActionBarState) {
  return a === b;
}
