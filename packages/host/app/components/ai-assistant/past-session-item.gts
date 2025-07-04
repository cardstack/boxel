import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';

import { service } from '@ember/service';
import Component from '@glimmer/component';

import ExternalLink from '@cardstack/boxel-icons/external-link';

import { format as formatDate, isSameDay, isSameYear } from 'date-fns';

import {
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { menuItem } from '@cardstack/boxel-ui/helpers';
import {
  IconPencil,
  IconTrash,
  ThreeDotsHorizontal,
  IconCircle,
} from '@cardstack/boxel-ui/icons';

import { SessionRoomData } from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

export type RoomActions = {
  open: (roomId: string) => void;
  rename: (room: SessionRoomData) => void;
  delete: (room: SessionRoomData) => void;
};

interface Signature {
  Args: {
    session: SessionRoomData;
    isCurrentRoom: boolean;
    actions: RoomActions;
  };
}

export default class PastSessionItem extends Component<Signature> {
  <template>
    <li
      class='session'
      data-test-joined-room={{@session.roomId}}
      data-room-id={{@session.roomId}}
      data-is-current-room={{@isCurrentRoom}}
    >
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
                @width='16px'
                @height='16px'
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
                'Open Session'
                (fn @actions.open @session.roomId)
                icon=ExternalLink
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
        border-top: 1px solid var(--past-sessions-divider-color);
        padding: var(--boxel-sp) var(--boxel-sp-sm);
        margin-right: var(--boxel-sp-xs);
        margin-left: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs);
      }

      .session:first-child {
        border-top: none;
      }

      .session:hover {
        background-color: var(--past-sessions-hover-background);
        cursor: pointer;
      }
      .session[data-is-current-room] {
        border: 1px solid var(--past-sessions-divider-color);
      }
      .session:hover + .session:not([data-is-current-room]),
      .session[data-is-current-room] + .session {
        border-top-color: transparent;
      }
      .name {
        font-weight: 600;
      }
      .date {
        margin-top: var(--boxel-sp-xxs);
        color: var(--boxel-400);
      }
      .view-session-button {
        color: var(--boxel-light);
        background-color: transparent;
        border: none;
        width: 100%;
        text-align: left;
      }

      .menu-button {
        visibility: hidden;
        display: flex;
        width: auto;
        height: auto;
        padding: 2px;
        border-radius: var(--boxel-border-radius-xs);
      }

      .session:hover .menu-button {
        visibility: visible;
      }

      .menu-button:hover:not(:disabled) {
        background-color: var(--boxel-highlight);
      }

      .menu-button :deep(svg) {
        stroke: var(--boxel-dark);
        stroke-width: 1px;
      }

      .menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xxs)
          var(--boxel-sp-sm);

        background: var(--past-sessions-background);
        border: 1px solid var(--past-sessions-divider-color);
        color: var(--boxel-light);
        padding: var(--boxel-sp-xs);
        box-shadow: var(--boxel-deep-box-shadow);
      }

      .menu :deep(svg) {
        --icon-stroke-width: 1.5px;
        --icon-color: var(--boxel-light);

        margin-right: var(--boxel-sp-xs);
      }

      .menu :deep(.boxel-menu__item:nth-child(2) svg) {
        --icon-stroke-width: 0.5px;
      }

      .menu :deep(.boxel-menu__item:hover) {
        background-color: var(--past-sessions-hover-background);
        border-radius: var(--boxel-border-radius-xs);
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
    return this.args.session.lastMessage?.isStreamingFinished === false;
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
