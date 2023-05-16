import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { not, or } from '../helpers/truth-helpers';
import { ScrollIntoView, ScrollPaginate } from '../modifiers/scrollers';
import { restartableTask } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelMessage,
  BoxelInput,
  LoadingIndicator,
  FieldContainer,
  Button,
} from '@cardstack/boxel-ui';
import { type RoomMember } from 'matrix-js-sdk';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import { formatRFC3339 } from 'date-fns';
import { marked } from 'marked';
import { sanitize } from 'dompurify';
import type MatrixService from '../services/matrix-service';
import { TrackedMap } from 'tracked-built-ins';
import { type Event } from '../services/matrix-service';

const TRUE = true;

interface RoomArgs {
  Args: {
    roomId: string;
    members: TrackedMap<
      string,
      { member: RoomMember; status: 'join' | 'invite' | 'leave' }
    >;
  };
}
export default class Room extends Component<RoomArgs> {
  <template>
    <BoxelHeader
      @title={{this.roomName}}
      @hasBackground={{TRUE}}
      class='room__header'
    >
      <:actions>
        <Button
          data-test-invite-mode-btn
          class='room__header__invite-btn'
          {{on 'click' this.showInviteMode}}
          @disabled={{this.isInviteMode}}
        >Invite</Button>
        <div data-test-room-members class='room__members'><b>Members:</b>
          {{this.memberNames}}</div>
      </:actions>
    </BoxelHeader>
    {{#if this.isInviteMode}}
      {{#if this.doInvite.isRunning}}
        <LoadingIndicator />
      {{/if}}
      <fieldset>
        <FieldContainer @label='Invite:' @tag='label'>
          <BoxelInput
            data-test-room-invite-field
            type='text'
            @value={{this.membersToInviteFormatted}}
            @onInput={{this.setMembersToInvite}}
          />
        </FieldContainer>
        <Button
          data-test-create-room-cancel-btn
          {{on 'click' this.cancelInvite}}
        >Cancel</Button>
        <Button
          data-test-create-room-btn
          @kind='primary'
          @disabled={{not this.membersToInvite}}
          {{on 'click' this.invite}}
        >Invite</Button>
      </fieldset>
    {{/if}}

    <div
      class='room__messages-wrapper'
      {{ScrollPaginate
        isDisabled=this.isPaginationStopped
        onScrollTop=this.getPrevMessages
      }}
    >
      <div class='room__messages'>
        <div class='room__messages__notices'>
          {{#if
            (or this.doRoomScrollBack.isRunning this.doTimelineFlush.isRunning)
          }}
            <LoadingIndicator />
          {{/if}}
          {{#if this.atBeginningOfTimeline}}
            <div
              data-test-timeline-start
              class='room__messages__timeline-start'
            >
              - Beginning of conversation -
            </div>
          {{/if}}
        </div>
        {{#each this.timelineEvents as |event index|}}
          <Message
            @event={{event}}
            @members={{this.members}}
            @index={{index}}
          />
        {{else}}
          <div data-test-no-messages>
            (No messages)
          </div>
        {{/each}}
      </div>
    </div>

    <div class='room__send-message'>
      <BoxelInput
        data-test-message-field
        type='text'
        @multiline={{TRUE}}
        @value={{this.message}}
        @onInput={{this.setMessage}}
        rows='4'
        cols='20'
      />
      <Button
        data-test-send-message-btn
        @disabled={{not this.message}}
        @loading={{this.doSendMessage.isRunning}}
        @kind='primary'
        {{on 'click' this.sendMessage}}
      >Send</Button>
    </div>
  </template>

  @service private declare matrixService: MatrixService;
  @tracked private paginationTime: number | undefined;
  @tracked private isInviteMode = false;
  @tracked private membersToInvite: string[] = [];
  private messages: TrackedMap<string, string | undefined> = new TrackedMap();

  constructor(owner: unknown, args: any) {
    super(owner, args);
    this.doTimelineFlush.perform();
  }

  get room() {
    this.paginationTime; // just consume this so that we can invalidate the room after pagination
    let room = this.matrixService.client.getRoom(this.args.roomId);
    if (!room) {
      throw new Error(
        `bug: should never get here--matrix sdk returned a null room for ${this.args.roomId}`
      );
    }
    return room;
  }

  get members() {
    return [...this.args.members.values()];
  }

  get memberNames() {
    return this.members
      .map(
        (m) => `${m.member.name}${m.status === 'invite' ? ' (invited)' : ''}`
      )
      .join(', ');
  }

  get roomName() {
    let isEncrypted = this.matrixService.rooms.get(this.args.roomId)?.encrypted;
    return `${this.matrixService.rooms.get(this.args.roomId)?.name}${
      isEncrypted ? ' (encrypted)' : ''
    }`;
  }

  get isEncrypted() {
    return this.matrixService.rooms.get(this.args.roomId)?.encrypted;
  }

  get atBeginningOfTimeline() {
    return this.room.oldState.paginationToken === null;
  }

  get timelineEvents() {
    let roomTimeline = this.matrixService.timelines.get(this.args.roomId);
    if (!roomTimeline) {
      return [];
    }
    return [...roomTimeline.values()].sort(
      (a, b) => a.origin_server_ts! - b.origin_server_ts!
    );
  }

  get message() {
    return this.messages.get(this.args.roomId);
  }

  get membersToInviteFormatted() {
    return this.membersToInvite.join(', ');
  }

  @action
  isPaginationStopped() {
    return this.doRoomScrollBack.isRunning || this.atBeginningOfTimeline;
  }

  @action
  private setMessage(message: string) {
    this.messages.set(this.args.roomId, message);
  }

  @action
  private sendMessage() {
    if (!this.message) {
      throw new Error(
        `bug: should never get here, send button is disabled when there is no message`
      );
    }
    this.doSendMessage.perform(this.message);
  }

  @action
  private getPrevMessages() {
    this.doRoomScrollBack.perform();
  }

  @action
  private showInviteMode() {
    this.isInviteMode = true;
  }

  @action
  private setMembersToInvite(invite: string) {
    this.membersToInvite = invite.split(',').map((i) => i.trim());
  }

  @action
  private cancelInvite() {
    this.resetInvite();
  }

  @action
  private invite() {
    this.doInvite.perform();
  }

  private doSendMessage = restartableTask(async (message: string) => {
    let html = sanitize(marked(message));
    await this.matrixService.client.sendHtmlMessage(
      this.args.roomId,
      message,
      html
    );
    this.messages.set(this.args.roomId, undefined);
  });

  private doRoomScrollBack = restartableTask(async () => {
    await this.matrixService.client.scrollback(this.room!);
    this.paginationTime = Date.now();
  });

  private doInvite = restartableTask(async () => {
    await this.matrixService.invite(this.args.roomId, this.membersToInvite);
    this.resetInvite();
  });

  private doTimelineFlush = restartableTask(async () => {
    await this.matrixService.flushTimeline;
  });

  private resetInvite() {
    this.membersToInvite = [];
    this.isInviteMode = false;
  }
}

interface MessageArgs {
  Args: {
    event: Event;
    index: number;
    members: { member: RoomMember }[];
  };
}

const messageStyle = {
  boxelMessageAvatarSize: '2.5rem',
  boxelMessageMetaHeight: '1.25rem',
  boxelMessageGap: 'var(--boxel-sp)',
  boxelMessageMarginLeft:
    'calc( var(--boxel-message-avatar-size) + var(--boxel-message-gap) )',
};

class Message extends Component<MessageArgs> {
  <template>
    <BoxelMessage
      {{ScrollIntoView}}
      data-test-message-idx={{this.args.index}}
      @name={{this.sender.member.name}}
      @datetime={{formatRFC3339 this.timestamp}}
      style={{cssVar
        boxel-message-avatar-size=messageStyle.boxelMessageAvatarSize
        boxel-message-meta-height=messageStyle.boxelMessageMetaHeight
        boxel-message-gap=messageStyle.boxelMessageGap
        boxel-message-margin-left=messageStyle.boxelMessageMarginLeft
      }}
    >
      {{{this.content}}}
    </BoxelMessage>
  </template>

  @service private declare matrixService: MatrixService;

  get sender() {
    let member = this.args.members.find(
      (m) => m.member.userId === this.args.event.sender
    );
    if (!member) {
      let user = this.matrixService.client.getUser(this.args.event.sender!);
      return {
        member: {
          name: `${user?.displayName ?? this.args.event.sender} (left room)`,
        },
      };
    }
    return member;
  }

  get content() {
    return this.htmlContent ?? this.rawContent;
  }

  get htmlContent() {
    // We have sanitized this using DOMPurify
    return this.args.event.content?.formatted_body;
  }

  get rawContent() {
    return this.args.event.content?.body;
  }

  get timestamp() {
    return this.args.event.origin_server_ts!;
  }
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    Room: typeof Room;
  }
}
