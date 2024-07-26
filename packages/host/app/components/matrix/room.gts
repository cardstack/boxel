import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { enqueueTask, restartableTask, timeout, all } from 'ember-concurrency';

import { TrackedObject } from 'tracked-built-ins/.';
import { v4 as uuidv4 } from 'uuid';

import { Message } from '@cardstack/host/lib/matrix-classes/message';
import type { StackItem } from '@cardstack/host/lib/stack-item';
import { getAutoAttachment } from '@cardstack/host/resources/auto-attached-card';
import { CardResource, getCard } from '@cardstack/host/resources/card-resource';
import { getRoom } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { CardDef } from 'https://cardstack.com/base/card-api';
import { SkillCard } from 'https://cardstack.com/base/skill-card';

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
    <section
      class='room'
      data-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-name={{this.roomResource.name}}
      data-test-room={{@roomId}}
    >
      <AiAssistantConversation>
        {{#if this.messages}}
          {{#each this.messages as |message i|}}
            <RoomMessage
              @roomId={{@roomId}}
              @messages={{this.messages}}
              @message={{message}}
              @index={{i}}
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
          <NewSession @sendPrompt={{this.sendPrompt}} />
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

    <style>
      .room {
        display: grid;
        grid-template-rows: 1fr auto;
        height: 100%;
        overflow: hidden;
      }
      .skills {
        position: sticky;
        bottom: var(--boxel-sp-5xs);
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
  private skillCardResources: Map<string, CardResource> = new Map();

  @tracked private currentMonacoContainer: number | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  maybeRetryAction = (messageIndex: number, message: Message) => {
    if (this.isLastMessage(messageIndex) && message.isRetryable) {
      return this.resendLastMessage;
    }
    return undefined;
  };

  @action isMessageStreaming(message: Message, messageIndex: number) {
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

  private get messages() {
    return this.roomResource.messages;
  }

  @cached
  private get skills(): Skill[] {
    this.ensureSkillCardResources();
    let skills = [];

    for (let skill of this.roomResource.skills) {
      let skillCardResource = this.skillCardResources.get(skill.card.id);
      skills.push(
        new TrackedObject({
          card: skillCardResource!.card ?? skill.card,
          isActive: skill.isActive,
        } as Skill),
      );
    }
    return skills;
  }

  private ensureSkillCardResources(): void {
    for (let skill of this.roomResource.skills) {
      let skillCardResource = this.skillCardResources.get(skill.card.id);
      if (!skillCardResource) {
        skillCardResource = getCard(this, () => skill.card.id);
        this.skillCardResources.set(skill.card.id, skillCardResource);
      }
    }
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

  @action resendLastMessage() {
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
      myLastMessage.clientGeneratedId,
    );
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
    if (this.autoAttachedCards.size > 0) {
      this.autoAttachedCards.forEach((card) => {
        cards.push(card);
      });
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
      clientGeneratedId: string = uuidv4(),
    ) => {
      this.matrixService.messagesToSend.set(this.args.roomId, undefined);
      this.matrixService.cardsToSend.set(this.args.roomId, undefined);
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

  get topMostStackItems(): StackItem[] {
    return this.operatorModeStateService.topMostStackItems();
  }

  get lastTopMostCard() {
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
    return topMostCard;
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
