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
import RouterService from '@ember/routing/router-service';
import type MatrixService from '../services/matrix-service';

const TRUE = true;

export default class RoomsManager extends Component {
  <template>
    <BoxelHeader @title='Rooms' @hasBackground={{TRUE}}>
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
    {{#if this.loadJoinedRooms.isRunning}}
      <LoadingIndicator />
    {{else}}
      <div class='room-manager__room-list' data-test-invites-list>
        <h3>Invites</h3>
        {{#each this.sortedInvites as |invite|}}
          <div
            class='room-manager__room'
            data-test-invited-room={{invite.name}}
          >
            <span class='room-manager__room__item'>
              {{invite.name}}
              (from:
              <span
                data-test-invite-sender={{invite.sender}}
              >{{invite.sender}})</span>
            </span>
            <Button
              data-test-decline-room-btn={{invite.name}}
              {{on 'click' (fn this.leaveRoom invite.roomId)}}
            >Decline</Button>
            <Button
              data-test-join-room-btn={{invite.name}}
              {{on 'click' (fn this.joinRoom invite.roomId)}}
            >Join</Button>
            {{#if (eq invite.roomId this.roomIdForCurrentAction)}}
              <LoadingIndicator />
            {{/if}}
          </div>
        {{else}}
          (No invites)
        {{/each}}
      </div>
      <div class='room-manager__room-list' data-test-rooms-list>
        <h3>Rooms</h3>
        {{#each this.sortedJoinedRooms as |room|}}
          <div class='room-manager__room' data-test-joined-room={{room.name}}>
            <span class='room-manager__room__item'>
              <LinkTo
                class='link'
                data-test-enter-room={{room.name}}
                @route='chat.room'
                @model={{room.roomId}}
              >
                {{room.name}}
              </LinkTo>
            </span>
            <Button
              data-test-leave-room-btn={{room.name}}
              {{on 'click' (fn this.leaveRoom room.roomId)}}
            >Leave</Button>
            {{#if (eq room.roomId this.roomIdForCurrentAction)}}
              <LoadingIndicator />
            {{/if}}
          </div>
        {{else}}
          (No rooms)
        {{/each}}
      </div>
    {{/if}}
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
    this.loadJoinedRooms.perform();
  }

  @cached
  private get sortedJoinedRooms() {
    return [...this.matrixService.joinedRooms.values()].sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }

  @cached
  private get sortedInvites() {
    return [...this.matrixService.invites.values()].sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }

  get newRoomInviteFormatted() {
    return this.newRoomInvite.join(', ');
  }

  get cleanNewRoomName() {
    return this.newRoomName ?? '';
  }

  get roomNameInputState() {
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

  private loadJoinedRooms = restartableTask(async () => {
    await this.matrixService.flushMembership;
    let { joined_rooms: joinedRooms } =
      await this.matrixService.client.getJoinedRooms();
    const joinedRoomsTimeout = Date.now() + 1000 * 30;
    for (;;) {
      if (this.sortedJoinedRooms.length === joinedRooms.length) {
        return;
      }
      if (Date.now() > joinedRoomsTimeout) {
        throw new Error(`timed-out waiting for joined rooms`);
      }
      await timeout(50);
    }
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
