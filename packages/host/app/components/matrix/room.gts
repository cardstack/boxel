import { Input } from '@ember/component';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

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
        <div class='chat-input-area'>
          <AiAssistantChatInput
            @value={{this.messageToSend}}
            @onInput={{this.setMessage}}
            @onSend={{this.sendMessage}}
            @sendDisabled={{this.isSendButtonDisabled}}
            data-test-message-field={{this.room.name}}
          />
          <AiAssistantCardPicker
            @cardsToAttach={{this.cardsToAttach}}
            @chooseCard={{this.chooseCard}}
            @removeCard={{this.removeCard}}
          />
        </div>
        <small>
          <label>
            <Input
              @type='checkbox'
              @checked={{this.shareCurrentContext}}
              data-test-share-context
            />
            Allow access to the cards you can see at the top of your stacks
          </label>
        </small>
        <small>Assistant may display inacurrate info, please double check its
          responses.</small>
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
      small {
        display: block;
        color: var(--boxel-450);
        font: var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-xs);
      }
    </style>
  </template>

  @service private declare cardService: CardService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  private roomResource = getRoom(this, () => this.args.roomId);
  private shareCurrentContext = false;
  private messagesToSend: TrackedMap<string, string | undefined> =
    new TrackedMap();
  private cardsToSend: TrackedMap<string, CardDef[] | undefined> =
    new TrackedMap();

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
    this.doSendMessage.perform(this.messageToSend, this.cardsToAttach);
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
    let cards = this.cardsToAttach?.filter((c) => c.id !== card.id);
    this.cardsToSend.set(this.args.roomId, cards?.length ? cards : undefined);
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

  private get isSendButtonDisabled() {
    return (
      (!this.messageToSend && !this.cardsToAttach) ||
      this.doSendMessage.isRunning
    );
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    'Matrix::Room': typeof Room;
  }
}
