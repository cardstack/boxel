import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { Avatar } from '@cardstack/boxel-ui/components';

import AiAssistantMessage, { AiAssistantConversation } from './index';
export default class AiAssistantMessageUsage extends Component {
  @tracked formattedMessage = 'Hello, world';
  @tracked datetime = new Date(2024, 0, 3, 12, 30);
  @tracked isFromAssistant = false;
  @tracked isStreaming = false;
  @tracked userId = 'johndoe:boxel.ai';
  @tracked errorMessage = '';

  @action setDateTimeFromString(val: string) {
    let sinceEpoch = Date.parse(val);
    if (!isNaN(sinceEpoch)) {
      this.datetime = new Date(sinceEpoch);
    }
  }

  @action retryAction() {
    console.log('retry button pressed');
  }

  get datetimeAsString() {
    return this.datetime.toISOString();
  }

  oneMinutesAgo = new Date(Date.now() - 60 * 1000);
  twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

  noop = () => {};

  <template>
    <FreestyleUsage @name='AiAssistant::Message'>
      <:description>
        Displays message for AiAssistant.
      </:description>
      <:example>
        <div class='example-container'>
          <AiAssistantConversation
            @setScrollPosition={{this.noop}}
            @registerConversationScroller={{this.noop}}
          >
            <AiAssistantMessage
              @formattedMessage={{htmlSafe this.formattedMessage}}
              @datetime={{this.datetime}}
              @isFromAssistant={{this.isFromAssistant}}
              @index={{0}}
              @registerScroller={{this.noop}}
              @profileAvatar={{component
                Avatar
                userId=this.userId
                isReady=true
              }}
              @errorMessage={{this.errorMessage}}
              @retryAction={{this.retryAction}}
              @isStreaming={{this.isStreaming}}
            >
              <em>Optional embedded content</em>
            </AiAssistantMessage>
          </AiAssistantConversation>
        </div>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name='isFromAssistant'
          @description='true when the message is from the AI Assistant'
          @onInput={{fn (mut this.isFromAssistant)}}
          @value={{this.isFromAssistant}}
        />
        <Args.String
          @name='profileAvatar'
          @description='The component reference used to display the user avatar when isFromAssistant is false. In this component explorer, you can vary the userId passed to Avatar.'
          @onInput={{fn (mut this.userId)}}
          @value={{this.userId}}
        />
        <Args.String
          @name='datetime'
          @description='The datetime to display'
          @onInput={{this.setDateTimeFromString}}
          @value={{this.datetimeAsString}}
        />
        <Args.String
          @name='formattedMessage'
          @description='The message to display, as an html-safe string'
          @onInput={{fn (mut this.formattedMessage)}}
          @value={{this.formattedMessage}}
        />
        <Args.Array
          @name='attachedCards'
          @description='Cards attached to the message in pill form.'
        />
        <Args.String
          @name='errorMessage'
          @description='Error state message to display'
          @onInput={{fn (mut this.errorMessage)}}
          @value={{this.errorMessage}}
        />
        <Args.Action
          @name='retryAction'
          @description='Action to be called in error state'
          @value={{this.retryAction}}
        />
        <Args.Yield @description='Message content' />
      </:api>
    </FreestyleUsage>
    <FreestyleUsage @name='AiAssistant::Message example conversation'>
      <:description>
        An example convo with AiAssistant.
      </:description>
      <:example>
        <div class='example-container'>
          <AiAssistantConversation
            @setScrollPosition={{this.noop}}
            @registerConversationScroller={{this.noop}}
          >
            <AiAssistantMessage
              @formattedMessage={{htmlSafe
                'Please copy edit this message to make it more human.'
              }}
              @datetime={{this.twoMinutesAgo}}
              @isFromAssistant={{false}}
              @index={{0}}
              @registerScroller={{this.noop}}
              @profileAvatar={{component
                Avatar
                userId=this.userId
                isReady=true
              }}
              @isStreaming={{false}}
            />
            <AiAssistantMessage
              @formattedMessage={{htmlSafe
                'Culpa fugiat ex ipsum commodo anim. Cillum reprehenderit eu consectetur laboris dolore in cupidatat. Deserunt ipsum voluptate sit velit aute ad velit exercitation sint. Velit esse velit est et amet labore velit nisi magna ea elit nostrud quis anim..'
              }}
              @index={{1}}
              @registerScroller={{this.noop}}
              @datetime={{this.oneMinutesAgo}}
              @isFromAssistant={{true}}
              @isStreaming={{false}}
            />
          </AiAssistantConversation>
        </div>
      </:example>
    </FreestyleUsage>
    <style scoped>
      .example-container {
        background: var(--boxel-ai-purple);
        width: 371px;
        overflow: hidden;
        position: relative;
        --profile-avatar-icon-background: blue;
      }
    </style>
  </template>
}
