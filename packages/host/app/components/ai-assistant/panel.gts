import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
//@ts-expect-error the types don't recognize the cached export
import { tracked, cached } from '@glimmer/tracking';

import format from 'date-fns/format';
import { restartableTask } from 'ember-concurrency';

import { TrackedMap } from 'tracked-built-ins';

import {
  Button,
  IconButton,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { IconX } from '@cardstack/boxel-ui/icons';

import { aiBotUsername } from '@cardstack/runtime-common';

import Room from '@cardstack/host/components/matrix/room';
import RoomList from '@cardstack/host/components/matrix/room-list';

import { isMatrixError } from '@cardstack/host/lib/matrix-utils';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type {
  RoomField,
  RoomMemberField,
} from 'https://cardstack.com/base/room';

import { getRoom, RoomResource } from '../../resources/room';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onClose: () => void;
  };
}

export default class AiAssistantPanel extends Component<Signature> {
  <template>
    <div class='ai-assistant-panel' data-test-ai-assistant-panel ...attributes>
      <header>
        <div class='header-buttons'>
          <Button
            @kind='secondary-dark'
            @size='small'
            class='new-session-button'
            {{on 'click' this.createNewSession}}
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
            >
              Past Sessions
            </Button>
          {{/if}}

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
        </div>

        {{#if this.isShowingPastSessions}}
          <RoomList
            @rooms={{this.sortedAiSessionRooms}}
            @enterRoom={{this.enterRoom}}
          />
        {{/if}}
      </header>

      {{#if this.doCreateRoom.isRunning}}
        <LoadingIndicator />
      {{else if this.currentRoomId}}
        <Room @roomId={{this.currentRoomId}} />
      {{/if}}
    </div>

    <style>
      .ai-assistant-panel {
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--boxel-ai-purple);
        border: none;
        color: var(--boxel-light);
      }
      .header-buttons {
        align-items: center;
        display: flex;
        padding: var(--boxel-sp) calc(var(--boxel-sp) / 2) var(--boxel-sp)
          var(--boxel-sp);
      }
      .new-session-button {
        margin-right: var(--boxel-sp-xxxs);
      }
      .close-ai-panel {
        --icon-color: var(--boxel-highlight);
        margin-left: auto;
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  @tracked private newRoomInvite: string[] = [];
  @tracked private currentRoomId: string | undefined;
  @tracked private isShowingPastSessions = true;
  // @ts-ignore (glint is not recognizing that this variable is being used when set to private)
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

  @action
  private createNewSession() {
    let newRoomName = `${format(
      new Date(),
      "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
    )} - ${this.matrixService.userId}`;
    this.newRoomInvite = [aiBotUsername];
    this.doCreateRoom.perform(newRoomName);
  }

  private doCreateRoom = restartableTask(async (roomName: string) => {
    if (!roomName) {
      throw new Error(
        `bug: should never get here, create button is disabled when there is no new room name`,
      );
    }
    try {
      let newRoomId = await this.matrixService.createRoom(
        roomName,
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
  });

  @action
  togglePastSessions() {
    this.isShowingPastSessions = !this.isShowingPastSessions;
  }

  @cached
  private get joinedAiSessionRooms() {
    let rooms: { room: RoomField; member: RoomMemberField }[] = [];
    for (let resource of this.roomResources.values()) {
      if (!resource.room) {
        continue;
      }
      // TODO: resolve missing aibot member id in tests
      // if (resource.room.roomMembers.find((m) => aiBotUserId === m.userId)) {
      let roomMember = resource.room.joinedMembers.find(
        (m) => this.matrixService.userId === m.userId,
      );
      if (roomMember) {
        rooms.push({ room: resource.room, member: roomMember });
      }
      // }
    }
    return rooms;
  }

  @cached
  private get sortedAiSessions() {
    return this.joinedAiSessionRooms.sort(
      (a, b) =>
        a.member.membershipDateTime.getTime() -
        b.member.membershipDateTime.getTime(),
    );
  }

  @cached
  private get sortedAiSessionRooms() {
    return this.sortedAiSessions.map((r) => r.room);
  }

  @action
  private enterRoom(roomId: string) {
    this.currentRoomId = roomId;
    this.isShowingPastSessions = false;
  }
}
