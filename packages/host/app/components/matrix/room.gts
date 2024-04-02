import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { enqueueTask, restartableTask, timeout, all } from 'ember-concurrency';

import { getRoom } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import type { MessageField } from 'https://cardstack.com/base/room';

import AiAssistantCardPicker from '../ai-assistant/card-picker';
import AiAssistantChatInput from '../ai-assistant/chat-input';
import { AiAssistantConversation } from '../ai-assistant/message';
import NewSession from '../ai-assistant/new-session';

import RoomMessage from './room-message';

interface Signature {
  Args: {
    roomId: string;
    monacoSDK: MonacoSDK;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <section
      class='room'
      data-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-name={{this.room.name}}
      data-test-room={{this.room.roomId}}
    >
      {{#if this.hasMessagesOrPending}}
        <AiAssistantConversation>
          {{#each this.room.messages as |message i|}}
            <RoomMessage
              @message={{message}}
              @monacoSDK={{@monacoSDK}}
              @isStreaming={{this.isMessageStreaming message i}}
              @currentEditor={{this.currentMonacoContainer}}
              @setCurrentEditor={{this.setCurrentMonacoContainer}}
              data-test-message-idx={{i}}
            />
          {{/each}}
          {{#if this.pendingMessage}}
            <RoomMessage
              @message={{this.pendingMessage}}
              @monacoSDK={{@monacoSDK}}
              @isStreaming={{false}}
              @isPending={{true}}
              @currentEditor={{this.currentMonacoContainer}}
              @setCurrentEditor={{this.setCurrentMonacoContainer}}
              data-test-message-idx={{this.room.messages.length}}
            />
          {{/if}}
        </AiAssistantConversation>
      {{else}}
        <NewSession @sendPrompt={{this.sendPrompt}} />
      {{/if}}

      <footer class='room-actions'>
        <div class='chat-input-area' data-test-chat-input-area>
          <AiAssistantChatInput
            @value={{this.messageToSend}}
            @onInput={{this.setMessage}}
            @onSend={{this.sendMessage}}
            @canSend={{this.canSend}}
            data-test-message-field={{this.room.roomId}}
          />
          <AiAssistantCardPicker
            @autoAttachedCard={{this.autoAttachedCard}}
            @cardsToAttach={{this.cardsToAttach}}
            @chooseCard={{this.chooseCard}}
            @removeCard={{this.removeCard}}
          />
        </div>
      </footer>
    </section>

    <style>
      .room {
        display: grid;
        grid-template-rows: 1fr auto;
        height: 100%;
        overflow: hidden;
      }
      .timeline-start {
        padding-bottom: var(--boxel-sp);
      }
      .room-actions {
        padding: var(--boxel-sp);
        box-shadow: var(--boxel-box-shadow);
      }
      .room-actions > * + * {
        margin-top: var(--boxel-sp-sm);
      }
      .chat-input-area {
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      :deep(.ai-assistant-conversation > *:first-child) {
        margin-top: auto;
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  private roomResource = getRoom(this, () => this.args.roomId);
  private lastTopMostCard: CardDef | undefined;

  @tracked private isAutoAttachedCardDisplayed = true;
  @tracked private currentMonacoContainer: number | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  @action isMessageStreaming(message: MessageField, messageIndex: number) {
    return (
      !message.isStreamingFinished &&
      this.isLastMessage(messageIndex) &&
      (new Date().getTime() - message.created.getTime()) / 1000 < 60 // Older events do not come with isStreamingFinished property so we have no other way to determine if the message is done streaming other than checking if they are old messages (older than 60 seconds as an arbitrary threshold)
    );
  }

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.roomResource.loading;
  });

  private get hasMessagesOrPending() {
    return (this.room && this.room.messages.length > 0) || this.pendingMessage;
  }

  private get room() {
    return this.roomResource.room;
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

  private get pendingMessage() {
    return this.matrixService.pendingMessages.get(this.args.roomId);
  }

  @action sendPrompt(prompt: string) {
    this.doSendMessage.perform(prompt); // sends the prompt only
  }

  @action
  private setMessage(message: string) {
    this.matrixService.messagesToSend.set(this.args.roomId, message);
  }

  @action
  private sendMessage() {
    let cards = [];
    if (this.cardsToAttach) {
      cards.push(...this.cardsToAttach);
    }
    if (this.autoAttachedCard) {
      cards.push(this.autoAttachedCard);
    }
    this.doSendMessage.perform(
      this.messageToSend,
      cards.length ? cards : undefined,
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
  private removeCard(card: CardDef) {
    // If card doesn't exist in `cardsToAttch`,
    // then it is an auto-attached card.
    const cardIndex = this.cardsToAttach?.findIndex((c) => c.id === card.id);
    if (
      cardIndex == undefined ||
      (cardIndex === -1 && this.autoAttachedCard?.id === card.id)
    ) {
      this.isAutoAttachedCardDisplayed = false;
    } else {
      if (cardIndex != undefined && cardIndex !== -1) {
        this.cardsToAttach?.splice(cardIndex, 1);
      }
      this.matrixService.cardsToSend.set(
        this.args.roomId,
        this.cardsToAttach?.length ? this.cardsToAttach : undefined,
      );
    }
  }

  private doSendMessage = enqueueTask(
    async (message: string | undefined, cards?: CardDef[]) => {
      let context = {
        submode: this.operatorModeStateService.state.submode,
        openCardIds: this.operatorModeStateService
          .topMostStackItems()
          .filter((stackItem) => stackItem)
          .map((stackItem) => stackItem.card.id),
      };
      await this.matrixService.sendMessage(
        this.args.roomId,
        message,
        cards,
        context,
      );
    },
  );

  @action
  private setLastTopMostCard(card: CardDef) {
    if (this.lastTopMostCard?.id !== card.id) {
      this.lastTopMostCard = card;
      this.isAutoAttachedCardDisplayed = true;
    }
  }

  private get autoAttachedCard(): CardDef | undefined {
    let stackItems = this.operatorModeStateService.topMostStackItems();
    if (stackItems.length === 0) {
      return undefined;
    }
    let topMostItem = stackItems[stackItems.length - 1];
    let topMostCard = topMostItem?.card;
    if (!topMostCard) {
      return undefined;
    } else {
      let realmURL = topMostItem.card[topMostItem.api.realmURL];
      if (!realmURL) {
        throw new Error(
          `could not determine realm URL for card ${topMostItem.card.id}`,
        );
      }
      if (topMostItem.card.id === `${realmURL.href}index`) {
        return undefined;
      }
    }
    this.setLastTopMostCard(topMostCard);

    let card = this.cardsToAttach?.find((c) => c.id === topMostCard.id);
    if (!this.isAutoAttachedCardDisplayed || card) {
      return undefined;
    }

    return topMostCard;
  }

  private get canSend() {
    return (
      !this.doSendMessage.isRunning &&
      Boolean(
        this.messageToSend ||
          this.cardsToAttach?.length ||
          this.autoAttachedCard,
      )
    );
  }

  @action
  private isLastMessage(messageIndex: number) {
    return (
      (this.room && messageIndex === this.room.messages.length - 1) ?? false
    );
  }

  @action private setCurrentMonacoContainer(index: number | undefined) {
    this.currentMonacoContainer = index;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    'Matrix::Room': typeof Room;
  }
}
