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
  Button,
  FieldContainer,
} from '@cardstack/boxel-ui';
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
            <BoxelInput
              data-test-room-name-field
              type='text'
              @value={{this.newRoomName}}
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
        <div data-test-invited-room={{invite.roomId}}>{{invite.name}}
          (from:
          {{invite.sender}})</div>
      {{/each}}
    </div>
    <div data-test-rooms-list>
      <h3>Rooms</h3>
      {{#each this.sortedJoinedRooms as |room|}}
        <div data-test-joined-room={{room.roomId}}>{{room.name}}</div>
      {{/each}}
    </div>
  </template>

  @service private declare matrixService: MatrixService;
  @tracked private isCreateRoomMode = false;
  @tracked private newRoomName: string | undefined;
  @tracked private newRoomInvite: string[] = [];

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

  @action
  private showCreateRoomMode() {
    this.isCreateRoomMode = true;
  }

  @action
  private setNewRoomName(name: string) {
    this.newRoomName = name;
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
    await this.matrixService.createRoom(this.newRoomName, this.newRoomInvite);
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
