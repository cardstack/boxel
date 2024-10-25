import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import { enqueueTask, restartableTask, timeout, all } from 'ember-concurrency';

import max from 'lodash/max';

import { MatrixEvent } from 'matrix-js-sdk';

import pluralize from 'pluralize';

import { TrackedObject } from 'tracked-built-ins';

import { v4 as uuidv4 } from 'uuid';

import { BoxelButton } from '@cardstack/boxel-ui/components';
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

import { type CardDef } from 'https://cardstack.com/base/card-api';
import type { SkillCard } from 'https://cardstack.com/base/skill-card';

import AiAssistantCardPicker from '../ai-assistant/card-picker';
import AiAssistantChatInput from '../ai-assistant/chat-input';
import { AiAssistantConversation } from '../ai-assistant/message';
import NewSession from '../ai-assistant/new-session';
import AiAssistantSkillMenu from '../ai-assistant/skill-menu';

import RoomMessage from './room-message';

import type { RoomState } from '../../lib/matrix-classes/room';
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
        <AiAssistantConversation
          @registerConversationScroller={{this.registerConversationScroller}}
          @setScrollPosition={{this.setScrollPosition}}
        >
          {{#if this.messages}}
            {{#each this.messages as |message i|}}
              <RoomMessage
                @roomId={{@roomId}}
                @message={{message}}
                @index={{i}}
                @registerScroller={{this.registerMessageScroller}}
                @isPending={{this.isPendingMessage message}}
                @monacoSDK={{@monacoSDK}}
                @isStreaming={{this.isMessageStreaming message i}}
                @currentEditor={{this.currentMonacoContainer}}
                @setCurrentEditor={{this.setCurrentMonacoContainer}}
                @retryAction={{this.maybeRetryAction i message}}
                data-test-message-idx={{i}}
              />
            {{/each}}
          {{else}}
            <NewSession @sendPrompt={{this.sendMessage}} />
          {{/if}}
          {{#if this.room}}
            {{#if this.showUnreadIndicator}}
              <div class='unread-indicator'>
                <BoxelButton
                  @size='tall'
                  @kind='primary'
                  class='unread-button'
                  data-test-unread-messages-button
                  {{on 'click' this.scrollToFirstUnread}}
                >{{this.unreadMessageText}}</BoxelButton>
              </div>
            {{else}}
              <AiAssistantSkillMenu
                class='skills'
                @skills={{this.skills}}
                @onChooseCard={{this.attachSkill}}
                data-test-skill-menu
              />
            {{/if}}
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
      .unread-indicator {
        position: sticky;
        bottom: 0;
        margin-left: auto;
        width: 100%;
      }
      .unread-button {
        width: 100%;
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
  private getConversationScrollability: (() => boolean) | undefined;
  private roomScrollState: WeakMap<
    RoomState,
    {
      messageElemements: WeakMap<HTMLElement, number>;
      messageScrollers: Map<number, Element['scrollIntoView']>;
      messageVisibilityObserver: IntersectionObserver;
      isScrolledToBottom: boolean;
      userHasScrolled: boolean;
      isConversationScrollable: boolean;
    }
  > = new WeakMap();

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
    this.loadRoomSkills.perform();
  }

  @cached
  private get scrollState() {
    if (!this.room) {
      throw new Error(`Cannot get room scroll state before room is loaded`);
    }
    let state = this.roomScrollState.get(this.room);
    if (!state) {
      state = new TrackedObject({
        isScrolledToBottom: false,
        userHasScrolled: false,
        isConversationScrollable: false,
        messageElemements: new WeakMap(),
        messageScrollers: new Map(),
        messageVisibilityObserver: new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            let index = this.messageElements.get(entry.target as HTMLElement);
            if (index != null) {
              if (
                (!this.isConversationScrollable || entry.isIntersecting) &&
                index > this.lastReadMessageIndex
              ) {
                this.sendReadReceipt(this.messages[index]);
              }
            }
          });
        }),
      });
      this.roomScrollState.set(this.room, state);
    }
    return state;
  }

  private get isScrolledToBottom() {
    return this.scrollState.isScrolledToBottom;
  }

  private get userHasScrolled() {
    return this.scrollState.userHasScrolled;
  }

  private get isConversationScrollable() {
    return this.scrollState.isConversationScrollable;
  }

  private get messageElements() {
    return this.scrollState.messageElemements;
  }

  private get messageScrollers() {
    return this.scrollState.messageScrollers;
  }

  private get messageVisibilityObserver() {
    return this.scrollState.messageVisibilityObserver;
  }

  private loadRoomSkills = restartableTask(async () => {
    await this.roomResource.loading;
    let defaultSkills = await this.matrixService.loadDefaultSkills();
    if (this.roomResource.room) {
      this.roomResource.room.skills = defaultSkills;
    }
  });

  private registerMessageScroller = ({
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
    this.scrollState.isConversationScrollable = Boolean(
      this.getConversationScrollability?.(),
    );
    if (!this.isConversationScrollable || !this.isAllowedToAutoScroll) {
      return;
    }

    // TODO udpate this so that we preserve the scroll position as the user
    // changes rooms and we restore the scroll position when a user enters a room
    if (
      // If we are permitted to auto-scroll and if there are no unread messages in the
      // room, then scroll to the last message in the room.
      !this.hasUnreadMessages &&
      index === this.messages.length - 1
    ) {
      scrollTo();
    } else if (
      // otherwise if we are permitted to auto-scroll and if there are unread
      // messages in the room, then scroll to the first unread message in the room.
      this.hasUnreadMessages &&
      index === this.lastReadMessageIndex + 1
    ) {
      scrollTo();
    }
  };

  private registerConversationScroller = (
    isConversationScrollable: () => boolean,
  ) => {
    this.getConversationScrollability = isConversationScrollable;
  };

  private setScrollPosition = ({ isBottom }: { isBottom: boolean }) => {
    this.scrollState.isScrolledToBottom = isBottom;
    if (!isBottom) {
      this.scrollState.userHasScrolled = true;
    }
  };

  private scrollToFirstUnread = () => {
    if (!this.hasUnreadMessages) {
      return;
    }

    let firstUnreadIndex = this.lastReadMessageIndex + 1;
    let scrollTo = this.messageScrollers.get(firstUnreadIndex);
    if (!scrollTo) {
      console.warn(`No scroller for message index ${firstUnreadIndex}`);
    } else {
      scrollTo({ behavior: 'smooth' });
    }
  };

  private get isAllowedToAutoScroll() {
    return !this.userHasScrolled || this.isScrolledToBottom;
  }

  // For efficiency, read receipts are implemented using “up to” markers. This
  // marker indicates that the acknowledgement applies to all events “up to and
  // including” the event specified. For example, marking an event as “read” would
  // indicate that the user had read all events up to the referenced event.
  @cached private get lastReadMessageIndex() {
    let readReceiptIndicies: number[] = [];
    for (let receipt of this.matrixService.currentUserEventReadReceipts.keys()) {
      let maybeIndex = this.messages.findIndex((m) => m.eventId === receipt);
      if (maybeIndex != null) {
        readReceiptIndicies.push(maybeIndex);
      }
    }
    return max(readReceiptIndicies) ?? -1;
  }

  @cached private get numberOfUnreadMessages() {
    let unreadMessagesCount = 0;
    let firstUnreadIndex = this.lastReadMessageIndex + 1;
    for (let i = firstUnreadIndex; i < this.messages.length; i++) {
      if (
        this.matrixService.profile.userId === this.messages[i].author.userId
      ) {
        continue;
      }
      unreadMessagesCount++;
    }
    return unreadMessagesCount;
  }

  private get hasUnreadMessages() {
    return this.numberOfUnreadMessages > 0;
  }

  private get showUnreadIndicator() {
    // if user is already scrolled to bottom we don't show the indicator to
    // prevent the flash of the indicator appearing and then disappearing during
    // the read receipt acknowledgement
    return (
      this.isConversationScrollable &&
      this.hasUnreadMessages &&
      !this.isScrolledToBottom
    );
  }

  private get unreadMessageText() {
    return `${this.numberOfUnreadMessages} unread ${pluralize(
      'message',
      this.numberOfUnreadMessages,
    )}`;
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
