import { Input } from '@ember/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { TrackedMap } from 'tracked-built-ins';

import { AddButton, IconButton } from '@cardstack/boxel-ui/components';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import AiAssistantChatInput from '@cardstack/host/components/ai-assistant/chat-input';
import Pill from '@cardstack/host/components/pill';
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

    <div class='attach-card'>
      {{#if this.cardtoSend}}
        <Pill
          @inert={{true}}
          @removeAction={{this.removeCard}}
          class='selected-card'
          data-test-selected-card={{this.cardtoSend.id}}
        >
          <this.cardToSendComponent />
        </Pill>
      {{else}}
        <AddButton
          class='attach-button'
          @variant='pill'
          {{on 'click' this.chooseCard}}
          @disabled={{this.doChooseCard.isRunning}}
          data-test-choose-card-btn
        >
          Attach Card
        </AddButton>
      {{/if}}
      <label>
        <Input
          @type='checkbox'
          @checked={{this.shareCurrentContext}}
          data-test-share-context
        />
        Allow access to the cards you can see at the top of your stacks
      </label>
    </div>

    <style>
      .attach-card {
        --pill-height: 1.875rem;
        background-color: var(--boxel-100);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp);
      }
      .attach-button {
        --boxel-form-control-border-radius: var(--boxel-border-radius-sm);
        --boxel-add-button-pill-font: var(--boxel-font-sm);
        height: var(--pill-height);
        padding: 0 var(--boxel-sp-xs);
      }
      .attach-button:hover:not(:disabled) {
        box-shadow: none;
        background-color: var(--boxel-highlight-hover);
      }
      .selected-card {
        height: var(--pill-height);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
      }
      .selected-card :deep(.atom-format) {
        background: none;
        box-shadow: none;
        border: none;
        padding: 0;
      }
    </style>
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

  private get cardToSendComponent() {
    if (this.cardtoSend) {
      return this.cardtoSend.constructor.getComponent(this.cardtoSend, 'atom');
    }
    return undefined;
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
