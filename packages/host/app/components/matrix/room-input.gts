import { Input } from '@ember/component';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

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
      @maxNumberOfCards={{5}}
      @cardsToAttach={{this.cardsToAttach}}
      @chooseCard={{this.chooseCard}}
      @removeCard={{this.removeCard}}
    />
    <label>
      <Input
        @type='checkbox'
        @checked={{this.shareCurrentContext}}
        data-test-share-context
      />
      Allow access to the cards you can see at the top of your stacks
    </label>
  </template>

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
    let cards = this.cardsToSend.get(this.args.roomId);
    return cards?.length ? new Set([...cards]) : new Set([]);
  }

  @action
  private setMessage(message: string) {
    this.messagesToSend.set(this.args.roomId, message);
  }

  @action
  private sendMessage() {
    if (this.messageToSend == null && !this.cardsToAttach) {
      throw new Error(
        `bug: should never get here, send button is disabled when there is no message nor card`,
      );
    }
    this.doSendMessage.perform(this.messageToSend, [...this.cardsToAttach]);
  }

  @action
  private chooseCard(card: CardDef) {
    this.cardsToSend.set(this.args.roomId, [...this.cardsToAttach.add(card)]);
  }

  @action
  private removeCard() {
    this.cardsToSend.set(this.args.roomId, undefined);
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
}
