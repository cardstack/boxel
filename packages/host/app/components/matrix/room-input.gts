import { Input } from '@ember/component';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';
import { TrackedMap } from 'tracked-built-ins';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

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
      @card={{this.cardtoSend}}
      @chooseCard={{this.chooseCard}}
      @removeCard={{this.removeCard}}
      @isLoading={{this.doChooseCard.isRunning}}
    >
      <label>
        <Input
          @type='checkbox'
          @checked={{this.shareCurrentContext}}
          data-test-share-context
        />
        Allow access to the cards you can see at the top of your stacks
      </label>
    </AiAssistantCardPicker>
  </template>

  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  private shareCurrentContext = false;
  private messagesToSend: TrackedMap<string, string | undefined> =
    new TrackedMap();
  private cardsToSend: TrackedMap<string, CardDef | undefined> =
    new TrackedMap();

  private get messageToSend() {
    return this.messagesToSend.get(this.args.roomId) ?? '';
  }

  private get cardtoSend() {
    return this.cardsToSend.get(this.args.roomId);
  }

  @action
  private setMessage(message: string) {
    this.messagesToSend.set(this.args.roomId, message);
  }

  @action
  private sendMessage() {
    if (this.messageToSend == null && !this.cardtoSend) {
      throw new Error(
        `bug: should never get here, send button is disabled when there is no message nor card`,
      );
    }
    this.doSendMessage.perform(this.messageToSend, this.cardtoSend);
  }

  @action
  private chooseCard() {
    this.doChooseCard.perform();
  }

  @action
  private removeCard() {
    this.cardsToSend.set(this.args.roomId, undefined);
  }

  private doSendMessage = restartableTask(
    async (message: string | undefined, card?: CardDef) => {
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
        card,
        context,
      );
    },
  );

  private doChooseCard = restartableTask(async () => {
    let chosenCard: CardDef | undefined = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (chosenCard) {
      this.cardsToSend.set(this.args.roomId, chosenCard);
    }
  });
}
