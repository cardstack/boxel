import { Input } from '@ember/component';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { TrackedMap } from 'tracked-built-ins';

import AiAssistantCardPicker from '@cardstack/host/components/ai-assistant/card-picker';
import AiAssistantChatInput from '@cardstack/host/components/ai-assistant/chat-input';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';

interface RoomArgs {
  Args: {
    roomId: string;
    roomName?: string;
  };
}

export default class RoomInput extends Component<RoomArgs> {
  <template>
    <AiAssistantChatInput
      @value={{this.messageToSend}}
      @onInput={{this.setMessage}}
      @onSend={{this.sendMessage}}
      data-test-message-field={{@roomName}}
    />

    <AiAssistantCardPicker
      @autoAttachedCard={{this.autoAttachedCard}}
      @maxNumberOfCards={{5}}
      @cardsToAttach={{this.cardsToAttach}}
      @chooseCard={{this.chooseCard}}
      @removeCard={{this.removeCard}}
    />
  </template>

  @tracked private isAutoAttachedCardDisplayed = true;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  private shareCurrentContext = false;
  private messagesToSend: TrackedMap<string, string | undefined> =
    new TrackedMap();
  private cardsToSend: TrackedMap<string, CardDef[] | undefined> =
    new TrackedMap();

  private get messageToSend() {
    return this.messagesToSend.get(this.args.roomId) ?? '';
  }

  private get cardsToAttach() {
    return this.cardsToSend.get(this.args.roomId);
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
      let context = undefined;
      if (this.shareCurrentContext) {
        context = {
          submode: this.operatorModeStateService.state.submode,
          openCards: this.operatorModeStateService
            .topMostStackItems()
            .map((stackItem) => stackItem.card),
        };
      }
      await this.matrixService.sendMessage(
        this.args.roomId,
        message,
        cards,
        context,
      );
    },
  );

  private get autoAttachedCard(): CardDef | undefined {
    let stackItems = this.operatorModeStateService.topMostStackItems();
    let topMostCard = stackItems[stackItems.length - 1].card;
    let card = this.cardsToAttach?.find((c) => c.id === topMostCard.id);
    if (!this.isAutoAttachedCardDisplayed || card) {
      return undefined;
    }

    return topMostCard;
  }
}
