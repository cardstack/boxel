import { Input } from '@ember/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { TrackedMap } from 'tracked-built-ins';

import { AddButton, IconButton } from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

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

    <div class='attach-card'>
      {{#if this.cardtoSend}}
        <div
          class='selected-card pill'
          data-test-selected-card={{this.cardtoSend.id}}
        >
          <this.cardToSendComponent />
          <IconButton
            class='remove-button'
            @icon={{IconX}}
            {{on 'click' this.removeCard}}
            data-test-remove-card-btn
          />
        </div>
      {{else}}
        <AddButton
          class='attach-button pill'
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
        --attach-card-pill-height: 1.875rem;
        background-color: var(--boxel-100);
        color: var(--boxel-dark);
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp);
      }
      .pill {
        height: var(--attach-card-pill-height);
        display: flex;
        align-items: center;
        font: 700 var(--boxel-font-sm);
        border-radius: var(--boxel-border-radius-sm);
      }
      .attach-button {
        padding: 0 var(--boxel-sp-xs);
      }
      .attach-button:hover:not(:disabled) {
        box-shadow: none;
        background-color: var(--boxel-highlight-hover);
      }
      .attach-button:focus:not(:disabled) {
        outline-offset: -2px;
        outline: var(--boxel-outline);
      }
      .attach-button:focus:not(:focus-visible) {
        outline-color: transparent;
      }
      .selected-card {
        padding: 0 0 0 var(--boxel-sp-xxs);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        gap: var(--boxel-sp-5xs);
      }
      .selected-card :deep(.atom-format) {
        box-shadow: none;
        padding: 0;
      }
      .remove-button {
        --boxel-icon-button-width: 25px;
        --boxel-icon-button-height: 25px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .remove-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
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
