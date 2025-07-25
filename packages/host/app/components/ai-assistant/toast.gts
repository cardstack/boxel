import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';

import { format as formatDate, formatISO, isAfter, subMinutes } from 'date-fns';
import { cancelPoll, pollTask, runTask } from 'ember-lifeline';

import { TrackedObject } from 'tracked-built-ins';

import { BoxelButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import { markdownToHtml } from '@cardstack/runtime-common';

import { Message } from '@cardstack/host/lib/matrix-classes/message';
import LocalPersistenceService from '@cardstack/host/services/local-persistence-service';
import MatrixService from '@cardstack/host/services/matrix-service';

import assistantIcon from './ai-assist-icon.webp';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    hide: boolean;
    onViewInChatClick: () => void;
  };
}

export default class AiAssistantToast extends Component<Signature> {
  <template>
    <div
      class='ai-assistant-toast {{if this.isVisible "visible"}}'
      data-test-ai-assistant-toast={{this.isVisible}}
      {{on 'mouseenter' this.blockResetStateValue}}
      {{on 'mouseleave' this.unBlockResetStateValue}}
    >
      <header class='toast-header' data-test-ai-assistant-toast-header>
        <img alt='AI Assistant' src={{assistantIcon}} width='20' height='20' />
        <time datetime={{formatISO this.unseenMessage.created}} class='time'>
          {{formatDate this.unseenMessage.created 'dd.MM.yyyy, h:mm aa'}}
        </time>

        <IconButton
          @icon={{IconX}}
          @width='10'
          @height='10'
          {{on 'click' this.closeToast}}
          class='toast-close-button'
          aria-label='close toast'
          tabindex={{unless this.isVisible '-1'}}
          data-test-close-toast
        />
      </header>
      <div class='toast-content' data-test-ai-assistant-toast-content>
        {{htmlSafe (markdownToHtml this.unseenMessage.body)}}
      </div>
      <BoxelButton
        @kind='secondary-dark'
        @size='extra-small'
        class='view-in-chat-button'
        {{on 'click' this.viewInChat}}
        tabindex={{unless this.isVisible '-1'}}
        data-test-ai-assistant-toast-button
      >
        View in chat
      </BoxelButton>
    </div>
    <style scoped>
      .ai-assistant-toast {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        background-color: var(--boxel-ai-purple);
        border-radius: var(--boxel-border-radius);
        padding: 0;

        overflow: hidden;

        position: absolute;
        bottom: calc(
          var(--boxel-sp) + var(--container-button-size) + var(--boxel-sp)
        );
        right: var(--boxel-sp);

        opacity: 0;
        height: 0;
        max-width: 250px;
        transition:
          transform 0.5s ease-in-out,
          opacity 0.5s ease-in-out;
        transform: translateY(100%);
      }
      .visible {
        padding: var(--boxel-sp);
        opacity: 1;
        height: fit-content;
        transform: translateY(0);
      }
      .toast-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        position: relative;
      }
      .time {
        display: block;
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        color: var(--boxel-450);
        white-space: nowrap;
        flex: 1;
      }
      .toast-close-button {
        --icon-color: var(--boxel-450);
        border: none;
        background: none;
        padding: 1px;
        border-radius: var(--boxel-border-radius-xs);
        transition: background-color 0.2s ease;
        width: 16px;
        height: 16px;
        min-width: 16px;
        min-height: 16px;
      }
      .toast-close-button:hover {
        --icon-color: var(--boxel-light);
        background-color: rgba(255, 255, 255, 0.1);
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
        --boxel-button-font: 600 var(--boxel-font-xs);
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

  @service private declare matrixService: MatrixService;
  @service private declare localPersistenceService: LocalPersistenceService;
  _pollToken: ReturnType<typeof pollTask> | null = null;

  private get state() {
    const state: {
      value: {
        roomId: string;
        message: Message;
      } | null;
      isResetStateValueBlocked: boolean;
    } = new TrackedObject({
      value: null,
      isResetStateValueBlocked: false,
    });
    if (this._pollToken) {
      cancelPoll(this, this._pollToken);
    }
    const resetStateValue = (timeout = 3000) => {
      runTask(
        this,
        () => {
          if (state.isResetStateValueBlocked) {
            resetStateValue(1000);
            return;
          }
          state.value = null;
        },
        timeout,
      );
    };

    let lastMessages: Map<string, Message> = new Map();
    for (let resource of this.matrixService.roomResources.values()) {
      if (!resource.matrixRoom) {
        continue;
      }
      let finishedMessages = resource.messages.filter(
        (m) => m.isStreamingFinished,
      );
      if (resource.roomId) {
        lastMessages.set(
          resource.roomId,
          finishedMessages[finishedMessages.length - 1],
        );
      }
    }

    let lastMessage =
      Array.from(lastMessages).filter(
        (lastMessage) =>
          lastMessage[1] &&
          !this.matrixService.currentUserEventReadReceipts.has(
            lastMessage[1].eventId,
          ),
      )[0] ?? null;
    let fifteenMinutesAgo = subMinutes(new Date(), 15);
    if (lastMessage && isAfter(lastMessage[1].created, fifteenMinutesAgo)) {
      state.value = {
        roomId: lastMessage[0],
        message: lastMessage[1],
      };
      // eslint-disable-next-line ember/no-side-effects
      this._pollToken = pollTask(this, resetStateValue);
    }

    return state;
  }

  private get roomId() {
    return this.state.value?.roomId ?? '';
  }

  private get unseenMessage() {
    return (
      this.state.value?.message ??
      ({
        body: '',
        created: new Date(),
      } as Message)
    );
  }

  private get isVisible() {
    return this.state.value && !this.args.hide;
  }

  @action
  private blockResetStateValue() {
    this.state.isResetStateValueBlocked = true;
  }

  @action
  private unBlockResetStateValue() {
    this.state.isResetStateValueBlocked = false;
  }

  @action
  private viewInChat() {
    this.localPersistenceService.setCurrentRoomId(this.roomId);
    this.args.onViewInChatClick();
  }

  private closeToast = () => {
    let message = this.unseenMessage;

    let matrixEvent = {
      getId: () => message.eventId,
      getRoomId: () => this.roomId,
      getTs: () => message.created.getTime(),
    };
    this.matrixService.sendReadReceipt(matrixEvent);
  };
}
