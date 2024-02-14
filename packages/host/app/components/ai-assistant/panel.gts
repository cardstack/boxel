import { fn, hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
//@ts-expect-error the types don't recognize the cached export
import { tracked, cached } from '@glimmer/tracking';

import format from 'date-fns/format';
import { restartableTask, timeout } from 'ember-concurrency';
import { Velcro } from 'ember-velcro';
import { TrackedMap } from 'tracked-built-ins';

import {
  Button,
  IconButton,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { ResizeHandle } from '@cardstack/boxel-ui/components';
import { DropdownArrowFilled, IconX } from '@cardstack/boxel-ui/icons';

import { aiBotUsername } from '@cardstack/runtime-common';

import AiAssistantPastSessionsList from '@cardstack/host/components/ai-assistant/past-sessions';
import RenameSession from '@cardstack/host/components/ai-assistant/rename-session';
import Room from '@cardstack/host/components/matrix/room';
import DeleteModal from '@cardstack/host/components/operator-mode/delete-modal';

import ENV from '@cardstack/host/config/environment';
import {
  isMatrixError,
  eventDebounceMs,
} from '@cardstack/host/lib/matrix-utils';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { RoomField } from 'https://cardstack.com/base/room';

import { getRoom, RoomResource } from '../../resources/room';

import assistantIcon from './ai-assist-icon.webp';

const { matrixServerName } = ENV;
export const aiBotUserId = `@${aiBotUsername}:${matrixServerName}`;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onClose: () => void;
    resizeHandle: ResizeHandle;
  };
}

let currentRoomIdPersistenceKey = 'aiPanelCurrentRoomId'; // Local storage key

export default class AiAssistantPanel extends Component<Signature> {
  <template>
    <Velcro @placement='bottom' @offsetOptions={{-50}} as |popoverVelcro|>
      <div
        class='ai-assistant-panel'
        data-test-ai-assistant-panel
        ...attributes
      >
        <@resizeHandle />
        <header class='panel-header'>
          <img alt='AI Assistant' src={{assistantIcon}} />
          <span>Assistant</span>
          <IconButton
            class='close-ai-panel'
            @variant='primary'
            @icon={{IconX}}
            @width='20px'
            @height='20px'
            {{on 'click' @onClose}}
            aria-label='Remove'
            data-test-close-ai-assistant
          />
        </header>
        <div class='menu'>
          <div class='buttons'>
            <Button
              class='new-session-button'
              @kind='secondary-dark'
              @size='small'
              {{on 'click' this.createNewSession}}
              {{popoverVelcro.hook}}
              data-test-create-room-btn
            >
              New Session
            </Button>

            {{#if this.loadRoomsTask.isRunning}}
              <LoadingIndicator @color='var(--boxel-light)' />
            {{else}}
              <Button
                class='past-sessions-button'
                @kind='secondary-dark'
                @size='small'
                {{on 'click' this.displayPastSessions}}
                {{popoverVelcro.hook}}
                data-test-past-sessions-button
              >
                Past Sessions
                <DropdownArrowFilled width='10' height='10' />
              </Button>
            {{/if}}
          </div>

          {{#if this.isShowingPastSessions}}
            <AiAssistantPastSessionsList
              @sessions={{this.aiSessionRooms}}
              @roomActions={{this.roomActions}}
              @onClose={{this.hidePastSessions}}
              {{popoverVelcro.loop}}
            />
          {{else if this.roomToRename}}
            <RenameSession
              @room={{this.roomToRename}}
              @onClose={{fn this.setRoomToRename undefined}}
              {{popoverVelcro.loop}}
            />
          {{/if}}
        </div>

        {{#if this.doCreateRoom.isRunning}}
          <LoadingIndicator
            class='loading-new-session'
            @color='var(--boxel-light)'
          />
        {{else if this.currentRoomId}}
          <Room @roomId={{this.currentRoomId}} />
        {{/if}}
      </div>
    </Velcro>

    {{#if this.roomToDelete}}
      {{#let this.roomToDelete.roomId this.roomToDelete.name as |id name|}}
        <DeleteModal
          @itemToDelete={{id}}
          @onConfirm={{fn this.leaveRoom id}}
          @onCancel={{fn this.setRoomToDelete undefined}}
          @itemInfo={{hash type='room' name=(if name name id) id=id}}
          @error={{this.roomDeleteError}}
        />
      {{/let}}
    {{/if}}

    <style>
      .ai-assistant-panel {
        display: grid;
        grid-template-rows: auto auto 1fr;
        background-color: var(--boxel-ai-purple);
        border: none;
        color: var(--boxel-light);
        height: 100%;
        position: relative;
      }
      :deep(.arrow) {
        display: none;
      }
      :deep(.separator-horizontal) {
        min-width: calc(
          var(--boxel-panel-resize-handler-width) +
            calc(var(--boxel-sp-xxxs) * 2)
        );
        position: absolute;
        left: 0;
        height: 100%;
      }
      :deep(.separator-horizontal:not(:hover) > button) {
        display: none;
      }
      :deep(.room-info) {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
      }
      :deep(.ai-assistant-conversation) {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
      }
      :deep(.room-actions) {
        z-index: 1;
      }
      .panel-header {
        align-items: center;
        display: flex;
        padding: var(--boxel-sp-xs) calc(var(--boxel-sp) / 2) var(--boxel-sp-xs)
          var(--boxel-sp-lg);
        gap: var(--boxel-sp-xs);
      }
      .panel-header img {
        height: 20px;
        width: 20px;
      }
      .panel-header span {
        font: 700 var(--boxel-font);
      }
      .close-ai-panel {
        --icon-color: var(--boxel-highlight);
        margin-left: auto;
      }
      .menu {
        padding: var(--boxel-sp-xs) var(--boxel-sp-lg);
        position: relative;
      }
      .buttons {
        align-items: center;
        display: flex;
      }
      .new-session-button {
        margin-right: var(--boxel-sp-xxxs);
      }
      .past-sessions-button svg {
        --icon-color: var(--boxel-light);
        margin-left: var(--boxel-sp-xs);
      }
      .loading-new-session {
        padding: var(--boxel-sp);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare router: RouterService;

  @tracked private currentRoomId: string | undefined;
  @tracked private isShowingPastSessions = false;
  @tracked private roomToRename: RoomField | undefined = undefined;
  @tracked private roomToDelete: RoomField | undefined = undefined;
  @tracked private roomDeleteError: string | undefined = undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadRoomsTask.perform();
  }

  private enterRoomInitially() {
    if (this.currentRoomId) {
      return;
    }

    let persistedRoomId = window.localStorage.getItem(
      currentRoomIdPersistenceKey,
    );
    if (persistedRoomId && this.roomResources.has(persistedRoomId)) {
      this.currentRoomId = persistedRoomId;
    } else {
      let latestRoom = this.aiSessionRooms[0];
      if (latestRoom) {
        this.currentRoomId = latestRoom.roomId;
      } else {
        this.createNewSession();
      }
    }
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

  private loadRoomsTask = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await Promise.all([...this.roomResources.values()].map((r) => r.loading));
    this.enterRoomInitially();
  });

  @action
  private createNewSession() {
    let newRoomName = `${format(
      new Date(),
      "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
    )} - ${this.matrixService.userId}`;
    this.doCreateRoom.perform(newRoomName, [aiBotUsername]);
  }

  private doCreateRoom = restartableTask(
    async (name: string, invites: string[], topic?: string) => {
      let newRoomId = await this.matrixService.createRoom(name, invites, topic);
      this.enterRoom(newRoomId);
    },
  );

  @action
  private displayPastSessions() {
    this.isShowingPastSessions = true;
  }

  @action
  private hidePastSessions() {
    this.isShowingPastSessions = false;
  }

  @cached
  private get aiSessionRooms() {
    let rooms: RoomField[] = [];
    for (let resource of this.roomResources.values()) {
      if (!resource.room) {
        continue;
      }
      let { room } = resource;
      if (
        room.invitedMembers.find((m) => aiBotUserId === m.userId) &&
        room.joinedMembers.find((m) => this.matrixService.userId === m.userId)
      ) {
        rooms.push(room);
      }
    }
    // member join date is at the time of room creation
    // reverse chronological order
    return rooms.sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  @action
  private enterRoom(roomId: string) {
    this.currentRoomId = roomId;
    this.hidePastSessions();
    window.localStorage.setItem(currentRoomIdPersistenceKey, roomId);
  }

  @action private setRoomToRename(room: RoomField | undefined) {
    this.roomToRename = room;
    this.hidePastSessions();
  }

  @action private setRoomToDelete(room: RoomField | undefined) {
    this.roomDeleteError = undefined;
    this.roomToDelete = room;
  }

  private get roomActions() {
    return {
      open: this.enterRoom,
      rename: this.setRoomToRename,
      delete: this.setRoomToDelete,
    };
  }

  @action
  private leaveRoom(roomId: string) {
    this.doLeaveRoom.perform(roomId);
  }

  private doLeaveRoom = restartableTask(async (roomId: string) => {
    try {
      await this.matrixService.client.leave(roomId);
      await timeout(eventDebounceMs); // this makes it feel a bit more responsive
      if (this.currentRoomId === roomId) {
        this.currentRoomId = undefined;
      }
      this.roomToDelete = undefined;
      this.hidePastSessions();
    } catch (e) {
      console.error(e);
      this.roomDeleteError = 'Error deleting room';
      if (isMatrixError(e)) {
        this.roomDeleteError += `: ${e.data.error}`;
      } else if (e instanceof Error) {
        this.roomDeleteError += `: ${e.message}`;
      }
    }
  });
}
