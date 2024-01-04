import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { ProfileAvatarIconVisual } from '../../operator-mode/profile-avatar-icon';

import AiAssistantMessage, { AiAssistantConversation } from './index';
export default class AiAssistantMessageUsage extends Component {
  @tracked formattedMessage = 'Hello, world';
  @tracked datetime = new Date(2024, 0, 3, 12, 30);
  @tracked isFromAssistant = false;
  @tracked userId = 'johndoe:boxel.ai';

  @action setDateTimeFromString(val: string) {
    let sinceEpoch = Date.parse(val);
    if (!isNaN(sinceEpoch)) {
      this.datetime = new Date(sinceEpoch);
    }
  }

  get datetimeAsString() {
    return this.datetime.toISOString();
  }

  oneMinutesAgo = new Date(Date.now() - 60 * 1000);
  twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

  get profileInitials() {
    return this.userId[0].toUpperCase();
  }

  <template>
    <FreestyleUsage @name='AiAssistant::Message'>
      <:description>
        Displays message for AiAssistant.
      </:description>
      <:example>
        <div class='example-container'>
          <AiAssistantConversation>
            <AiAssistantMessage
              @formattedMessage={{htmlSafe this.formattedMessage}}
              @datetime={{this.datetime}}
              @isFromAssistant={{this.isFromAssistant}}
              @profileAvatar={{component
                ProfileAvatarIconVisual
                userId=this.userId
                isReady=true
                profileInitials=this.profileInitials
                size=20
              }}
            />
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
          @description='The component reference used to display the user avatar when isFromAssistant is false. In this component explorer, you can vary the userId passed to ProfileAvatarIcon.'
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

      </:api>
    </FreestyleUsage>
    <FreestyleUsage @name='AiAssistant::Message example conversation'>
      <:description>
        An example convo with AiAssistant.
      </:description>
      <:example>
        <div class='example-container'>
          <AiAssistantConversation>
            <AiAssistantMessage
              @formattedMessage={{htmlSafe
                'Please copy edit this message to make it more human.'
              }}
              @datetime={{this.twoMinutesAgo}}
              @isFromAssistant={{false}}
              @profileAvatar={{component
                ProfileAvatarIconVisual
                userId=this.userId
                isReady=true
                profileInitials=this.profileInitials
              }}
            />
            <AiAssistantMessage
              @formattedMessage={{htmlSafe
                'Culpa fugiat ex ipsum commodo anim. Cillum reprehenderit eu consectetur laboris dolore in cupidatat. Deserunt ipsum voluptate sit velit aute ad velit exercitation sint. Velit esse velit est et amet labore velit nisi magna ea elit nostrud quis anim..'
              }}
              @datetime={{this.oneMinutesAgo}}
              @isFromAssistant={{true}}
            />
          </AiAssistantConversation>
        </div>
      </:example>
    </FreestyleUsage>
    <style>
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
