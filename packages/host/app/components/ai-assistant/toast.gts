import { isDestroyed, registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';

import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { format as formatDate, formatISO, isAfter, subMinutes } from 'date-fns';

import { BoxelButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';

import type { Message } from '@cardstack/host/lib/matrix-classes/message';
import type LocalPersistenceService from '@cardstack/host/services/local-persistence-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import assistantIcon from './ai-assist-icon.webp';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    hide: boolean;
    onViewInChatClick: () => void;
  };
}

const AUTO_HIDE_MS = 3000;

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

  @service declare private matrixService: MatrixService;
  @service declare private localPersistenceService: LocalPersistenceService;

  @tracked private isForcedHidden = false;
  @tracked private isResetStateValueBlocked = false;
  private lastEventIdSeen: string | null = null;
  private hideTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    registerDestructor(this, () => {
      if (this.hideTimerId !== null) {
        clearTimeout(this.hideTimerId);
        this.hideTimerId = null;
      }
    });
  }

  @cached
  private get latestUnseenMessage(): {
    roomId: string;
    message: Message;
  } | null {
    let candidate: { roomId: string; message: Message } | null = null;
    for (let resource of this.matrixService.roomResources.values()) {
      if (!resource.matrixRoom || !resource.roomId) {
        continue;
      }
      let finishedMessages = resource.messages.filter(
        (m) => m.isStreamingFinished,
      );
      let lastMessage = finishedMessages[finishedMessages.length - 1];
      if (!lastMessage) {
        continue;
      }
      if (
        this.matrixService.currentUserEventReadReceipts.has(lastMessage.eventId)
      ) {
        continue;
      }
      candidate = { roomId: resource.roomId, message: lastMessage };
      break;
    }

    let fifteenMinutesAgo = subMinutes(new Date(), 15);
    if (candidate && isAfter(candidate.message.created, fifteenMinutesAgo)) {
      this.onMessageSeen(candidate.message.eventId ?? null);
      return candidate;
    }
    return null;
  }

  private onMessageSeen(eventId: string | null) {
    if (eventId === this.lastEventIdSeen) {
      return;
    }
    this.lastEventIdSeen = eventId;
    this.isForcedHidden = false;
    this.scheduleAutoHide();
  }

  private scheduleAutoHide = () => {
    if (this.hideTimerId !== null) {
      clearTimeout(this.hideTimerId);
      this.hideTimerId = null;
    }
    this.hideTimerId = setTimeout(this.onAutoHideTick, AUTO_HIDE_MS);
  };

  private onAutoHideTick = () => {
    this.hideTimerId = null;
    if (isDestroyed(this)) {
      return;
    }
    if (this.isResetStateValueBlocked) {
      return;
    }
    this.isForcedHidden = true;
  };

  private get roomId() {
    return this.latestUnseenMessage?.roomId ?? '';
  }

  private get unseenMessage() {
    return (
      this.latestUnseenMessage?.message ??
      ({
        body: '',
        created: new Date(),
      } as Message)
    );
  }

  private get isVisible() {
    return (
      !!this.latestUnseenMessage && !this.isForcedHidden && !this.args.hide
    );
  }

  @action
  private blockResetStateValue() {
    this.isResetStateValueBlocked = true;
  }

  @action
  private unBlockResetStateValue() {
    if (!this.isResetStateValueBlocked) {
      return;
    }
    this.isResetStateValueBlocked = false;
    if (this.latestUnseenMessage && !this.isForcedHidden) {
      this.scheduleAutoHide();
    }
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
