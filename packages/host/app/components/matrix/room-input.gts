import { Input } from '@ember/component';
import { registerDestructor } from '@ember/destroyable';
import { concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
//@ts-expect-error the types don't recognize the cached export
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { TrackedMap } from 'tracked-built-ins';

import { BoxelInput, Button } from '@cardstack/boxel-ui/components';

import { not, and } from '@cardstack/boxel-ui/helpers';

import { chooseCard, baseCardRef } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type CardService from '@cardstack/host/services/card-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  type CardDef,
  type FieldDef,
} from 'https://cardstack.com/base/card-api';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { getRoom } from '../../resources/room';

import type OperatorModeStateService from '../../services/operator-mode-state-service';

const { environment } = config;

interface RoomArgs {
  Args: {
    roomId: string;
  };
}

export default class RoomInput extends Component<RoomArgs> {
  helperId = guidFor(this);
  <template>
    <div class='send-message'>
      <BoxelInput
        data-test-message-field={{this.room.name}}
        type='text'
        @type='textarea'
        @value={{this.messageToSend}}
        @onInput={{this.setMessage}}
        rows='4'
        cols='20'
      />
      {{#if this.cardtoSend}}
        <Button
          @kind='secondary-dark'
          data-test-remove-card-btn
          {{on 'click' this.removeCard}}
        >Remove Card</Button>
      {{else}}
        <Button
          data-test-choose-card-btn
          @kind='secondary-dark'
          @disabled={{this.doChooseCard.isRunning}}
          {{on 'click' this.chooseCard}}
        >Choose Card</Button>

        <label for='share-checkbox'>Allow access to the cards you can see at the
          top of your stacks</label>
        <Input
          id={{(concat 'helper-text-' this.helperId)}}
          data-test-share-context
          @type='checkbox'
          @checked={{this.shareCurrentContext}}
        />
      {{/if}}
      <Button
        data-test-send-message-btn
        @disabled={{and (not this.messageToSend) (not this.cardtoSend)}}
        @loading={{this.doSendMessage.isRunning}}
        @kind='primary'
        {{on 'click' this.sendMessage}}
      >Send</Button>
    </div>
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
    {{/if}}
    <style>
      .send-message {
        display: flex;
        justify-content: right;
        flex-wrap: wrap;
        row-gap: var(--boxel-sp-sm);
        margin: 0 var(--boxel-sp);
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
  @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @tracked private subscribedRoom: FieldDef | undefined;

  private shareCurrentContext = false;
  private messagesToSend: TrackedMap<string, string | undefined> =
    new TrackedMap();
  private cardsToSend: TrackedMap<string, CardDef | undefined> =
    new TrackedMap();
  private roomResource = getRoom(this, () => this.args.roomId);
  private api: typeof CardAPI | undefined;

  constructor(owner: Owner, args: RoomArgs['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  private get room() {
    return this.roomResource.room;
  }

  @cached
  private get attachedCardIds() {
    if (!this.room) {
      return [];
    }
    return this.room.messages
      .filter((m) => m.attachedCardId)
      .map((m) => m.attachedCardId);
  }

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

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.roomResource.loading;
    this.allowedToSetObjective = await this.matrixService.allowedToSetObjective(
      this.args.roomId,
    );
  });

  private doChooseCard = restartableTask(async () => {
    let chosenCard: CardDef | undefined = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (chosenCard) {
      this.cardsToSend.set(this.args.roomId, chosenCard);
    }
  });
}
