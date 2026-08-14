import { fn, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import ExternalLink from '@cardstack/boxel-icons/external-link';

import { format as formatDate, isSameDay, isSameYear } from 'date-fns';
import { restartableTask, timeout } from 'ember-concurrency';
import { modifier } from 'ember-modifier';

import {
  BoxelDropdown,
  ContextButton,
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

import type { SessionRoomData } from '@cardstack/host/services/ai-assistant-panel-service';
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
  private closeDropdownAction: (() => void) | null = null;
  private triggerElement: HTMLElement | null = null;
  private menuElement: HTMLElement | null = null;

  private registerCloseAction = modifier(
    (element: HTMLElement, [closeFn]: [() => void]) => {
      this.closeDropdownAction = closeFn;
      this.menuElement = element;
      return () => {
        this.closeDropdownAction = null;
        this.menuElement = null;
      };
    },
  );

  private registerTriggerElement = modifier((element: HTMLElement) => {
    this.triggerElement = element;
    return () => {
      this.triggerElement = null;
    };
  });

  private closeDropdownTask = restartableTask(async () => {
    await timeout(200);
    // Hover-close is a pointer affordance: a keyboard user's menu must not
    // vanish (nor their focus drop to <body>) because the pointer happened
    // to pass over the row. Keyboard use shows as :focus-visible on the
    // trigger or as focus inside the menu itself.
    if (
      this.triggerElement?.matches(':focus-visible') ||
      this.menuElement?.contains(document.activeElement)
    ) {
      return;
    }
    this.closeDropdownAction?.();
    // A pointer-click leaves non-visible focus on the trigger, which would
    // hold the row's :focus-within and keep the hidden-until-hover button
    // visible after the pointer leaves.
    if (document.activeElement === this.triggerElement) {
      this.triggerElement?.blur();
    }
  });

  @action
  private scheduleCloseDropdown() {
    this.closeDropdownTask.perform();
  }

  @action
  private cancelCloseDropdown() {
    this.closeDropdownTask.cancelAll();
  }

  <template>
    <li
      class='session'
      data-test-joined-room={{@session.roomId}}
      data-room-id={{@session.roomId}}
      data-is-current-room={{@isCurrentRoom}}
      {{on 'mouseenter' this.cancelCloseDropdown}}
      {{on 'mouseleave' this.scheduleCloseDropdown}}
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
      <BoxelDropdown @contentClass='past-session-menu-dropdown'>
        <:trigger as |bindings|>
          <Tooltip @placement='top'>
            <:trigger>
              <ContextButton
                class='menu-button'
                @variant='highlight-icon'
                @size='extra-small'
                @label='past session options'
                data-test-past-session-options-button={{@session.roomId}}
                {{bindings}}
                {{this.registerTriggerElement}}
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
            {{this.registerCloseAction dd.close}}
            {{on 'mouseenter' this.cancelCloseDropdown}}
            {{on 'mouseleave' this.scheduleCloseDropdown}}
            @isRounded={{false}}
            @closeMenu={{fn this.handleCloseMenu dd.close}}
            @items={{array
              (menuItem
                'Open Session'
                (fn @actions.open @session.roomId)
                icon=ExternalLink
              )
              (menuItem 'Rename' (fn @actions.rename @session) icon=IconPencil)
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
    </li>

    <style scoped>
      :global(:root) {
        --color-streaming: #01c6bf;
        --color-new-messages: #00ad4a;
      }

      .session {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp) var(--boxel-sp-sm);
        margin-right: var(--boxel-sp-xs);
        margin-left: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs);
      }

      .session::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background-color: var(--ai-assistant-menu-divider);
      }

      .session:first-child::before {
        display: none;
      }

      .session:hover,
      .session:has(.menu-button[aria-expanded='true']) {
        background-color: var(--ai-assistant-menu-hover-background);
        border-radius: var(--boxel-border-radius-sm);
        cursor: pointer;
      }
      .session:hover::before,
      .session:has(.menu-button[aria-expanded='true'])::before,
      .session:hover + .session::before,
      .session:has(.menu-button[aria-expanded='true']) + .session::before {
        background: transparent;
      }
      .session[data-is-current-room] {
        background-color: var(--ai-assistant-menu-hover-background);
        border-radius: var(--boxel-border-radius-sm);
      }
      .session[data-is-current-room]::before,
      .session[data-is-current-room] + .session::before {
        background: transparent;
      }
      .name {
        font-weight: 600;
      }
      .date {
        margin-top: var(--boxel-sp-6xs);
        color: var(--boxel-400);
        font-size: var(--boxel-font-size-xs);
      }
      .view-session-button {
        color: var(--boxel-light);
        background-color: transparent;
        border-radius: var(--boxel-border-radius-xs);
        border: none;
        width: 100%;
        margin-right: 1px;
        text-align: left;
      }
      .view-session-button:focus:focus-visible {
        outline-offset: 1px;
      }

      .menu-button {
        --host-outline-offset: 2px;
        visibility: hidden;
      }
      .session:hover .menu-button,
      .session:focus-within .menu-button {
        visibility: visible;
      }
      .menu-button[aria-expanded='true'] {
        visibility: visible;
      }

      :global(.past-session-menu-dropdown) {
        --boxel-dropdown-background-color: var(--ai-assistant-menu-background);
        --boxel-dropdown-border-color: var(--ai-assistant-menu-border);
        --boxel-dropdown-text-color: var(--ai-assistant-menu-foreground);
        --boxel-dropdown-hover-color: var(--ai-assistant-menu-hover-background);
        --boxel-dropdown-box-shadow: var(--boxel-deep-box-shadow);
        --boxel-menu-item-border-radius: var(--boxel-border-radius-xs);
        overflow: hidden;
      }

      .menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-2xs)
          var(--boxel-sp-sm);
        padding: var(--boxel-sp-xs);
      }

      .menu :deep(svg) {
        --icon-stroke-width: 1.5px;
        --icon-color: currentColor;

        margin-right: var(--boxel-sp-xs);
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

  @action
  private handleCopyRoomId(roomId: string) {
    this.preventMenuClose = true;
    this.args.actions.copyRoomId(roomId);
    this.resetPreventMenuCloseTask.perform();
  }

  // Reset the flag after a short delay to allow normal closing for other actions
  private resetPreventMenuCloseTask = restartableTask(async () => {
    await timeout(200);
    this.preventMenuClose = false;
  });

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
    let timestamp =
      this.matrixService.getLastActiveTimestamp(
        this.args.session.roomId,
        this.args.session.lastActiveTimestamp,
      ) ?? this.createDate.getTime();
    // Guard against NaN timestamps (e.g. from sessions with corrupt/missing
    // origin_server_ts) to prevent RangeError in date-fns format()
    return isNaN(timestamp) ? Date.now() : timestamp;
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
