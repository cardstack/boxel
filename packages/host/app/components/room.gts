import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import debounce from 'lodash/debounce';
import { not, or, and } from '../helpers/truth-helpers';
import { ScrollPaginate } from '../modifiers/scrollers';
import { restartableTask, enqueueTask } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelInput,
  LoadingIndicator,
  FieldContainer,
  Button,
} from '@cardstack/boxel-ui';
import { TrackedMap } from 'tracked-built-ins';
import {
  type LooseSingleCardDocument,
  chooseCard,
  baseCardRef,
} from '@cardstack/runtime-common';
import Message from './message';
import { type RoomMember } from 'matrix-js-sdk';
import type MatrixService from '../services/matrix-service';
import { eventDebounceMs } from '../lib/matrix-utils';
import { type Card } from 'https://cardstack.com/base/card-api';
import type CardService from '../services/card-service';

const TRUE = true;

interface RoomArgs {
  Args: {
    roomId: string;
    members: TrackedMap<
      string,
      { member: RoomMember; status: 'join' | 'invite' | 'leave' }
    >;
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

    <div class='room__room-card'>
      {{#if this.roomCard}}
        <this.roomCardComponent />
      {{/if}}
    </div>

    <div
      class='room__messages-wrapper'
      {{ScrollPaginate
        isDisabled=this.isPaginationStopped
        onScrollTop=this.getPrevMessages
      }}
    >
      <div class='room__messages'>
        <div class='room__messages__notices'>
          {{#if
            (or this.doRoomScrollBack.isRunning this.doTimelineFlush.isRunning)
          }}
            <LoadingIndicator />
          {{/if}}
          {{#if this.atBeginningOfTimeline}}
            <div
              data-test-timeline-start
              class='room__messages__timeline-start'
            >
              - Beginning of conversation -
            </div>
          {{/if}}
        </div>
        {{#each this.timelineEvents as |event index|}}
          <Message
            @event={{event}}
            @members={{this.members}}
            @index={{index}}
            @loadCard={{this.loadCard}}
            @register={{this.registerMessage}}
            @resetScroll={{this.resetScroll}}
          />
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
        @value={{this.message}}
        @onInput={{this.setMessage}}
        rows='4'
        cols='20'
      />
      {{#if this.card}}
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
        @disabled={{and (not this.message) (not this.card)}}
        @loading={{this.doSendMessage.isRunning}}
        @kind='primary'
        {{on 'click' this.sendMessage}}
      >Send</Button>
    </div>
    {{#if this.card}}
      <div class='room__selected-card'>
        <div class='room__selected-card__field'>Selected Card:</div>
        <div
          class='room__selected-card__card-wrapper'
          data-test-selected-card={{this.card.id}}
        >
          <this.cardComponent />
        </div>
      </div>
    {{/if}}
  </template>

  @service private declare matrixService: MatrixService;
  @service declare cardService: CardService;
  @tracked private paginationTime: number | undefined;
  @tracked private isInviteMode = false;
  @tracked private membersToInvite: string[] = [];
  private messages: TrackedMap<string, string | undefined> = new TrackedMap();
  private cards: TrackedMap<string, Card | undefined> = new TrackedMap();
  private messageScrollers: Map<string, Map<string, () => void>> = new Map();

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.doTimelineFlush.perform();
  }

  get room() {
    this.paginationTime; // just consume this so that we can invalidate the room after pagination
    let room = this.matrixService.client.getRoom(this.args.roomId);
    if (!room) {
      throw new Error(
        `bug: should never get here--matrix sdk returned a null room for ${this.args.roomId}`
      );
    }
    return room;
  }

  get roomCard() {
    let entry = this.matrixService.roomEventConsumers.get(this.args.roomId);
    if (entry) {
      return entry.card;
    }
    return;
  }

  get roomCardComponent() {
    if (!this.roomCard) {
      return;
    }
    return this.roomCard.constructor.getComponent(this.roomCard, 'isolated');
  }

  get members() {
    return [...this.args.members.values()];
  }

  get memberNames() {
    return this.members
      .map(
        (m) => `${m.member.name}${m.status === 'invite' ? ' (invited)' : ''}`
      )
      .join(', ');
  }

  get roomName() {
    return this.matrixService.rooms.get(this.args.roomId)?.name;
  }

  get atBeginningOfTimeline() {
    return this.room.oldState.paginationToken === null;
  }

  get timelineEvents() {
    let roomTimeline = this.matrixService.timelines.get(this.args.roomId);
    if (!roomTimeline) {
      return [];
    }
    return [...roomTimeline.values()].sort(
      (a, b) => a.origin_server_ts! - b.origin_server_ts!
    );
  }

  get message() {
    return this.messages.get(this.args.roomId);
  }

  get card() {
    return this.cards.get(this.args.roomId);
  }

  get cardComponent() {
    if (this.card) {
      return this.card.constructor.getComponent(this.card, 'embedded');
    }
    return;
  }

  get membersToInviteFormatted() {
    return this.membersToInvite.join(', ');
  }

  @action
  isPaginationStopped() {
    return this.doRoomScrollBack.isRunning || this.atBeginningOfTimeline;
  }

  @action
  private setMessage(message: string) {
    this.messages.set(this.args.roomId, message);
  }

  @action
  private sendMessage() {
    if (this.message == null && !this.card) {
      throw new Error(
        `bug: should never get here, send button is disabled when there is no message nor card`
      );
    }
    this.doSendMessage.perform(this.message, this.card);
  }

  @action
  private getPrevMessages() {
    this.doRoomScrollBack.perform();
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
    this.cards.set(this.args.roomId, undefined);
  }

  @action
  registerMessage(id: string, scrollIntoView: () => void) {
    let room = this.messageScrollers.get(this.args.roomId);
    if (!room) {
      room = new Map();
      this.messageScrollers.set(this.args.roomId, room);
    }
    room.set(id, scrollIntoView);
  }

  // tell the last message to scroll into view
  private resetScroll = debounce(() => {
    let room = this.messageScrollers.get(this.args.roomId);
    if (!room) {
      return;
    }
    let lastEvent = [...this.timelineEvents.values()].pop();
    let scrollTo = room.get(lastEvent?.event_id!);
    if (scrollTo) {
      scrollTo();
    }
  }, eventDebounceMs);

  private doSendMessage = restartableTask(
    async (message: string | undefined, card?: Card) => {
      this.messages.set(this.args.roomId, undefined);
      this.cards.set(this.args.roomId, undefined);
      await this.matrixService.sendMessage(this.args.roomId, message, card);
    }
  );

  private doRoomScrollBack = restartableTask(async () => {
    await this.matrixService.client.scrollback(this.room!);
    this.paginationTime = Date.now();
  });

  private doInvite = restartableTask(async () => {
    await this.matrixService.invite(this.args.roomId, this.membersToInvite);
    this.resetInvite();
  });

  private doTimelineFlush = restartableTask(async () => {
    await this.matrixService.flushTimeline;
  });

  private doChooseCard = restartableTask(async () => {
    let chosenCard: Card | undefined = await chooseCard({
      filter: { type: baseCardRef },
    });
    if (chosenCard) {
      this.cards.set(this.args.roomId, chosenCard);
    }
  });

  // we are working around the loader bug that deadlocks when loading cyclic dependencies
  // concurrently. When loading cards we use the enqueue task to load one card at a time
  // in the room. When this bug is fixed we should move this method into the Message component
  // so cards can load concurrently.
  // TODO this bug has been solved so we can clean this up now
  private loadCard = enqueueTask(
    async (doc: LooseSingleCardDocument, onComplete: (card: Card) => void) => {
      let id = doc.data.id;
      if (!id) {
        throw new Error(`Cannot render unsaved card`);
      }
      let card = await this.cardService.createFromSerialized(
        doc.data,
        doc,
        new URL(id)
      );
      onComplete(card);
    }
  );

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
