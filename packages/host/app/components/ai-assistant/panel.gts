import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Velcro } from 'ember-velcro';

import {
  Button,
  IconButton,
  LoadingIndicator,
  ResizeHandle,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowFilled, IconX } from '@cardstack/boxel-ui/icons';

import { ResolvedCodeRef, aiBotUsername } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import CommandService from '../../services/command-service';
import { type MonacoSDK } from '../../services/monaco-service';
import NewSession from '../ai-assistant/new-session';
import AiAssistantPastSessionsList from '../ai-assistant/past-sessions';
import RenameSession from '../ai-assistant/rename-session';
import Room from '../matrix/room';
import DeleteModal from '../operator-mode/delete-modal';

import assistantIcon from './ai-assist-icon.webp';

import type MatrixService from '../../services/matrix-service';
import type MonacoService from '../../services/monaco-service';

const { matrixServerName } = ENV;
export const aiBotUserId = `@${aiBotUsername}:${matrixServerName}`;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onClose: () => void;
    resizeHandle: ResizeHandle;
    selectedCardRef?: ResolvedCodeRef;
  };
}

export default class AiAssistantPanel extends Component<Signature> {
  get hasOtherActiveSessions() {
    let oneMinuteAgo = new Date(Date.now() - 60 * 1000).getTime();

    return this.aiAssistantPanelService.aiSessionRooms
      .filter((session) => session.roomId !== this.roomResource?.roomId)
      .some((session) => {
        let isSessionActive = false;
        isSessionActive =
          this.matrixService.getLastActiveTimestamp(
            session.roomId,
            session.lastActiveTimestamp,
          ) > oneMinuteAgo;

        let lastMessageEventId = session.lastMessage?.eventId;

        let hasSeenLastMessage = lastMessageEventId
          ? this.matrixService.currentUserEventReadReceipts.has(
              lastMessageEventId,
            )
          : false;

        return isSessionActive && !hasSeenLastMessage;
      });
  }

  <template>
    <Velcro @placement='bottom' @offsetOptions={{-50}} as |popoverVelcro|>
      <div
        class='ai-assistant-panel'
        data-test-ai-assistant-panel
        data-test-room-has-messages={{if this.roomResource.messages true false}}
        data-test-room-is-empty={{if this.roomResource.messages false true}}
        ...attributes
      >
        <@resizeHandle />
        <header class='panel-header'>
          <div class='panel-title-group'>
            <img
              alt='AI Assistant'
              src={{assistantIcon}}
              width='20'
              height='20'
            />
            <h3 class='panel-title-text' data-test-chat-title>
              {{if this.roomResource.name this.roomResource.name 'Assistant'}}
            </h3>
          </div>
          <IconButton
            class='close-ai-panel'
            @variant='primary'
            @icon={{IconX}}
            @width='12px'
            @height='12px'
            {{on 'click' @onClose}}
            aria-label='Close AI Assistant'
            data-test-close-ai-assistant
          />
          <div class='header-buttons' {{popoverVelcro.hook}}>
            <Button
              class='new-session-button'
              @kind='secondary-dark'
              @size='small'
              @disabled={{not this.roomResource.messages.length}}
              {{on
                'click'
                (fn this.aiAssistantPanelService.createNewSession false)
              }}
              data-test-create-room-btn
            >
              New Session
            </Button>

            {{#if this.aiAssistantPanelService.loadingRooms}}
              <LoadingIndicator @color='var(--boxel-light)' />
            {{else}}
              <Button
                class='past-sessions-button
                  {{if
                    this.hasOtherActiveSessions
                    "past-sessions-button-active"
                  }}'
                @kind='secondary-dark'
                @size='small'
                @disabled={{this.aiAssistantPanelService.displayRoomError}}
                {{on 'click' this.aiAssistantPanelService.displayPastSessions}}
                data-test-past-sessions-button
                data-test-has-active-sessions={{this.hasOtherActiveSessions}}
              >
                All Sessions
                <DropdownArrowFilled width='10' height='10' />

              </Button>
            {{/if}}
          </div>
        </header>

        {{#if this.aiAssistantPanelService.isShowingPastSessions}}
          <AiAssistantPastSessionsList
            @sessions={{this.aiAssistantPanelService.aiSessionRooms}}
            @roomActions={{this.roomActions}}
            @onClose={{this.aiAssistantPanelService.hidePastSessions}}
            {{popoverVelcro.loop}}
          />
        {{else if this.aiAssistantPanelService.roomToRename}}
          <RenameSession
            @room={{this.aiAssistantPanelService.roomToRename}}
            @onClose={{this.aiAssistantPanelService.onCloseRename}}
            {{popoverVelcro.loop}}
          />
        {{/if}}

        {{#if this.aiAssistantPanelService.displayRoomError}}
          <div class='session-error'>
            <NewSession
              @errorAction={{this.aiAssistantPanelService.createNewSession}}
            />
          </div>
        {{else if this.isReady}}
          {{! below if statement is covered in 'isReady' check above but added due to glint not realizing it }}
          {{#if this.roomResource}}
            {{#if this.matrixService.currentRoomId}}
              <Room
                @roomId={{this.matrixService.currentRoomId}}
                @roomResource={{this.roomResource}}
                @monacoSDK={{this.monacoSDK}}
                @selectedCardRef={{@selectedCardRef}}
              />
            {{/if}}
          {{/if}}
        {{else}}
          <LoadingIndicator
            class='loading-new-session'
            @color='var(--boxel-light)'
          />
        {{/if}}
      </div>
    </Velcro>

    {{#if this.aiAssistantPanelService.roomToDelete}}
      <DeleteModal
        @itemToDelete={{this.aiAssistantPanelService.roomToDelete}}
        @onConfirm={{fn
          this.aiAssistantPanelService.leaveRoom
          this.aiAssistantPanelService.roomToDelete.id
        }}
        @onCancel={{fn this.aiAssistantPanelService.setRoomToDelete undefined}}
        @error={{this.aiAssistantPanelService.roomDeleteError}}
      >
        <:content>
          Delete the room
          <strong>{{this.aiAssistantPanelService.roomToDelete.name}}</strong>?
        </:content>
      </DeleteModal>
    {{/if}}

    <style scoped>
      .left-border {
        border-left: 1px solid var(--boxel-600);
      }

      .ai-assistant-panel {
        display: grid;
        grid-template-rows: auto 1fr;
        background-color: var(--boxel-ai-purple);
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
          var(--boxel-panel-resize-handle-width) +
            calc(var(--boxel-sp-xxxs) * 2)
        );
        position: absolute;
        left: 0;
        height: 100%;
      }
      :deep(.separator-horizontal:not(:hover) > button) {
        display: none;
      }
      :deep(.room-actions) {
        z-index: 1;
      }
      .panel-header {
        --panel-title-height: 40px;
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
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        /* the below font-smoothing options are only recommended for light-colored
          text on dark background (otherwise not good for accessibility) */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      .close-ai-panel {
        --icon-color: var(--boxel-highlight);
        position: absolute;
        right: var(--boxel-sp-xs);
        top: var(--boxel-sp);
        height: var(--panel-title-height);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
      }
      .close-ai-panel:hover:not(:disabled) {
        filter: brightness(1.1);
      }
      .header-buttons {
        position: relative;
        align-items: center;
        display: inline-flex;
        height: var(--panel-title-height);
      }
      .new-session-button {
        margin-right: var(--boxel-sp-xxxs);
      }
      .past-sessions-button svg {
        --icon-color: var(--boxel-light);
        margin-left: var(--boxel-sp-xs);
      }

      .past-sessions-button-active::before {
        content: '';
        position: absolute;
        top: -105px;
        left: -55px;
        width: 250px;
        height: 250px;
        background: conic-gradient(
          #ffcc8f 0deg,
          #ff3966 45deg,
          #ff309e 90deg,
          #aa1dc9 135deg,
          #d7fad6 180deg,
          #5fdfea 225deg,
          #3d83f2 270deg,
          #5145e8 315deg,
          #ffcc8f 360deg
        );
        z-index: -1;
        animation: spin 4s infinite linear;
      }

      .past-sessions-button-active::after {
        content: '';
        position: absolute;
        top: 1px;
        left: 1px;
        right: 1px;
        bottom: 1px;
        background: var(--boxel-700);
        border-radius: inherit;
        z-index: -1;
      }

      .past-sessions-button-active {
        position: relative;
        display: inline-block;
        border-radius: 3rem;
        color: white;
        background: var(--boxel-700);
        border: none;
        cursor: pointer;
        z-index: 1;
        overflow: hidden;
      }

      .loading-new-session {
        margin: auto;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .session-error {
        padding: 0 var(--boxel-sp);
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @service private declare monacoService: MonacoService;
  @service private declare router: RouterService;
  @service private declare commandService: CommandService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare aiAssistantPanelService: AiAssistantPanelService;

  @tracked private maybeMonacoSDK: MonacoSDK | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadMonaco.perform();
  }

  @cached
  private get roomResources() {
    return this.matrixService.roomResources;
  }

  private get roomResource() {
    return this.matrixService.currentRoomId
      ? this.roomResources.get(this.matrixService.currentRoomId)
      : undefined;
  }

  private get roomActions() {
    return {
      open: this.aiAssistantPanelService.enterRoom,
      rename: this.aiAssistantPanelService.setRoomToRename,
      delete: this.aiAssistantPanelService.setRoomToDelete,
    };
  }

  private loadMonaco = restartableTask(async () => {
    this.maybeMonacoSDK = await this.monacoService.getMonacoContext();
  });

  private get monacoSDK() {
    if (this.maybeMonacoSDK) {
      return this.maybeMonacoSDK;
    }
    throw new Error(`cannot use monaco SDK before it has loaded`);
  }

  private get isReady() {
    return Boolean(
      this.matrixService.currentRoomId &&
        this.maybeMonacoSDK &&
        !this.aiAssistantPanelService.loadingRooms &&
        this.aiAssistantPanelService.isCreateRoomIdle,
    );
  }
}
