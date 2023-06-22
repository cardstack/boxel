import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
//@ts-expect-error the types don't recognize the cached export
import { tracked, cached } from '@glimmer/tracking';
import { not, eq } from '../helpers/truth-helpers';
import { restartableTask, timeout } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelInput,
  LoadingIndicator,
  BoxelInputValidationState,
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui';
import { isMatrixError } from '../lib/matrix-utils';
import { LinkTo } from '@ember/routing';
import { eventDebounceMs } from '../lib/matrix-utils';
import { getRoomCard, RoomCardResource } from '../resources/room-card';
import { TrackedMap } from 'tracked-built-ins';
import RouterService from '@ember/routing/router-service';
import type MatrixService from '../services/matrix-service';
import type { RoomCard, RoomMemberCard } from 'https://cardstack.com/base/room';

const TRUE = true;

export default class RoomsManager extends Component {
  <template>
    <BoxelHeader class='matrix' @title='Rooms' @hasBackground={{TRUE}}>
      <:actions>
        <Button
          data-test-create-room-mode-btn
          {{on 'click' this.showCreateRoomMode}}
          @disabled={{this.isCreateRoomMode}}
        >Create Room</Button>
      </:actions>
    </BoxelHeader>
    {{#if this.isCreateRoomMode}}
      {{#if this.doCreateRoom.isRunning}}
        <LoadingIndicator />
      {{else}}
        <fieldset>
          <FieldContainer @label='Room Name:' @tag='label'>
            <BoxelInputValidationState
              data-test-room-name-field
              @id=''
              @state={{this.roomNameInputState}}
              @value={{this.cleanNewRoomName}}
              @errorMessage={{this.roomNameError}}
              @onInput={{this.setNewRoomName}}
            />
          </FieldContainer>
          <FieldContainer @label='Invite:' @tag='label'>
            <BoxelInput
              data-test-room-invite-field
              type='text'
              @value={{this.newRoomInviteFormatted}}
              @onInput={{this.setNewRoomInvite}}
            />
          </FieldContainer>
          <Button
            data-test-create-room-cancel-btn
            {{on 'click' this.cancelCreateRoom}}
          >Cancel</Button>
          <Button
            data-test-create-room-btn
            @kind='primary'
            @disabled={{not this.newRoomName}}
            {{on 'click' this.createRoom}}
          >Create</Button>
        </fieldset>
      {{/if}}
    {{/if}}
    {{#if this.loadRooms.isRunning}}
      <LoadingIndicator />
    {{else}}
      <div class='room-list' data-test-invites-list>
        <h3>Invites</h3>
        {{#each this.sortedInvites as |invite|}}
          <div
            class='room'
            data-test-invited-room={{invite.room.name}}
          >
            <span class='room-item'>
              {{invite.room.name}}
              (from:
              <span
                data-test-invite-sender={{invite.member.membershipInitiator.displayName}}
              >{{invite.member.membershipInitiator.displayName}})</span>
            </span>
            <Button
              data-test-decline-room-btn={{invite.room.name}}
              {{on 'click' (fn this.leaveRoom invite.room.roomId)}}
            >Decline</Button>
            <Button
              data-test-join-room-btn={{invite.room.name}}
              {{on 'click' (fn this.joinRoom invite.room.roomId)}}
            >Join</Button>
            {{#if (eq invite.room.roomId this.roomIdForCurrentAction)}}
              <LoadingIndicator />
            {{/if}}
          </div>
        {{else}}
          (No invites)
        {{/each}}
      </div>
      <div class='room-list' data-test-rooms-list>
        <h3>Rooms</h3>
        {{#each this.sortedJoinedRooms as |joined|}}
          <div
            class='room'
            data-test-joined-room={{joined.room.name}}
          >
            <span class='room-item'>
              <LinkTo
                class='link'
                data-test-enter-room={{joined.room.name}}
                @route='chat.room'
                @model={{joined.room.roomId}}
              >
                {{joined.room.name}}
              </LinkTo>
            </span>
            <Button
              data-test-leave-room-btn={{joined.room.name}}
              {{on 'click' (fn this.leaveRoom joined.room.roomId)}}
            >Leave</Button>
            {{#if (eq joined.room.roomId this.roomIdForCurrentAction)}}
              <LoadingIndicator />
            {{/if}}
          </div>
        {{else}}
          (No rooms)
        {{/each}}
      </div>
    {{/if}}
    <style>
      .room-list {
        padding: 0 var(--boxel-sp);
        margin: var(--boxel-sp) 0;
      }

      .room {
        margin-top: var(--boxel-sp-sm);
      }

      .room-item {
        display: inline-block;
        min-width: 30rem;
      }

      .room button {
        margin-left: var(--boxel-sp-xs);
      }
      .checkbox-field {
        font-weight: bold;
        display: block;
        margin-bottom: var(--boxel-sp);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @service private declare router: RouterService;
  @tracked private isCreateRoomMode = false;
  @tracked private newRoomName: string | undefined;
  @tracked private newRoomInvite: string[] = [];
  @tracked private roomNameError: string | undefined;
  @tracked private roomIdForCurrentAction: string | undefined;

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.loadRooms.perform();
  }

  @cached
  private get roomResources() {
    let resources = new TrackedMap<string, RoomCardResource>();
    for (let roomId of this.matrixService.roomCards.keys()) {
      resources.set(
        roomId,
        getRoomCard(this, () => roomId)
      );
    }
    return resources;
  }

  @cached
  private get myRooms() {
    let rooms: {
      invited: { room: RoomCard; member: RoomMemberCard }[];
      joined: { room: RoomCard; member: RoomMemberCard }[];
    } = {
      invited: [],
      joined: [],
    };
    for (let resource of this.roomResources.values()) {
      if (!resource.roomCard) {
        continue;
      }
      let joinedMember = resource.roomCard.joinedMembers.find(
        (m) => this.matrixService.client.getUserId() === m.userId
      );
      if (joinedMember) {
        rooms.joined.push({ room: resource.roomCard, member: joinedMember });
        continue;
      }
      let invitedMember = resource.roomCard.invitedMembers.find(
        (m) => this.matrixService.client.getUserId() === m.userId
      );
      if (invitedMember) {
        rooms.invited.push({ room: resource.roomCard, member: invitedMember });
      }
    }
    return rooms;
  }

  @cached
  private get sortedJoinedRooms() {
    return this.myRooms.joined.sort(
      (a, b) =>
        a.member.membershipDateTime.getTime() -
        b.member.membershipDateTime.getTime()
    );
  }

  @cached
  private get sortedInvites() {
    return this.myRooms.invited.sort(
      (a, b) =>
        a.member.membershipDateTime.getTime() -
        b.member.membershipDateTime.getTime()
    );
  }

  private get newRoomInviteFormatted() {
    return this.newRoomInvite.join(', ');
  }

  private get cleanNewRoomName() {
    return this.newRoomName ?? '';
  }

  private get roomNameInputState() {
    return this.roomNameError ? 'invalid' : 'initial';
  }

  @action
  private showCreateRoomMode() {
    this.isCreateRoomMode = true;
  }

  @action
  private setNewRoomName(name: string) {
    this.newRoomName = name;
    this.roomNameError = undefined;
  }

  @action
  private setNewRoomInvite(invite: string) {
    this.newRoomInvite = invite.split(',').map((i) => i.trim());
  }

  @action
  private createRoom() {
    this.doCreateRoom.perform();
  }

  @action
  private cancelCreateRoom() {
    this.resetCreateRoom();
  }

  @action
  private leaveRoom(roomId: string) {
    this.doLeaveRoom.perform(roomId);
  }

  @action
  private joinRoom(roomId: string) {
    this.doJoinRoom.perform(roomId);
  }

  private doCreateRoom = restartableTask(async () => {
    if (!this.newRoomName) {
      throw new Error(
        `bug: should never get here, create button is disabled when there is no new room name`
      );
    }
    try {
      await this.matrixService.createRoom(this.newRoomName, this.newRoomInvite);
    } catch (e) {
      if (isMatrixError(e) && e.data.errcode === 'M_ROOM_IN_USE') {
        this.roomNameError = 'Room already exists';
        return;
      }
      throw e;
    }
    this.resetCreateRoom();
  });

  private doLeaveRoom = restartableTask(async (roomId: string) => {
    this.roomIdForCurrentAction = roomId;
    await this.matrixService.client.leave(roomId);
    await timeout(eventDebounceMs); // this makes it feel a bit more responsive
    this.roomIdForCurrentAction = undefined;
    if (
      this.router.currentRoute.name === 'chat.room' &&
      this.router.currentRoute.params.id === roomId
    ) {
      this.router.transitionTo('chat');
    }
  });

  private doJoinRoom = restartableTask(async (roomId: string) => {
    this.roomIdForCurrentAction = roomId;
    await this.matrixService.client.joinRoom(roomId);
    await timeout(eventDebounceMs); // this makes it feel a bit more responsive
    this.roomIdForCurrentAction = undefined;
  });

  private loadRooms = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await Promise.all([...this.roomResources.values()].map((r) => r.loading));
  });

  private resetCreateRoom() {
    this.newRoomName = undefined;
    this.newRoomInvite = [];
    this.isCreateRoomMode = false;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface RoomsManager {
    RoomsManager: typeof RoomsManager;
  }
}
