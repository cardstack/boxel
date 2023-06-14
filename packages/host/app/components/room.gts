import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
//@ts-expect-error the types don't recognize the cached export
import { tracked, cached } from '@glimmer/tracking';
import { not, and } from '../helpers/truth-helpers';
import { restartableTask } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelInput,
  LoadingIndicator,
  FieldContainer,
  Button,
} from '@cardstack/boxel-ui';
import { TrackedMap } from 'tracked-built-ins';
import { chooseCard, baseCardRef } from '@cardstack/runtime-common';
import type MatrixService from '../services/matrix-service';
import { type Card } from 'https://cardstack.com/base/card-api';
import type CardService from '../services/card-service';

const TRUE = true;

interface RoomArgs {
  Args: {
    roomId: string;
  };
}
export default class Room extends Component<RoomArgs> {
  <template>
    <BoxelHeader
      @title={{this.roomName}}
      @hasBackground={{TRUE}}
      class='room__header'
    >
      <:actions>
        <Button
          data-test-invite-mode-btn
          class='room__header__invite-btn'
          {{on 'click' this.showInviteMode}}
          @disabled={{this.isInviteMode}}
        >Invite</Button>
        <div data-test-room-members class='room__members'><b>Members:</b>
          {{this.memberNames}}</div>
      </:actions>
    </BoxelHeader>
    {{#if this.isInviteMode}}
      {{#if this.doInvite.isRunning}}
        <LoadingIndicator />
      {{/if}}
      <fieldset>
        <FieldContainer @label='Invite:' @tag='label'>
          <BoxelInput
            data-test-room-invite-field
            type='text'
            @value={{this.membersToInviteFormatted}}
            @onInput={{this.setMembersToInvite}}
          />
        </FieldContainer>
        <Button
          data-test-room-invite-cancel-btn
          {{on 'click' this.cancelInvite}}
        >Cancel</Button>
        <Button
          data-test-room-invite-btn
          @kind='primary'
          @disabled={{not this.membersToInvite}}
          {{on 'click' this.invite}}
        >Invite</Button>
      </fieldset>
    {{/if}}

    <div class='room__messages-wrapper'>
      <div class='room__messages'>
        <div class='room__messages__notices'>
          <div data-test-timeline-start class='room__messages__timeline-start'>
            - Beginning of conversation -
          </div>
        </div>
        {{#each this.messageCardComponents as |Message|}}
          <Message />
        {{else}}
          <div data-test-no-messages>
            (No messages)
          </div>
        {{/each}}
      </div>
    </div>

    <div class='room__send-message'>
      <BoxelInput
        data-test-message-field
        type='text'
        @multiline={{TRUE}}
        @value={{this.messageToSend}}
        @onInput={{this.setMessage}}
        rows='4'
        cols='20'
      />
      {{#if this.cardtoSend}}
        <Button data-test-remove-card-btn {{on 'click' this.removeCard}}>Remove
          Card</Button>
      {{else}}
        <Button
          data-test-choose-card-btn
          @disabled={{this.doChooseCard.isRunning}}
          {{on 'click' this.chooseCard}}
        >Choose Card</Button>
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
      <div class='room__selected-card'>
        <div class='room__selected-card__field'>Selected Card:</div>
        <div
          class='room__selected-card__card-wrapper'
          data-test-selected-card={{this.cardtoSend.id}}
        >
          <this.cardToSendComponent />
        </div>
      </div>
    {{/if}}
  </template>

  @service private declare matrixService: MatrixService;
  @service declare cardService: CardService;
  @tracked private isInviteMode = false;
  @tracked private membersToInvite: string[] = [];
  private messagesToSend: TrackedMap<string, string | undefined> =
    new TrackedMap();
  private cardsToSend: TrackedMap<string, Card | undefined> = new TrackedMap();

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
  }

  get roomCard() {
    let roomCard = this.matrixService.roomEventConsumers.get(this.args.roomId);
    if (!roomCard) {
      throw new Error(`bug: no room card exists for room ${this.args.roomId}`);
    }
    return roomCard;
  }

  get messageCardComponents() {
    return this.roomCard.messages.map((messageCard) =>
      messageCard.constructor.getComponent(messageCard, 'embedded')
    );
  }

  @cached
  get memberNames() {
    return [
      ...this.roomCard.joinedMembers.map((m) => m.displayName),
      ...this.roomCard.invitedMembers.map((m) => `${m.displayName} (invited)`),
    ].join(', ');
  }

  get roomName() {
    return this.matrixService.rooms.get(this.args.roomId)?.name;
  }

  get messageToSend() {
    return this.messagesToSend.get(this.args.roomId);
  }

  get cardtoSend() {
    return this.cardsToSend.get(this.args.roomId);
  }

  get cardToSendComponent() {
    if (this.cardtoSend) {
      return this.cardtoSend.constructor.getComponent(
        this.cardtoSend,
        'embedded'
      );
    }
    return;
  }

  get membersToInviteFormatted() {
    return this.membersToInvite.join(', ');
  }

  @action
  private setMessage(message: string) {
    this.messagesToSend.set(this.args.roomId, message);
  }

  @action
  private sendMessage() {
    if (this.messageToSend == null && !this.cardtoSend) {
      throw new Error(
        `bug: should never get here, send button is disabled when there is no message nor card`
      );
    }
    this.doSendMessage.perform(this.messageToSend, this.cardtoSend);
  }

  @action
  private showInviteMode() {
    this.isInviteMode = true;
  }

  @action
  private setMembersToInvite(invite: string) {
    this.membersToInvite = invite.split(',').map((i) => i.trim());
  }

  @action
  private cancelInvite() {
    this.resetInvite();
  }

  @action
  private invite() {
    this.doInvite.perform();
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
    async (message: string | undefined, card?: Card) => {
      this.messagesToSend.set(this.args.roomId, undefined);
      this.cardsToSend.set(this.args.roomId, undefined);
      await this.matrixService.sendMessage(this.args.roomId, message, card);
    }
  );

  private doInvite = restartableTask(async () => {
    await this.matrixService.invite(this.args.roomId, this.membersToInvite);
    this.resetInvite();
  });

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
  });

  private doChooseCard = restartableTask(async () => {
    let chosenCard: Card | undefined = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (chosenCard) {
      this.cardsToSend.set(this.args.roomId, chosenCard);
    }
  });

  private resetInvite() {
    this.membersToInvite = [];
    this.isInviteMode = false;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    Room: typeof Room;
  }
}
