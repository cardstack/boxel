import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';

import { format as formatDate, formatISO } from 'date-fns';

import { cn } from '@cardstack/boxel-ui/helpers';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    formattedMessage: SafeString;
    datetime: Date;
    isFromAssistant: boolean;
    profileAvatar?: ComponentLike;
  };
  Blocks: { default: [] };
}

// TODO: Update Boxel::Message component
export default class AiAssistantMessage extends Component<Signature> {
  <template>
    <div
      class={{cn 'ai-assistant-message' is-from-assistant=@isFromAssistant}}
      data-test-ai-assistant-message
      ...attributes
    >
      <div class='meta'>
        {{#if @isFromAssistant}}
          {{! template-lint-disable no-inline-styles }}
          <div
            class='ai-avatar'
            style="background-image: image-set(url('/images/ai-assist-icon.webp') 1x, url('/images/ai-assist-icon@2x.webp') 2x, url('/images/ai-assist-icon@3x.webp') 3x)"
          ></div>
        {{else if @profileAvatar}}
          <@profileAvatar />
        {{/if}}
        <time datetime={{formatISO @datetime}} class='time'>
          {{formatDate @datetime 'iiii MMM d, yyyy, h:mm aa'}}
        </time>
      </div>
      <div class='content'>
        {{@formattedMessage}}

        <div>{{yield}}</div>
      </div>
    </div>
    <style>
      .ai-assistant-message {
        --ai-assistant-message-avatar-size: 1.25rem; /* 20px. */
        --ai-assistant-message-meta-height: 1.25rem; /* 20px */
        --ai-assistant-message-gap: var(--boxel-sp-xs);
        --profile-avatar-icon-size: var(--ai-assistant-message-avatar-size);
        --profile-avatar-icon-border: 1px solid var(--boxel-400);
      }
      .meta {
        display: grid;
        grid-template-columns: var(--ai-assistant-message-avatar-size) 1fr;
        grid-template-rows: var(--ai-assistant-message-meta-height);
        align-items: start;
        gap: var(--ai-assistant-message-gap);
      }
      .ai-avatar {
        width: var(--ai-assistant-message-avatar-size);
        height: var(--ai-assistant-message-avatar-size);
        background-repeat: no-repeat;
        background-size: var(--ai-assistant-message-avatar-size);
      }
      .avatar-img {
        width: var(--ai-assistant-message-avatar-size);
        height: var(--ai-assistant-message-avatar-size);
        border-radius: 100px;
      }

      .time {
        display: block;
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
        color: var(--boxel-450);
        white-space: nowrap;
      }

      .content {
        margin-top: var(--boxel-sp-xs);
        font: var(--boxel-font-sm);
      }

      /* spacing for sequential thread messages */
      .ai-assistant-message + .ai-assistant-message {
        margin-top: var(--boxel-sp-lg);
      }

      .ai-assistant-message + .hide-meta {
        margin-top: var(--boxel-sp);
      }
      .content {
        background: var(--boxel-light);
        color: var(--boxel-dark);
        letter-spacing: var(--boxel-lsp);
        padding: var(--boxel-sp);
        border-radius: var(--boxel-border-radius-xs)
          var(--boxel-border-radius-xl) var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl);
      }
      .is-from-assistant .content {
        background: #433358;
        color: var(--boxel-light);
      }
    </style>
  </template>
}

interface AiAssistantConversationSignature {
  Element: HTMLDivElement;
  Args: {};
  Blocks: {
    default: [];
  };
}

export class AiAssistantConversation extends Component<AiAssistantConversationSignature> {
  <template>
    <div class='ai-assistant-conversation'>
      {{yield}}
    </div>
    <style>
      .ai-assistant-conversation {
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}
