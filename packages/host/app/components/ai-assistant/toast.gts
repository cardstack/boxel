import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';

import { format as formatDate, formatISO } from 'date-fns';

import window from 'ember-window-mock';

import { BoxelButton } from '@cardstack/boxel-ui/components';

import { markdownToHtml } from '@cardstack/runtime-common';

import { MessageField } from 'https://cardstack.com/base/room';

import assistantIcon from './ai-assist-icon.webp';

import { currentRoomIdPersistenceKey } from './panel';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    roomId: string;
    message: MessageField;
    onViewInChatClick: () => void;
  };
}

export default class AiAssistantToast extends Component<Signature> {
  <template>
    <div class='ai-assistant-toast' data-test-ai-assistant-toast>
      <header class='toast-header' data-test-ai-assistant-toast-header>
        <img alt='AI Assistant' src={{assistantIcon}} width='20' height='20' />
        <time datetime={{formatISO @message.created}} class='time'>
          {{formatDate @message.created 'dd.MM.yyyy, h:mm aa'}}
        </time>
      </header>
      <div class='toast-content' data-test-ai-assistant-toast-content>
        {{htmlSafe (markdownToHtml @message.formattedMessage)}}
      </div>
      <BoxelButton
        @kind='secondary-dark'
        @size='extra-small'
        class='view-in-chat-button'
        {{on 'click' this.viewInChat}}
        data-test-ai-assistant-toast-button
      >
        View in chat
      </BoxelButton>
    </div>
    <style>
      .ai-assistant-toast {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        background-color: var(--boxel-ai-purple);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
        max-width: 250px;
        overflow: ellipsis;

        position: absolute;
        bottom: calc(
          var(--boxel-sp) + var(--container-button-size) + var(--boxel-sp)
        );
        right: calc(var(--boxel-sp));
      }
      .toast-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .time {
        display: block;
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        color: var(--boxel-450);
        white-space: nowrap;
      }
      .toast-content {
        color: var(--boxel-light);
        font-size: var(--boxel-font-sm);
        font-weight: 500;
        line-height: 1.25rem;
        letter-spacing: var(--boxel-lsp-xs);
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
      }
      .view-in-chat-button {
        --boxel-button-font: 700 var(--boxel-font-xs);
        --boxel-button-min-height: 1.5rem;
        --boxel-button-padding: 0 var(--boxel-sp-xs);
        min-width: initial;
        width: fit-content;
        max-height: 1.5rem;
        margin-left: auto;
      }
      .view-in-chat-button:hover {
        filter: brightness(1.1);
      }
    </style>
  </template>

  @action
  private viewInChat() {
    window.localStorage.setItem(currentRoomIdPersistenceKey, this.args.roomId);
    this.args.onViewInChatClick();
  }
}
