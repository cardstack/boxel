import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import { format as formatDate, isSameDay, isSameYear } from 'date-fns';

import {
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import {
  Upload,
  IconPencil,
  IconTrash,
  ThreeDotsHorizontal,
  IconCircle,
} from '@cardstack/boxel-ui/icons';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { SessionRoomData } from './panel';

export type RoomActions = {
  open: (roomId: string) => void;
  rename: (room: SessionRoomData) => void;
  delete: (room: SessionRoomData) => void;
};

interface Signature {
  Args: {
    session: SessionRoomData;
    actions: RoomActions;
  };
}

export default class PastSessionItem extends Component<Signature> {
  <template>
    <li class='session' data-test-joined-room={{@session.roomId}}>
      <button
        class='view-session-button'
        {{on 'click' (fn @actions.open @session.roomId)}}
        data-test-enter-room={{@session.roomId}}
      >
        <div class='name'>{{@session.name}}</div>
        <div
          class='date
            {{if this.isStreaming "is-streaming"}}
            {{if this.hasUnseenMessage "has-unseen-message"}}'
          data-test-last-active={{this.lastActive}}
          data-test-is-streaming={{this.isStreaming}}
          data-test-is-unseen-message={{this.hasUnseenMessage}}
        >
          {{#if this.isStreaming}}
            <IconCircle
              width='12px'
              height='12px'
              class='icon-recency-indicator icon-streaming pulsing'
            />
            Thinking…
          {{else if this.hasUnseenMessage}}
            <IconCircle
              width='10px'
              height='10px'
              class='icon-recency-indicator icon-new-messages'
            />
            Updated
            {{this.formattedDate}}
          {{else}}
            {{this.formattedDate}}
          {{/if}}
        </div>
      </button>
      <BoxelDropdown>
        <:trigger as |bindings|>
          <Tooltip @placement='top'>
            <:trigger>
              <IconButton
                @icon={{ThreeDotsHorizontal}}
                @width='20px'
                @height='20px'
                class='menu-button'
                aria-label='Options'
                data-test-past-session-options-button={{@session.roomId}}
                {{bindings}}
              />
            </:trigger>
            <:content>
              More Options
            </:content>
          </Tooltip>
        </:trigger>
        <:content as |dd|>
          <Menu
            class='menu past-session-menu'
            @closeMenu={{dd.close}}
            @items={{array
              (menuItem
                'Open Session' (fn @actions.open @session.roomId) icon=Upload
              )
              (menuItem 'Rename' (fn @actions.rename @session) icon=IconPencil)
              (menuItem 'Delete' (fn @actions.delete @session) icon=IconTrash)
            }}
          />
        </:content>
      </BoxelDropdown>
    </li>

    <style scoped>
      :global(:root) {
        --color-streaming: #01c6bf;
        --color-new-messages: #00ad4a;
      }

      .session {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid var(--boxel-300);
        padding-top: var(--boxel-sp-sm);
        padding-left: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-sm);
        margin-right: var(--boxel-sp-xs);
        margin-left: var(--boxel-sp-xs);
      }
      .session:hover {
        background-color: var(--boxel-200);
        cursor: pointer;
        border-radius: 8px;
      }
      .session:hover + .session {
        border-top-color: transparent;
      }
      .name {
        font-weight: 600;
      }
      .date {
        margin-top: var(--boxel-sp-4xs);
        color: var(--boxel-450);
      }
      .view-session-button {
        background-color: transparent;
        border: none;
        width: 100%;
        text-align: left;
      }
      .menu-button:hover:not(:disabled) {
        --icon-color: var(--boxel-highlight);
      }
      .menu :deep(svg) {
        --icon-stroke-width: 1.5px;
      }
      .menu :deep(.boxel-menu__item:nth-child(2) svg) {
        --icon-stroke-width: 0.5px;
      }
      .icon-recency-indicator {
        display: inline-block;
        margin-right: 4px;
      }
      .icon-streaming {
        --icon-color: var(--color-streaming);
      }
      .icon-new-messages {
        --icon-color: var(--color-new-messages);
        --icon-fill-color: var(--color-new-messages);
      }
      .has-unseen-message {
        color: var(--color-new-messages);
      }
      .is-streaming {
        color: var(--color-streaming);
      }
      .pulsing {
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0% {
          transform: scale(1);
          opacity: 1;
        }
        50% {
          transform: scale(0.2);
          opacity: 0.7;
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }
    </style>
  </template>

  @service declare matrixService: MatrixService;

  get createDate() {
    if (!this.args.session.created) {
      // there is a race condition in the matrix SDK where newly created
      // rooms don't immediately have a created date
      return new Date();
    }
    return this.args.session.created;
  }

  get isStreaming() {
    if (!this.args.session.lastMessage) {
      return false;
    }
    return !this.args.session.lastMessage.isStreamingFinished;
  }

  get hasUnseenMessage() {
    if (!this.args.session.lastMessage) {
      return false;
    }
    return !this.matrixService.currentUserEventReadReceipts.has(
      this.args.session.lastMessage.eventId,
    );
  }

  private get lastActive() {
    return (
      this.matrixService.getLastActiveTimestamp(
        this.args.session.roomId,
        this.args.session.lastActiveTimestamp,
      ) ?? this.createDate.getTime()
    );
  }

  private get formattedDate() {
    let now = new Date();
    if (isSameDay(this.lastActive, now)) {
      return `Today ${formatDate(this.lastActive, 'MMM d, h:mm aa')}`;
    } else if (isSameYear(this.lastActive, now)) {
      return formatDate(this.lastActive, 'iiii MMM d, h:mm aa');
    }
    return formatDate(this.lastActive, 'iiii MMM d, yyyy, h:mm aa');
  }
}
