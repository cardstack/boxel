import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { not } from '../helpers/truth-helpers';
import { restartableTask } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelInput,
  LoadingIndicator,
  BoxelInputValidationState,
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui';
import { isMatrixError } from '../lib/matrix-utils';
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
            @disabled={{not this.newRoomName}}
            {{on 'click' this.createRoom}}
          >Create</Button>
        </fieldset>
      {{/if}}
    {{/if}}
    <div data-test-invites-list>
      <h3>Invites</h3>
      {{#each this.sortedInvites as |invite|}}
        <div data-test-invited-room={{invite.name}}>{{invite.name}}
          (from:
          <span
            data-test-invite-sender={{invite.sender}}
          >{{invite.sender}})</span></div>
      {{/each}}
    </div>
    <div data-test-rooms-list>
      <h3>Rooms</h3>
      {{#each this.sortedJoinedRooms as |room|}}
        <div data-test-joined-room={{room.name}}>{{room.name}}</div>
      {{/each}}
    </div>
  </template>

  @service private declare matrixService: MatrixService;
  @tracked private isCreateRoomMode = false;
  @tracked private newRoomName: string | undefined;
  @tracked private newRoomInvite: string[] = [];
  @tracked private roomNameError: string | undefined;

  private get sortedJoinedRooms() {
    return [...this.matrixService.joinedRooms.values()].sort(
      (a, b) => a.timestamp - b.timestamp
    );
  }

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
