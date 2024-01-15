import { on } from '@ember/modifier';
import type { SafeString } from '@ember/template';
import Component from '@glimmer/component';

import { format as formatDate, formatISO } from 'date-fns';

import { Button } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';
import { FailureBordered } from '@cardstack/boxel-ui/icons';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    formattedMessage: SafeString;
    datetime: Date;
    isFromAssistant: boolean;
    profileAvatar?: ComponentLike;
    errorMessage?: string;
    retryAction?: () => void;
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
      <div class='content-container'>
        {{#if @errorMessage}}
          <div class='error-container'>
            <FailureBordered class='error-icon' />
            <div class='error-message'>{{@errorMessage}}</div>
            {{#if @retryAction}}
              <Button
                {{on 'click' @retryAction}}
                class='retry-button'
                @size='small'
                @kind='secondary-dark'
              >
                Retry
              </Button>
            {{/if}}
          </div>
        {{/if}}
        <div class='content'>
          {{@formattedMessage}}

          <div>{{yield}}</div>
        </div>
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

      /* spacing for sequential thread messages */
      .ai-assistant-message + .ai-assistant-message {
        margin-top: var(--boxel-sp-lg);
      }

      .ai-assistant-message + .hide-meta {
        margin-top: var(--boxel-sp);
      }

      .content-container {
        margin-top: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs)
          var(--boxel-border-radius-xl) var(--boxel-border-radius-xl)
          var(--boxel-border-radius-xl);
        overflow: hidden;
      }

      .content {
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
        padding: var(--boxel-sp);
      }
      .is-from-assistant .content {
        background: #433358;
        color: var(--boxel-light);
      }

      .error-container {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: var(--boxel-danger);
        color: var(--boxel-light);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp);
      }
      .error-icon {
        --icon-background-color: var(--boxel-light);
        --icon-color: var(--boxel-danger);
        margin-top: var(--boxel-sp-5xs);
      }
      .error-message {
        align-self: center;
      }
      .retry-button {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: max-content;
        --boxel-button-min-width: max-content;
        border-color: var(--boxel-light);
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
        overflow-y: auto;
      }
    </style>
  </template>
}
