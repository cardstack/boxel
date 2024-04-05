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
  ResizeHandle,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowFilled, IconX } from '@cardstack/boxel-ui/icons';

import { aiBotUsername } from '@cardstack/runtime-common';

import NewSession from '@cardstack/host/components/ai-assistant/new-session';
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
import type AiService from '@cardstack/host/services/ai-service';
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

// Local storage keys
let currentRoomIdPersistenceKey = 'aiPanelCurrentRoomId';
let newSessionIdPersistenceKey = 'aiPanelNewSessionId';

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
          {{#if this.currentRoom.messages}}
            <div class='panel-title-group'>
              <img
                alt='AI Assistant'
                src={{assistantIcon}}
                width='20'
                height='20'
              />
              <h3 class='panel-title-text' data-test-chat-title>
                {{if this.currentRoom.name this.currentRoom.name 'Assistant'}}
              </h3>
            </div>
          {{/if}}
          <IconButton
            class='close-ai-panel'
            @variant='primary'
            @icon={{IconX}}
            @width='20px'
            @height='20px'
            {{on 'click' @onClose}}
            aria-label='Close AI Assistant'
            data-test-close-ai-assistant
          />
          <div class='header-buttons' {{popoverVelcro.hook}}>
            <Button
              class='new-session-button'
              @kind='secondary-dark'
              @size='small'
              @disabled={{not this.currentRoom.messages.length}}
              {{on 'click' this.createNewSession}}
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
                @disabled={{this.displayRoomError}}
                {{on 'click' this.displayPastSessions}}
                data-test-past-sessions-button
              >
                Past Sessions
                <DropdownArrowFilled width='10' height='10' />
              </Button>
            {{/if}}
          </div>
        </header>

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
            @onClose={{this.onCloseRename}}
            {{popoverVelcro.loop}}
          />
        {{/if}}

        {{#if this.displayRoomError}}
          <NewSession @errorAction={{this.createNewSession}} />
        {{else if this.doCreateRoom.isRunning}}
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
        grid-template-rows: auto 1fr;
        background-color: var(--boxel-ai-purple);
        border: none;
        border-radius: 0;
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
      :deep(.ai-assistant-conversation) {
        padding: var(--boxel-sp) var(--boxel-sp-lg);
      }
      :deep(.room-actions) {
        z-index: 1;
      }
      .panel-header {
        --panel-title-height: 44px;
        position: relative;
        padding: var(--boxel-sp) calc(var(--boxel-sp) / 2) var(--boxel-sp)
          var(--boxel-sp-lg);
      }
      .panel-title-group {
        height: var(--panel-title-height);
        align-items: center;
        display: flex;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp);
      }
      .panel-title-text {
        margin: 0;
        padding-right: var(--boxel-sp-xl);
        color: var(--boxel-light);
        font: 700 var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .close-ai-panel {
        --icon-color: var(--boxel-highlight);
        position: absolute;
        right: var(--boxel-sp-xs);
        top: var(--boxel-sp);
        height: var(--panel-title-height);
        z-index: 1;
      }
      .header-buttons {
        position: relative;
        align-items: center;
        display: inline-flex;
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
  @service private declare aiService: AiService;
  @service private declare router: RouterService;

  @tracked private currentRoomId: string | undefined;
  @tracked private isShowingPastSessions = false;
  @tracked private roomToRename: RoomField | undefined = undefined;
  @tracked private roomToDelete: RoomField | undefined = undefined;
  @tracked private roomDeleteError: string | undefined = undefined;
  @tracked private displayRoomError = false;

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

  private get currentRoom() {
    return this.currentRoomId
      ? this.roomResources.get(this.currentRoomId)?.room
      : undefined;
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
    this.displayRoomError = false;
    if (this.newSessionId) {
      this.enterRoom(this.newSessionId!);
      return;
    }
    let newRoomName = `${format(
      new Date(),
      "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
    )} - ${this.matrixService.userId}`;
    this.doCreateRoom.perform(newRoomName, [aiBotUsername]);
  }

  private doCreateRoom = restartableTask(
    async (name: string, invites: string[]) => {
      try {
        let newRoomId = await this.matrixService.createRoom(name, invites);
        window.localStorage.setItem(newSessionIdPersistenceKey, newRoomId);
        this.enterRoom(newRoomId);
      } catch (e) {
        console.error(e);
        this.displayRoomError = true;
        this.currentRoomId = undefined;
      }
    },
  );

  private get newSessionId() {
    let id = window.localStorage.getItem(newSessionIdPersistenceKey);
    if (
      id &&
      this.roomResources.has(id) &&
      this.roomResources.get(id)?.room?.messages.length === 0
    ) {
      return id;
    }
    return undefined;
  }

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
      if (!room.created) {
        // there is a race condition in the matrix SDK where newly created
        // rooms don't immediately have a created date
        room.created = new Date();
      }
      if (
        (room.invitedMembers.find((m) => aiBotUserId === m.userId) ||
          room.joinedMembers.find((m) => aiBotUserId === m.userId)) &&
        room.joinedMembers.find((m) => this.matrixService.userId === m.userId)
      ) {
        rooms.push(room);
      }
    }
    // sort in reverse chronological order of last activity
    let sorted = rooms.sort(
      (a, b) =>
        this.matrixService.getLastActiveTimestamp(b) -
        this.matrixService.getLastActiveTimestamp(a),
    );
    return sorted;
  }

  @action
  private enterRoom(roomId: string, hidePastSessionsList = true) {
    this.currentRoomId = roomId;
    // set current room in ai service
    this.aiService.setCurrentRoom(roomId);
    if (hidePastSessionsList) {
      this.hidePastSessions();
    }
    window.localStorage.setItem(currentRoomIdPersistenceKey, roomId);
  }

  @action private setRoomToRename(room: RoomField | undefined) {
    this.roomToRename = room;
    this.hidePastSessions();
  }

  @action private onCloseRename() {
    this.roomToRename = undefined;
    this.displayPastSessions();
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
      await this.matrixService.client.forget(roomId);
      await timeout(eventDebounceMs); // this makes it feel a bit more responsive
      this.roomResources.delete(roomId);

      if (this.newSessionId === roomId) {
        window.localStorage.removeItem(newSessionIdPersistenceKey);
      }

      if (this.currentRoomId === roomId) {
        window.localStorage.removeItem(currentRoomIdPersistenceKey);
        let latestRoom = this.aiSessionRooms[0];
        if (latestRoom) {
          this.enterRoom(latestRoom.roomId, false);
        } else {
          this.createNewSession();
        }
      }
      this.roomToDelete = undefined;
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
