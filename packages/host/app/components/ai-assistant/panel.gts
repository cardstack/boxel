import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Velcro } from 'ember-velcro';

import HistoryIcon from '@cardstack/boxel-icons/history';
import PlusIcon from '@cardstack/boxel-icons/plus';
import XIcon from '@cardstack/boxel-icons/x';

import {
  Button,
  LoadingIndicator,
  ResizeHandle,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

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
          <img
            alt='AI Assistant'
            src={{assistantIcon}}
            width='20'
            height='20'
          />
          {{#let
            (if this.roomResource.name this.roomResource.name 'Assistant')
            as |title|
          }}
            <h3 title={{title}} class='panel-title-text' data-test-chat-title>
              {{title}}
            </h3>
          {{/let}}
          <Button
            title='New Session'
            class='button new-session-button'
            @kind='text-only'
            @size='extra-small'
            @disabled={{not this.roomResource.messages.length}}
            {{on
              'click'
              (fn this.aiAssistantPanelService.createNewSession false)
            }}
            data-test-create-room-btn
          >
            <PlusIcon />
          </Button>
          {{#if this.aiAssistantPanelService.loadingRooms}}
            <LoadingIndicator @color='var(--boxel-light)' />
          {{else}}
            <Button
              title='Past Sessions'
              class='button past-sessions-button
                {{if
                  this.hasOtherActiveSessions
                  "past-sessions-button-active"
                }}'
              @kind='text-only'
              @size='extra-small'
              @disabled={{this.aiAssistantPanelService.displayRoomError}}
              {{on 'click' this.aiAssistantPanelService.displayPastSessions}}
              data-test-past-sessions-button
              data-test-has-active-sessions={{this.hasOtherActiveSessions}}
            >
              <HistoryIcon />
            </Button>
          {{/if}}
          <Button
            title='Close AI Assistant'
            class='button'
            @kind='text-only'
            @size='extra-small'
            {{on 'click' @onClose}}
            data-test-close-ai-assistant
          >
            <XIcon />
          </Button>
        </header>

        {{#if this.aiAssistantPanelService.isShowingPastSessions}}
          <AiAssistantPastSessionsList
            @sessions={{this.aiAssistantPanelService.aiSessionRooms}}
            @currentRoomId={{this.matrixService.currentRoomId}}
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
                class='room'
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
        --ai-assistant-panel-header-height: 3.5rem;
        --ai-assistant-panel-gradient-start-proportion: 0.6;

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
        position: absolute;
        width: 100%;
        height: var(--ai-assistant-panel-header-height);
        padding: var(--boxel-sp-xs) var(--boxel-sp);

        display: grid;
        grid-template-columns: 20px auto 22px 22px 22px;
        gap: var(--boxel-sp-xxs);

        z-index: 10;
        background: linear-gradient(
          to bottom,
          var(--boxel-ai-purple),
          var(--boxel-ai-purple)
            calc(var(--ai-assistant-panel-gradient-start-proportion) * 100%),
          transparent 100%
        );
      }

      .panel-title-text {
        position: relative;
        top: -1px;
        margin: 0;
        padding-right: var(--boxel-sp-xl);
        color: var(--boxel-light);
        font: 600 var(--boxel-font);
        letter-spacing: var(--boxel-lsp);
        overflow: hidden;
        white-space: nowrap;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        /* the below font-smoothing options are only recommended for light-colored
          text on dark background (otherwise not good for accessibility) */
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      .panel-title-text:after {
        content: '';
        background: linear-gradient(
          to right,
          transparent,
          transparent 80%,
          var(--boxel-ai-purple) 98%
        );
        display: block;
        top: 0;
        inset-block-end: 0;
        position: absolute;
        height: calc(
          var(--ai-assistant-panel-header-height) *
            (var(--ai-assistant-panel-gradient-start-proportion)) -
            var(--boxel-sp-xs)
        );
        width: 100%;
      }

      .button {
        --boxel-button-text-color: var(--boxel-highlight);
        --boxel-button-padding: 2px;
        --boxel-button-min-width: 0;

        border-radius: var(--boxel-border-radius-xs);
      }

      .button:hover {
        --boxel-button-text-color: var(--boxel-dark);

        background-color: var(--boxel-highlight);
      }

      .button svg {
        width: 18px;
        height: 18px;
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

      .room {
        padding-top: calc(var(--ai-assistant-panel-header-height) * 0.5);
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
