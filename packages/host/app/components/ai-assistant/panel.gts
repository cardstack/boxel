import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
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
import { eq } from '@cardstack/boxel-ui/helpers';
import { IconX } from '@cardstack/boxel-ui/icons';

import { aiBotUsername } from '@cardstack/runtime-common';

import RoomApplyPatch from '@cardstack/host/components/matrix/room-apply-patch';
import RoomInput from '@cardstack/host/components/matrix/room-input';
import ENV from '@cardstack/host/config/environment';
import { isMatrixError } from '@cardstack/host/lib/matrix-utils';

import type MatrixService from '@cardstack/host/services/matrix-service';

import type {
  RoomField,
  RoomMemberField,
} from 'https://cardstack.com/base/room';

import { getRoom, RoomResource } from '../../resources/room';
import ProfileAvatarIcon from '../operator-mode/profile-avatar-icon';

import AiAssistantMessage, { AiAssistantConversation } from './message';

const { matrixURL } = ENV;
const aiBotUserId = `@${aiBotUsername}:${new URL(matrixURL).hostname}`;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onClose: () => void;
  };
}

export default class AiAssistantPanel extends Component<Signature> {
  @service private declare matrixService: MatrixService;
  @tracked private newRoomName: string | undefined;
  @tracked private newRoomInvite: string[] = [];
  @tracked private currentRoomId: string | undefined;
  @tracked private isShowingPastSessions = false;
  @tracked private roomNameError: string | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadRooms.perform();
  }

  @action
  private enterRoom(roomId: string) {
    this.currentRoomId = roomId;
  }

  @action
  private createNewSession() {
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

  private resetCreateRoom() {
    this.newRoomName = undefined;
  }

  private roomResource = getRoom(this, () => this.currentRoomId);

  private get room() {
    return this.roomResource.room;
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
  private get sortedAiSessionRooms() {
    return this.joinedAiSessionRooms.sort(
      (a, b) =>
        a.member.membershipDateTime.getTime() -
        b.member.membershipDateTime.getTime(),
    );
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
  togglePastSessions() {
    this.isShowingPastSessions = !this.isShowingPastSessions;
  }

  <template>
    <div class='ai-assistant-panel' data-test-ai-assistant-panel ...attributes>
      <header>
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
            class='past-sessions-button'
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
      </header>
      {{#if this.isShowingPastSessions}}
        {{#each this.sortedAiSessionRooms as |joined|}}
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
          </div>
        {{else}}
          (No rooms)
        {{/each}}

      {{/if}}

      {{#if this.doCreateRoom.isRunning}}
        <LoadingIndicator />
      {{else}}
        <AiAssistantConversation>
          <div class='notices'>
            <div data-test-timeline-start class='timeline-start'>
              - Beginning of conversation -
            </div>
          </div>
          {{#each this.room.messages as |message|}}
            <AiAssistantMessage
              @formattedMessage={{htmlSafe message.formattedMessage}}
              @datetime={{message.created}}
              @isFromAssistant={{eq message.author.userId aiBotUserId}}
              @profileAvatar={{component
                ProfileAvatarIcon
                userId=message.author.userId
              }}
            />
            {{#if (eq message.command.commandType 'patch')}}
              <RoomApplyPatch @payload={{message.command.payload}} />
            {{/if}}
          {{else}}
            <div data-test-no-messages>
              (No messages)
            </div>
          {{/each}}
        </AiAssistantConversation>
        {{#if this.currentRoomId}}
          <RoomInput @roomId={{this.currentRoomId}} />
        {{/if}}
      {{/if}}
    </div>
    <style>
      .ai-assistant-panel {
        background-color: var(--boxel-ai-purple);
        border: none;
        color: var(--boxel-light);
      }
      header {
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
}
