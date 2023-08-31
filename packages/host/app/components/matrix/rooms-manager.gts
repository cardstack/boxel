import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
//@ts-expect-error the types don't recognize the cached export
import { tracked, cached } from '@glimmer/tracking';
import { not, eq } from '@cardstack/host/helpers/truth-helpers';
import { restartableTask, timeout } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelInput,
  LoadingIndicator,
  BoxelInputValidationState,
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui';
import { isMatrixError } from '@cardstack/host/lib/matrix-utils';
import { eventDebounceMs } from '@cardstack/host/lib/matrix-utils';
import { getRoom, RoomResource } from '@cardstack/host/resources/room';
import { aiBotUsername } from '@cardstack/runtime-common';
import format from 'date-fns/format';
import { TrackedMap } from 'tracked-built-ins';
import RouterService from '@ember/routing/router-service';
import Room from './room';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type {
  RoomField,
  RoomMemberField,
} from 'https://cardstack.com/base/room';

export default class RoomsManager extends Component {
  <template>
    <div class='header-wrapper'>
      {{#unless this.isCreateRoomMode}}
        <div class='create-button-wrapper'>
          <Button
            data-test-create-room-mode-btn
            class='room__button'
            {{on 'click' this.showCreateRoomMode}}
            @disabled={{this.isCreateRoomMode}}
          >Create Room</Button>
        </div>
        <div class='create-button-wrapper'>
          <Button
            data-test-create-ai-chat-btn
            class='room__button'
            {{on 'click' this.createAIChat}}
          >Start new AI chat</Button>
        </div>
      {{/unless}}
      <BoxelHeader
        class='matrix'
        @title={{this.headerTitle}}
        @hasBackground={{true}}
      />
    </div>
    {{#if this.isCreateRoomMode}}
      {{#if this.doCreateRoom.isRunning}}
        <LoadingIndicator />
      {{else}}
        <div class='create-room'>
          <FieldContainer
            @label='Room Name:'
            @tag='label'
            class='create-room__field'
          >
            <BoxelInputValidationState
              data-test-room-name-field
              @id=''
              @state={{this.roomNameInputState}}
              @value={{this.cleanNewRoomName}}
              @errorMessage={{this.roomNameError}}
              @onInput={{this.setNewRoomName}}
            />
          </FieldContainer>
          <FieldContainer
            @label='Invite:'
            @tag='label'
            class='create-room__field'
          >
            <BoxelInput
              data-test-room-invite-field
              type='text'
              @value={{this.newRoomInviteFormatted}}
              @onInput={{this.setNewRoomInvite}}
            />
          </FieldContainer>
        </div>
        <div class='create-button-wrapper'>
          <Button
            data-test-create-room-cancel-btn
            class='room__button'
            {{on 'click' this.cancelCreateRoom}}
          >Cancel</Button>
          <Button
            data-test-create-room-btn
            class='room__button'
            @kind='primary'
            @disabled={{not this.newRoomName}}
            {{on 'click' this.createRoom}}
          >Create</Button>
        </div>
      {{/if}}
    {{/if}}
    {{#if this.loadRooms.isRunning}}
      <LoadingIndicator />
    {{else}}

      {{#if this.currentRoomId}}
        <Room @roomId={{this.currentRoomId}} />
      {{/if}}

      <hr />
      {{#if this.hasInvites}}
        <div class='room-list' data-test-invites-list>
          <h3>Invites</h3>
          {{#each this.sortedInvites as |invite|}}
            <div class='room' data-test-invited-room={{invite.room.name}}>
              <span class='room-item'>
                {{invite.room.name}}
                (from:
                <span
                  data-test-invite-sender={{niceName
                    invite.member.membershipInitiator
                  }}
                >{{niceName invite.member.membershipInitiator}})</span>
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
          {{/each}}
        </div>
      {{/if}}
      <div class='room-list' data-test-rooms-list>
        <h3>Existing chats</h3>
        {{#each this.sortedJoinedRooms as |joined|}}
          <div class='room' data-test-joined-room={{joined.room.name}}>
            <span class='room-item'>
              <button
                class='enter-room link'
                data-test-enter-room={{joined.room.name}}
                {{on 'click' (fn this.enterRoom joined.room.roomId)}}
              >
                {{joined.room.name}}
              </button>
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
        display: flex;
        margin-top: var(--boxel-sp-sm);
        flex-wrap: nowrap;
      }

      .room-item {
        display: inline-block;
        flex-grow: 1;
      }

      .room-item .enter-room {
        background: none;
        padding: 0;
        margin: 0;
        border: none;
      }

      .room button {
        margin-left: var(--boxel-sp-xs);
      }

      .header-wrapper {
        position: relative;
      }

      .create-room {
        padding: 0 var(--boxel-sp);
      }

      .create-button-wrapper {
        display: flex;
        justify-content: flex-end;
        padding: var(--boxel-sp) var(--boxel-sp) 0;
      }

      .create-button-wrapper button {
        margin-left: var(--boxel-sp-xs);
      }

      .create-room__field {
        margin-top: var(--boxel-sp-sm);
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
  @tracked private currentRoomId: string | undefined;
  private currentRoomResource = getRoom(this, () => this.currentRoomId);

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.loadRooms.perform();
  }

  @cached
  private get roomResources() {
    let resources = new TrackedMap<string, RoomResource>();
    for (let roomId of this.matrixService.rooms.keys()) {
      resources.set(
        roomId,
        getRoom(this, () => roomId),
      );
    }
    return resources;
  }

  @cached
  private get myRooms() {
    let rooms: {
      invited: { room: RoomField; member: RoomMemberField }[];
      joined: { room: RoomField; member: RoomMemberField }[];
    } = {
      invited: [],
      joined: [],
    };
    for (let resource of this.roomResources.values()) {
      if (!resource.room) {
        continue;
      }
      let joinedMember = resource.room.joinedMembers.find(
        (m) => this.matrixService.userId === m.userId,
      );
      if (joinedMember) {
        rooms.joined.push({ room: resource.room, member: joinedMember });
        continue;
      }
      let invitedMember = resource.room.invitedMembers.find(
        (m) => this.matrixService.userId === m.userId,
      );
      if (invitedMember) {
        rooms.invited.push({ room: resource.room, member: invitedMember });
      }
    }
    return rooms;
  }

  @cached
  private get sortedJoinedRooms() {
    return this.myRooms.joined.sort(
      (a, b) =>
        a.member.membershipDateTime.getTime() -
        b.member.membershipDateTime.getTime(),
    );
  }

  @cached
  private get sortedInvites() {
    return this.myRooms.invited.sort(
      (a, b) =>
        a.member.membershipDateTime.getTime() -
        b.member.membershipDateTime.getTime(),
    );
  }

  private get newRoomInviteFormatted() {
    return this.newRoomInvite.join(', ');
  }

  private get headerTitle() {
    return `${this.currentRoom ? this.currentRoom.name : 'Rooms'}`;
  }

  private get currentRoom() {
    return this.currentRoomResource.room;
  }

  private get hasInvites() {
    return this.myRooms.invited.length > 0;
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

  @action
  private enterRoom(roomId: string) {
    this.currentRoomId = roomId;
  }

  @action
  private createAIChat() {
    this.newRoomName = `${format(
      new Date(),
      "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
    )} - ${this.matrixService.userId}`;
    this.newRoomInvite = [aiBotUsername];
    this.doCreateRoom.perform();
  }

  private doCreateRoom = restartableTask(async () => {
    if (!this.newRoomName) {
      throw new Error(
        `bug: should never get here, create button is disabled when there is no new room name`,
      );
    }
    try {
      let newRoomId = await this.matrixService.createRoom(
        this.newRoomName,
        this.newRoomInvite,
      );
      this.enterRoom(newRoomId);
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
    this.isCreateRoomMode = false;
  }
}

function niceName(userId: string): string {
  return userId.split(':')[0].substring(1);
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface RoomsManager {
    'Matrix::RoomsManager': typeof RoomsManager;
  }
}
