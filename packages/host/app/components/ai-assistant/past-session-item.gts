import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ExternalLink from '@cardstack/boxel-icons/external-link';

import { format as formatDate, isSameDay, isSameYear } from 'date-fns';

import {
  Button,
  BoxelDropdown,
  IconButton,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';
import { eq, menuItem } from '@cardstack/boxel-ui/helpers';
import {
  IconPencil,
  IconTrash,
  IconCircle,
  Copy as CopyIcon,
} from '@cardstack/boxel-ui/icons';

import ThreeDotsHorizontal from '@cardstack/boxel-icons/dots';

import { SessionRoomData } from '@cardstack/host/services/ai-assistant-panel-service';
import type MatrixService from '@cardstack/host/services/matrix-service';

export type RoomActions = {
  open: (roomId: string) => void;
  rename: (room: SessionRoomData) => void;
  delete: (room: SessionRoomData) => void;
  copyRoomId: (roomId: string) => void;
  getCopiedRoomId: () => string | null;
};

interface Signature {
  Args: {
    session: SessionRoomData;
    isCurrentRoom: boolean;
    actions: RoomActions;
  };
}

export default class PastSessionItem extends Component<Signature> {
  @tracked private preventMenuClose = false;

  <template>
    <li
      class='session'
      data-test-joined-room={{@session.roomId}}
      data-room-id={{@session.roomId}}
      data-is-current-room={{@isCurrentRoom}}
    >
      <span class='session-item-content'>
        <Button
          @kind='secondary-dark'
          @size='auto'
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
        </Button>
        <BoxelDropdown>
          <:trigger as |bindings|>
            <Tooltip>
              <:trigger>
                <IconButton
                  @size='small'
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
              @closeMenu={{fn this.handleCloseMenu dd.close}}
              @items={{array
                (menuItem
                  'Open Session'
                  (fn @actions.open @session.roomId)
                  icon=ExternalLink
                )
                (menuItem
                  'Rename' (fn @actions.rename @session) icon=IconPencil
                )
                (menuItem
                  (if
                    (eq (@actions.getCopiedRoomId) @session.roomId)
                    'Copied!'
                    'Copy Room Id'
                  )
                  (fn this.handleCopyRoomId @session.roomId)
                  icon=CopyIcon
                )
                (menuItem 'Delete' (fn @actions.delete @session) icon=IconTrash)
              }}
            />
          </:content>
        </BoxelDropdown>
      </span>
    </li>

    <style scoped>
      :global(:root) {
        --color-streaming: #01c6bf;
        --color-new-messages: #00ad4a;
      }

      .session {
        margin-inline: var(--boxel-sp-xs);
      }
      .session + .session {
        border-top: 1px solid var(--past-sessions-divider-color);
      }
      .session + .session[data-is-current-room],
      .session[data-is-current-room] + .session,
      .session + .session:hover,
      .session:hover + .session {
        border-top-color: transparent;
      }

      .session-item-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp) var(--boxel-sp-sm);
        border: 1px solid transparent;
        border-radius: var(--boxel-border-radius-xs);
      }
      .session[data-is-current-room] .session-item-content {
        border-color: var(--past-sessions-divider-color);
      }
      .session-item-content:hover {
        background-color: var(--ai-assistant-menu-hover-background);
      }

      .name {
        font-weight: 600;
      }
      .date {
        margin-top: var(--boxel-sp-xxs);
        color: var(--boxel-400);
      }
      .view-session-button {
        display: inline-block;
        width: 100%;
        max-width: 100%;
        border: none;
        border-radius: var(--boxel-border-radius-xs);
        font-weight: var(--boxel-font-weight-normal);
        text-align: left;
        margin-right: var(--boxel-sp-xxxs);
      }
      .view-session-button:focus:focus-visible {
        outline-offset: 2px;
      }

      .menu-button {
        visibility: hidden;
      }
      .session:hover .menu-button,
      .session:focus-within .menu-button {
        visibility: visible;
        outline-offset: 2px;
      }
      .menu-button:hover:not(:disabled) {
        background-color: var(--boxel-highlight);
        color: var(--boxel-dark);
      }
      .menu-button[aria-expanded='true'] {
        visibility: visible;
        background-color: var(--boxel-highlight-hover);
        color: var(--boxel-dark);
      }

      .menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xxs)
          var(--boxel-sp-sm);

        background: var(--ai-assistant-menu-background);
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

  @action
  private handleCopyRoomId(roomId: string) {
    this.preventMenuClose = true;
    this.args.actions.copyRoomId(roomId);
    // Reset the flag after a short delay to allow normal closing for other actions
    setTimeout(() => {
      this.preventMenuClose = false;
    }, 200);
  }

  @action
  private handleCloseMenu(originalClose: () => void) {
    if (!this.preventMenuClose) {
      originalClose();
    }
  }

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
