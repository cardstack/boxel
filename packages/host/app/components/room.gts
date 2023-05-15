import Component from '@glimmer/component';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { not } from '../helpers/truth-helpers';
import { ScrollIntoView, ScrollPaginate } from '../modifiers/scrollers';
import { restartableTask } from 'ember-concurrency';
import {
  BoxelHeader,
  BoxelMessage,
  BoxelInput,
  LoadingIndicator,
  Button,
} from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import { formatRFC3339 } from 'date-fns';
import type MatrixService from '../services/matrix-service';
import { TrackedMap } from 'tracked-built-ins';
import { type Event } from '../services/matrix-service';
import { type Room as MatrixRoom } from 'matrix-js-sdk';

const TRUE = true;

interface RoomArgs {
  Args: {
    roomId: string;
  };
}
export default class Room extends Component<RoomArgs> {
  <template>
    <BoxelHeader @title={{this.roomName}} @hasBackground={{TRUE}} />

    <div data-test-room-members>
      TODO: Room members
    </div>
    <div
      class='room__messages-wrapper'
      {{ScrollPaginate
        isDisabled=this.isPaginationStopped
        onScrollTop=this.getPrevMessages
      }}
    >
      <div class='room__messages'>
        <div class='room__messages__notices'>
          {{#if this.doRoomScrollBack.isRunning}}
            <LoadingIndicator />
          {{/if}}
          {{#if this.atBeginningOfTimeline}}
            <div data-test-timeline-start>
              - Beginning of conversation -
            </div>
          {{/if}}
        </div>
        {{#each this.timelineEvents as |event|}}
          <Message @event={{event}} />
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
  @tracked private room: MatrixRoom;
  // TODO make sure to test for pending room specific message
  private messages: TrackedMap<string, string | undefined> = new TrackedMap();

  constructor(owner: unknown, args: any) {
    super(owner, args);
    let room = this.matrixService.client.getRoom(this.args.roomId);
    if (!room) {
      throw new Error(
        `bug: should never get here--matrix sdk returned a null room for ${this.args.roomId}`
      );
    }
    this.room = room;
  }

  get roomName() {
    return this.matrixService.roomNames.get(this.args.roomId);
  }

  get atBeginningOfTimeline() {
    return this.room.oldState.paginationToken === null;
  }

  get timelineEvents() {
    return [
      ...(
        this.matrixService.timelines.get(this.args.roomId) ?? new TrackedMap()
      ).values(),
    ].sort((a, b) => a.origin_server_ts! - b.origin_server_ts!);
  }

  get message() {
    return this.messages.get(this.args.roomId);
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

  private doSendMessage = restartableTask(async (message: string) => {
    // TODO message is markdown--parse to HTML and send
    await this.matrixService.client.sendTextMessage(this.args.roomId, message);
    this.messages.set(this.args.roomId, undefined);
  });

  private doRoomScrollBack = restartableTask(async () => {
    this.room = await this.matrixService.client.scrollback(this.room!);
  });
}

interface MessageArgs {
  Args: {
    event: Event;
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
      @name={{this.sender}}
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

  get sender() {
    return this.args.event.sender;
  }

  // TODO remove this after we start using markdown
  get content() {
    return this.htmlContent ?? this.rawContent;
  }

  get htmlContent() {
    // TODO probably we need to sanitize this...
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
