import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { schedule } from '@ember/runloop';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import { enqueueTask, restartableTask, timeout, all } from 'ember-concurrency';

import { v4 as uuidv4 } from 'uuid';

import { not } from '@cardstack/boxel-ui/helpers';

import { unixTime } from '@cardstack/runtime-common';

import { Message } from '@cardstack/host/lib/matrix-classes/message';
import type { StackItem } from '@cardstack/host/lib/stack-item';
import { getAutoAttachment } from '@cardstack/host/resources/auto-attached-card';
import { getRoom } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import max from 'lodash/max';
import { MatrixEvent } from 'matrix-js-sdk';

import { TrackedMap, TrackedWeakMap } from 'tracked-built-ins';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import AiAssistantCardPicker from '../ai-assistant/card-picker';
import AiAssistantChatInput from '../ai-assistant/chat-input';
import { AiAssistantConversation } from '../ai-assistant/message';
import NewSession from '../ai-assistant/new-session';
import AiAssistantSkillMenu from '../ai-assistant/skill-menu';

import RoomMessage from './room-message';

import type { Skill } from '../ai-assistant/skill-menu';

interface Signature {
  Args: {
    roomId: string;
    monacoSDK: MonacoSDK;
  };
}

export default class Room extends Component<Signature> {
  <template>
    {{#if (not this.doMatrixEventFlush.isRunning)}}
      <section
        class='room'
        data-room-settled={{this.doWhenRoomChanges.isIdle}}
        data-test-room-settled={{this.doWhenRoomChanges.isIdle}}
        data-test-room-name={{this.roomResource.name}}
        data-test-room={{@roomId}}
      >
        <AiAssistantConversation @setScrollPosition={{this.setScrollPosition}}>
          {{#if this.messages}}
            {{#each this.messages as |message i|}}
              <RoomMessage
                @roomId={{@roomId}}
                @messages={{this.messages}}
                @message={{message}}
                @index={{i}}
                @registerScroller={{this.registerScroller}}
                @isPending={{this.isPendingMessage message}}
                @monacoSDK={{@monacoSDK}}
                @isStreaming={{this.isMessageStreaming message i}}
                @currentEditor={{this.currentMonacoContainer}}
                @setCurrentEditor={{this.setCurrentMonacoContainer}}
                @retryAction={{this.maybeRetryAction i message}}
                data-test-message-idx={{i}}
              />
            {{/each}}

            <div>
              {{this.unreadMessageIndicies.length}}
              unread messages
            </div>
            <div>
              is scrolled to bottom:
              {{this.isScrolledToBottom}}
            </div>
          {{else}}
            <NewSession @sendPrompt={{this.sendMessage}} />
          {{/if}}
          {{#if this.room}}
            <AiAssistantSkillMenu
              class='skills'
              @skills={{this.skills}}
              @onChooseCard={{this.attachSkill}}
              data-test-skill-menu
            />
          {{/if}}
        </AiAssistantConversation>

        <footer class='room-actions'>
          <div class='chat-input-area' data-test-chat-input-area>
            <AiAssistantChatInput
              @value={{this.messageToSend}}
              @onInput={{this.setMessage}}
              @onSend={{this.sendMessage}}
              @canSend={{this.canSend}}
              data-test-message-field={{@roomId}}
            />
            <AiAssistantCardPicker
              @autoAttachedCards={{this.autoAttachedCards}}
              @cardsToAttach={{this.cardsToAttach}}
              @chooseCard={{this.chooseCard}}
              @removeCard={{this.removeCard}}
            />
          </div>
        </footer>
      </section>
    {{/if}}

    <style scoped>
      .room {
        display: grid;
        grid-template-rows: 1fr auto;
        height: 100%;
        overflow: hidden;
      }
      .skills {
        position: sticky;
        bottom: 0;
        margin-left: auto;
      }
      .room-actions {
        padding: var(--boxel-sp-xxs) var(--boxel-sp) var(--boxel-sp);
        box-shadow: var(--boxel-box-shadow);
      }
      .chat-input-area {
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      :deep(.ai-assistant-conversation > *:first-child) {
        margin-top: auto;
      }
      :deep(.ai-assistant-conversation > *:nth-last-of-type(2)) {
        padding-bottom: var(--boxel-sp-xl);
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  private roomResource = getRoom(
    this,
    () => this.args.roomId,
    () => this.matrixService.getRoom(this.args.roomId)?.events,
  );
  private autoAttachmentResource = getAutoAttachment(
    this,
    () => this.topMostStackItems,
    () => this.cardsToAttach,
  );

  @tracked private currentMonacoContainer: number | undefined;
  @tracked private isScrolledToBottom = false;
  @tracked private userHasScrolled = false;
  private messageScrollers: Map<number, () => void> = new TrackedMap();
  private messageElements: WeakMap<HTMLElement, number> = new TrackedWeakMap();
  private messageVisibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      let index = this.messageElements.get(entry.target as HTMLElement);
      if (index != null) {
        if (entry.isIntersecting) {
          // we only send the read receipt after the message has scrolled into view
          // Note: this is over sending (we always have), as we really only need
          // to send a read receipt for messages that were read after the last read
          // receipt the server told us about.
          this.sendReadReceipt(this.messages[index]);
        }
      }
    });
  });

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();

    this.loadRoomSkills.perform();
    registerDestructor(this, () => this.messageVisibilityObserver.disconnect());
  }

  private loadRoomSkills = restartableTask(async () => {
    await this.roomResource.loading;
    let defaultSkills = await this.matrixService.loadDefaultSkills();
    if (this.roomResource.room) {
      this.roomResource.room.skills = defaultSkills;
    }
  });

  private registerScroller = ({
    index,
    element,
    scrollTo,
  }: {
    index: number;
    element: HTMLElement;
    scrollTo: () => void;
  }) => {
    this.messageElements.set(element, index);
    this.messageScrollers.set(index, scrollTo);
    this.messageVisibilityObserver.observe(element);
    if (
      (!this.userHasScrolled || this.isScrolledToBottom) &&
      index === this.messages.length - 1
    ) {
      scrollTo();
    }
  };

  private setScrollPosition = ({
    isBottom,
    // TODO eventually we'll want to perserve the current scroll position
    // as user switches between rooms
    currentPosition: _currentPosition,
  }: {
    currentPosition: number;
    isBottom: boolean;
  }) => {
    this.isScrolledToBottom = isBottom;
    if (!isBottom) {
      this.userHasScrolled = true;
    }
  };

  @cached
  private get unreadMessageIndicies() {
    // read receipts are implemented using “up to” markers. This marker indicates
    // that the acknowledgement applies to all events “up to and including” the
    // event specified. For example, marking an event as “read” would indicate that
    // the user had read all events up to the referenced event.
    let readReceiptIndicies: number[] = [];
    let unviewedIndicies: number[] = [];
    for (let receipt of this.matrixService.currentUserEventReadReceipts.keys()) {
      let maybeIndex = this.messages.findIndex((m) => m.eventId === receipt);
      if (maybeIndex != null) {
        readReceiptIndicies.push(maybeIndex);
      }
    }
    let firstUnreadIndex = (max(readReceiptIndicies) ?? -1) + 1;
    for (let i = firstUnreadIndex; i < this.messages.length; i++) {
      if (
        this.matrixService.profile.userId === this.messages[i].author.userId
      ) {
        continue;
      }
      unviewedIndicies.push(i);
    }
    return unviewedIndicies;
  }

  private sendReadReceipt(message: Message) {
    if (this.matrixService.profile.userId === message.author.userId) {
      return;
    }
    if (this.matrixService.currentUserEventReadReceipts.has(message.eventId)) {
      return;
    }

    // sendReadReceipt expects an actual MatrixEvent (as defined in the matrix
    // SDK), but it' not available to us here - however, we can fake it by adding
    // the necessary methods
    let matrixEvent = {
      getId: () => message.eventId,
      getRoomId: () => this.args.roomId,
      getTs: () => message.created.getTime(),
    };

    // Without scheduling this after render, this produces the "attempted to
    // update value, but it had already been used previously in the same
    // computation" error
    schedule('afterRender', () => {
      this.matrixService.client.sendReadReceipt(matrixEvent as MatrixEvent);
    });
  }

  private maybeRetryAction = (messageIndex: number, message: Message) => {
    if (this.isLastMessage(messageIndex) && message.isRetryable) {
      return this.resendLastMessage;
    }
    return undefined;
  };

  @action private isMessageStreaming(message: Message, messageIndex: number) {
    return (
      !message.isStreamingFinished &&
      this.isLastMessage(messageIndex) &&
      // Older events do not come with isStreamingFinished property so we have
      // no other way to determine if the message is done streaming other than
      // checking if they are old messages (older than 60 seconds as an arbitrary
      // threshold)
      unixTime(new Date().getTime() - message.created.getTime()) < 60
    );
  }

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.roomResource.loading;
  });

  private get messages() {
    return this.roomResource.messages;
  }

  private get skills(): Skill[] {
    return this.roomResource.skills;
  }

  private get room() {
    let room = this.roomResource.room;
    return room;
  }

  private doWhenRoomChanges = restartableTask(async () => {
    await all([this.cardService.cardsSettled(), timeout(500)]);
  });

  private get messageToSend() {
    return this.matrixService.messagesToSend.get(this.args.roomId) ?? '';
  }

  private get cardsToAttach() {
    return this.matrixService.cardsToSend.get(this.args.roomId);
  }

  @action private resendLastMessage() {
    if (!this.room) {
      throw new Error(
        'Bug: should not be able to resend a message without a room.',
      );
    }

    let myMessages = this.messages.filter(
      (message) => message.author.userId === this.matrixService.userId,
    );
    if (myMessages.length === 0) {
      throw new Error(
        'Bug: should not be able to resend a message that does not exist.',
      );
    }
    let myLastMessage = myMessages[myMessages.length - 1];

    let attachedCards = (myLastMessage!.attachedResources || [])
      .map((resource) => resource.card)
      .filter((card) => card !== undefined) as CardDef[];

    this.doSendMessage.perform(
      myLastMessage.message,
      attachedCards,
      true,
      myLastMessage.clientGeneratedId,
    );
  }

  @action
  private setMessage(message: string) {
    this.matrixService.messagesToSend.set(this.args.roomId, message);
  }

  @action
  private sendMessage(prompt?: string) {
    let cards = [];
    if (this.cardsToAttach) {
      cards.push(...this.cardsToAttach);
    }
    if (this.autoAttachedCards.size > 0) {
      this.autoAttachedCards.forEach((card) => {
        cards.push(card);
      });
    }
    this.doSendMessage.perform(
      prompt ?? this.messageToSend,
      cards.length ? cards : undefined,
      Boolean(prompt),
    );
  }

  @action
  private chooseCard(card: CardDef) {
    let cards = this.cardsToAttach ?? [];
    if (!cards?.find((c) => c.id === card.id)) {
      this.matrixService.cardsToSend.set(this.args.roomId, [...cards, card]);
    }
  }

  @action
  private isAutoAttachedCard(card: CardDef) {
    return this.autoAttachedCards.has(card);
  }

  @action
  private removeCard(card: CardDef) {
    if (this.isAutoAttachedCard(card)) {
      this.autoAttachmentResource.onCardRemoval(card);
    } else {
      const cardIndex = this.cardsToAttach?.findIndex((c) => c.id === card.id);
      if (cardIndex != undefined && cardIndex !== -1) {
        if (this.cardsToAttach !== undefined) {
          this.autoAttachmentResource.onCardRemoval(
            this.cardsToAttach[cardIndex],
          );
          this.cardsToAttach.splice(cardIndex, 1);
        }
      }
    }
    this.matrixService.cardsToSend.set(
      this.args.roomId,
      this.cardsToAttach?.length ? this.cardsToAttach : undefined,
    );
  }
  private doSendMessage = enqueueTask(
    async (
      message: string | undefined,
      cards?: CardDef[],
      keepInputAndAttachments: boolean = false,
      clientGeneratedId: string = uuidv4(),
    ) => {
      if (!keepInputAndAttachments) {
        // this is for situations when a message is sent via some other way than the text box
        // (example: ai prompt from new-session screen)
        // if there were cards attached or a typed — but not sent — message, do not erase or remove them
        this.matrixService.messagesToSend.set(this.args.roomId, undefined);
        this.matrixService.cardsToSend.set(this.args.roomId, undefined);
      }
      let context = {
        submode: this.operatorModeStateService.state.submode,
        openCardIds: this.operatorModeStateService
          .topMostStackItems()
          .filter((stackItem) => stackItem)
          .map((stackItem) => stackItem.card.id),
      };
      let activeSkillCards = this.skills
        .filter((skill) => skill.isActive)
        .map((c) => c.card);
      await this.matrixService.sendMessage(
        this.args.roomId,
        message,
        cards,
        activeSkillCards,
        clientGeneratedId,
        context,
      );
    },
  );

  private get topMostStackItems(): StackItem[] {
    return this.operatorModeStateService.topMostStackItems();
  }

  private get autoAttachedCards() {
    return this.autoAttachmentResource.cards;
  }

  private get canSend() {
    return (
      !this.doSendMessage.isRunning &&
      Boolean(
        this.messageToSend?.trim() ||
          this.cardsToAttach?.length ||
          this.autoAttachedCards.size !== 0,
      ) &&
      !!this.room &&
      !this.messages.some((m) => this.isPendingMessage(m))
    );
  }

  @action
  private isLastMessage(messageIndex: number) {
    return (this.room && messageIndex === this.messages.length - 1) ?? false;
  }

  @action private setCurrentMonacoContainer(index: number | undefined) {
    this.currentMonacoContainer = index;
  }

  private isPendingMessage(message: Message) {
    return message.status === 'sending' || message.status === 'queued';
  }

  @action private attachSkill(card: SkillCard) {
    this.roomResource?.addSkill(card);
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    'Matrix::Room': typeof Room;
  }
}
