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

import { TrackedMap } from 'tracked-built-ins';

import {
  Button,
  IconButton,
  LoadingIndicator,
  FieldContainer,
  BoxelInput,
} from '@cardstack/boxel-ui/components';
import { ResizeHandle } from '@cardstack/boxel-ui/components';
import { not, cssVar } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';
import { DropdownArrowUp } from '@cardstack/boxel-ui/icons';

import { aiBotUsername } from '@cardstack/runtime-common';

import AiAssistantPanelPopover from '@cardstack/host/components/ai-assistant/panel-popover';
import AiAssistantPastSessionsList from '@cardstack/host/components/ai-assistant/past-sessions';
import Room from '@cardstack/host/components/matrix/room';

import ENV from '@cardstack/host/config/environment';
import {
  isMatrixError,
  eventDebounceMs,
} from '@cardstack/host/lib/matrix-utils';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type {
  RoomField,
  RoomMemberField,
} from 'https://cardstack.com/base/room';

import { getRoom, RoomResource } from '../../resources/room';

const { matrixURL } = ENV;
export const aiBotUserId = `@${aiBotUsername}:${new URL(matrixURL).hostname}`;

export type AiSessionRoom = { room: RoomField; member: RoomMemberField };

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onClose: () => void;
    resizeHandle: ResizeHandle;
  };
}

export default class AiAssistantPanel extends Component<Signature> {
  <template>
    <div class='ai-assistant-panel' data-test-ai-assistant-panel ...attributes>
      <@resizeHandle />
      <header>
        <img alt='' src='/images/ai-assist-icon.webp' />
        <span>Assistant</span>
        <IconButton
          @variant='primary'
          @icon={{IconX}}
          @width='20px'
          @height='20px'
          class='close-ai-panel'
          {{on 'click' @onClose}}
          aria-label='Remove'
          data-test-close-ai-panel
        />
      </header>
      <div class='menu'>
        <div class='buttons'>
          <Button
            @kind='secondary-dark'
            @size='small'
            class='new-session-button'
            {{on 'click' this.displayCreateNew}}
            @disabled={{this.isShowingCreateNew}}
            data-test-create-room-mode-btn
          >
            New Session
          </Button>

          {{#if this.loadRooms.isRunning}}
            <LoadingIndicator />
          {{else}}
            <Button
              @kind='secondary-dark'
              @size='small'
              {{on 'click' this.togglePastSessions}}
              data-test-past-sessions-button
              class='past-sessions-button'
            >
              Past Sessions

              <DropdownArrowDown
                width={{20}}
                height={{20}}
                style={{cssVar icon-color='#fff'}}
              />
            </Button>
          {{/if}}
        </div>

        {{#if this.isShowingCreateNew}}
          <div class='create-room'>
            <FieldContainer
              @label='Room Name'
              @tag='label'
              class='create-room__field'
            >
              <BoxelInput
                @state={{this.roomNameInputState}}
                @value={{this.newRoomName}}
                @errorMessage={{this.roomNameError}}
                @onInput={{this.setNewRoomName}}
                data-test-room-name-field
              />
            </FieldContainer>
          </div>
          <div class='create-button-wrapper'>
            <Button
              @kind='secondary-dark'
              {{on 'click' this.closeCreateRoom}}
              data-test-create-room-cancel-btn
            >Cancel</Button>
            <Button
              @kind='primary'
              @disabled={{not this.newRoomName.length}}
              {{on 'click' this.createNewSession}}
              data-test-create-room-btn
            >Create</Button>
          </div>
        {{/if}}

        {{#if this.isShowingPastSessions}}
          <AiAssistantPanelPopover>
            <:header>
              <div class='past-sessions-header'>
                Past Sessions
                <button
                  {{on 'click' this.togglePastSessions}}
                  data-test-close-past-sessions
                >
                  <DropdownArrowUp width={{20}} height={{20}} />
                </button>
              </div>
            </:header>
            <:body>
              <AiAssistantPastSessionsList
                @sessions={{this.sortedAiSessionRooms}}
                @onSessionSelect={{this.enterRoom}}
              />
            </:body>
          </AiAssistantPanelPopover>
        {{/if}}

        {{#if this.hasInvites}}
          <ul class='room-list' data-test-invites-list>
            <h3>Invites</h3>
            {{#each this.sortedInvites as |invite|}}
              <li class='room' data-test-invited-room={{invite.room.name}}>
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
                  @kind='secondary-dark'
                  data-test-decline-room-btn={{invite.room.name}}
                  {{on 'click' (fn this.leaveRoom invite.room.roomId)}}
                >Decline</Button>
                <Button
                  @kind='primary'
                  data-test-join-room-btn={{invite.room.name}}
                  {{on 'click' (fn this.joinRoom invite.room.roomId)}}
                >Join</Button>
                {{#if (eq invite.room.roomId this.roomIdForCurrentAction)}}
                  <LoadingIndicator />
                {{/if}}
              </li>
            {{/each}}
          </ul>
        {{/if}}
      </div>

      {{#unless this.isShowingCreateNew}}
        {{#if this.doCreateRoom.isRunning}}
          <LoadingIndicator />
        {{else if this.currentRoomId}}
          <Room @roomId={{this.currentRoomId}} @leaveRoom={{this.leaveRoom}} />
        {{/if}}
      {{/unless}}
    </div>

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
      .ai-assistant-panel header {
        align-items: center;
        display: flex;
        padding: var(--boxel-sp-xs) calc(var(--boxel-sp) / 2) var(--boxel-sp-xs)
          var(--boxel-sp-lg);
        gap: var(--boxel-sp);
      }
      .ai-assistant-panel header img {
        height: 20px;
        width: 20px;
      }
      .ai-assistant-panel header span {
        font: 700 var(--boxel-font);
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

      .close-ai-panel {
        --icon-color: var(--boxel-highlight);
        margin-left: auto;
      }
      .create-room {
        padding: var(--boxel-sp) 0;
      }
      .create-room :deep(.boxel-label) {
        color: var(--boxel-light);
      }
      .create-button-wrapper {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-xs);
      }
      .past-sessions-header {
        display: flex;
        justify-content: space-between;
        margin-right: var(--boxel-sp);
      }

      .past-sessions-header button {
        border: 0;
        background: inherit;
      }

      .past-sessions-button svg {
        margin-left: var(--boxel-sp-xs);
      }
      .room-list {
        padding: 0;
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare router: RouterService;

  @tracked private currentRoomId: string | undefined;
  @tracked private isShowingPastSessions = false;
  @tracked private isShowingCreateNew = false;
  @tracked private newRoomName = '';
  @tracked private roomNameError: string | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
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

  private loadRooms = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await Promise.all([...this.roomResources.values()].map((r) => r.loading));
  });

  @action private displayCreateNew() {
    this.newRoomName = this.newRoomAutoName;
    this.isShowingCreateNew = true;
  }

  private get roomNameInputState() {
    return this.roomNameError ? 'invalid' : 'initial';
  }

  private get newRoomAutoName() {
    return `${format(new Date(), "yyyy-MM-dd'T'HH:mm:ss.SSSxxx")} - ${
      this.matrixService.userId
    }`;
  }

  @action
  private setNewRoomName(name: string) {
    this.newRoomName = name;
    this.roomNameError = undefined;
  }

  @action
  private createNewSession() {
    let newRoomName = this.newRoomName;
    let newRoomInvite = [aiBotUsername];
    this.doCreateRoom.perform(newRoomName, newRoomInvite);
  }

  private doCreateRoom = restartableTask(
    async (newRoomName: string, newRoomInvite: string[]) => {
      if (!newRoomName) {
        throw new Error(
          `bug: should never get here, create button is disabled when there is no new room name`,
        );
      }
      try {
        let newRoomId = await this.matrixService.createRoom(
          newRoomName,
          newRoomInvite,
        );
        this.enterRoom(newRoomId);
      } catch (e) {
        if (isMatrixError(e) && e.data.errcode === 'M_ROOM_IN_USE') {
          this.roomNameError = 'Room already exists';
          return;
        }
        throw e;
      }
      this.closeCreateRoom();
    },
  );

  @action
  private closeCreateRoom() {
    this.isShowingCreateNew = false;
  }

  @action
  togglePastSessions() {
    this.isShowingPastSessions = !this.isShowingPastSessions;
  }

  @cached
  private get aiSessionRooms() {
    let rooms: AiSessionRoom[] = [];
    for (let resource of this.roomResources.values()) {
      if (!resource.room) {
        continue;
      }
      if (resource.room.roomMembers.find((m) => aiBotUserId === m.userId)) {
        let roomMember = resource.room.joinedMembers.find(
          (m) => this.matrixService.userId === m.userId,
        );
        if (roomMember) {
          rooms.push({ room: resource.room, member: roomMember });
        }
      }
    }
    return rooms;
  }

  @cached
  private get sortedAiSessionRooms() {
    return this.aiSessionRooms.sort(
      (a, b) =>
        a.member.membershipDateTime.getTime() -
        b.member.membershipDateTime.getTime(),
    );
  }

  @action
  private enterRoom(roomId: string) {
    this.currentRoomId = roomId;
    this.isShowingPastSessions = false;
  }

  @action
  private leaveRoom(roomId: string) {
    this.doLeaveRoom.perform(roomId);
  }

  private doLeaveRoom = restartableTask(async (roomId: string) => {
    await this.matrixService.client.leave(roomId);
    await timeout(eventDebounceMs); // this makes it feel a bit more responsive
    if (this.currentRoomId === roomId) {
      this.currentRoomId = undefined;
    }
  });
}
