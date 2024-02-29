import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout, all } from 'ember-concurrency';

import { TrackedMap } from 'tracked-built-ins';

import { getRoom } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import AiAssistantCardPicker from '../ai-assistant/card-picker';
import AiAssistantChatInput from '../ai-assistant/chat-input';
import { AiAssistantConversation } from '../ai-assistant/message';
import NewSession from '../ai-assistant/new-session';

import RoomMessage from './room-message';

interface Signature {
  Args: {
    roomId: string;
  };
}

export default class Room extends Component<Signature> {
  <template>
    <section
      class='room'
      data-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room-settled={{this.doWhenRoomChanges.isIdle}}
      data-test-room={{this.room.name}}
      data-test-room-id={{this.room.roomId}}
    >
      {{#if this.room.messages}}
        <AiAssistantConversation>
          {{#each this.room.messages as |message i|}}
            <RoomMessage @message={{message}} data-test-message-idx={{i}} />
          {{/each}}
        </AiAssistantConversation>
      {{else}}
        <NewSession @sendPrompt={{this.sendPrompt}} />
      {{/if}}

      <footer class='room-actions'>
        <AiAssistantChatInput
          @value={{this.messageToSend}}
          @onInput={{this.setMessage}}
          @onSend={{this.sendMessage}}
          data-test-message-field={{this.room.name}}
        />
        <AiAssistantCardPicker
          @autoAttachedCard={{this.autoAttachedCard}}
          @maxNumberOfCards={{5}}
          @cardsToAttach={{this.cardsToAttach}}
          @chooseCard={{this.chooseCard}}
          @removeCard={{this.removeCard}}
        />
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
        box-shadow: var(--boxel-box-shadow);
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  private roomResource = getRoom(this, () => this.args.roomId);
  private messagesToSend: TrackedMap<string, string | undefined> =
    new TrackedMap();
  private cardsToSend: TrackedMap<string, CardDef[] | undefined> =
    new TrackedMap();
  private lastTopMostCard: CardDef | undefined;

  @tracked private isAutoAttachedCardDisplayed = true;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.roomResource.loading;
  });

  private get room() {
    return this.roomResource.room;
  }

  private doWhenRoomChanges = restartableTask(async () => {
    await all([this.cardService.cardsSettled(), timeout(500)]);
  });

  private get messageToSend() {
    return this.messagesToSend.get(this.args.roomId) ?? '';
  }

  private get cardsToAttach() {
    return this.cardsToSend.get(this.args.roomId);
  }

  @action sendPrompt(message: string) {
    this.setMessage(message);
    this.sendMessage();
  }

  @action
  private setMessage(message: string) {
    this.messagesToSend.set(this.args.roomId, message);
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
      this.cardsToSend.set(this.args.roomId, [...cards, card]);
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
      this.cardsToSend.set(
        this.args.roomId,
        this.cardsToAttach?.length ? this.cardsToAttach : undefined,
      );
    }
  }

  private doSendMessage = restartableTask(
    async (message: string | undefined, cards?: CardDef[]) => {
      this.messagesToSend.set(this.args.roomId, undefined);
      this.cardsToSend.set(this.args.roomId, undefined);
      let context = {
        submode: this.operatorModeStateService.state.submode,
        openCardIds: this.operatorModeStateService
          .topMostStackItems()
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
    let topMostCard = stackItems[stackItems.length - 1]?.card;
    if (!topMostCard) {
      return undefined;
    }
    this.setLastTopMostCard(topMostCard);

    let card = this.cardsToAttach?.find((c) => c.id === topMostCard.id);
    if (!this.isAutoAttachedCardDisplayed || card) {
      return undefined;
    }

    return topMostCard;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    'Matrix::Room': typeof Room;
  }
}
