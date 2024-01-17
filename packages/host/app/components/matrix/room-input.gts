import { Input } from '@ember/component';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { restartableTask } from 'ember-concurrency';

import { TrackedMap } from 'tracked-built-ins';

import { BoxelInput, Button } from '@cardstack/boxel-ui/components';

import { not, and } from '@cardstack/boxel-ui/helpers';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { type CardDef } from 'https://cardstack.com/base/card-api';

import type OperatorModeStateService from '../../services/operator-mode-state-service';

interface RoomArgs {
  Args: {
    roomId: string;
    roomName?: string;
  };
}

export default class RoomInput extends Component<RoomArgs> {
  <template>
    <div class='send-message'>
      <BoxelInput
        type='text'
        @type='textarea'
        @value={{this.messageToSend}}
        @onInput={{this.setMessage}}
        rows='4'
        cols='20'
        data-test-message-field={{@roomName}}
      />

      {{#if this.cardtoSend}}
        <div class='selected-card'>
          <div class='field'>Selected Card:</div>
          <div
            class='card-wrapper'
            data-test-selected-card={{this.cardtoSend.id}}
          >
            <this.cardToSendComponent />
          </div>
        </div>
        <Button
          @kind='secondary-dark'
          {{on 'click' this.removeCard}}
          data-test-remove-card-btn
        >
          Remove Card
        </Button>
      {{else}}
        <Button
          @kind='secondary-dark'
          {{on 'click' this.chooseCard}}
          @disabled={{this.doChooseCard.isRunning}}
          data-test-choose-card-btn
        >
          Choose Card
        </Button>

        <label>
          <Input
            @type='checkbox'
            @checked={{this.shareCurrentContext}}
            data-test-share-context
          />
          Allow access to the cards you can see at the top of your stacks
        </label>
      {{/if}}

      <Button
        data-test-send-message-btn
        @disabled={{and (not this.messageToSend) (not this.cardtoSend)}}
        @loading={{this.doSendMessage.isRunning}}
        @kind='primary'
        {{on 'click' this.sendMessage}}
      >
        Send
      </Button>
    </div>

    <style>
      .send-message {
        display: flex;
        justify-content: right;
        flex-wrap: wrap;
        row-gap: var(--boxel-sp-sm);
      }

      .send-message button,
      .send-message .selected-card {
        margin-left: var(--boxel-sp-sm);
      }

      .selected-card {
        margin: var(--boxel-sp);
        float: right;
      }

      .selected-card::after {
        content: '';
        clear: both;
      }

      .field {
        font-weight: bold;
      }

      .card-wrapper {
        padding: var(--boxel-sp);
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        color: var(--boxel-dark);
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
    return this.messagesToSend.get(this.args.roomId);
  }

  private get cardtoSend() {
    return this.cardsToSend.get(this.args.roomId);
  }

  private get cardToSendComponent() {
    if (this.cardtoSend) {
      return this.cardtoSend.constructor.getComponent(
        this.cardtoSend,
        'embedded',
      );
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
