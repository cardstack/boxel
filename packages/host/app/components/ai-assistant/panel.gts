import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import HistoryIcon from '@cardstack/boxel-icons/history';
import PlusIcon from '@cardstack/boxel-icons/plus';
import XIcon from '@cardstack/boxel-icons/x';

import { restartableTask } from 'ember-concurrency';
import { Velcro } from 'ember-velcro';

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
          {{#let
            this.aiAssistantPanelService.loadingRooms
            as |pastSessionsLoading|
          }}
            <Button
              title='Past Sessions'
              class='button past-sessions-button
                {{if this.hasOtherActiveSessions "has-other-active-sessions"}}'
              @kind='text-only'
              @size='extra-small'
              @loading={{pastSessionsLoading}}
              @disabled={{this.aiAssistantPanelService.displayRoomError}}
              {{on 'click' this.aiAssistantPanelService.displayPastSessions}}
              data-test-past-sessions-button
              data-test-has-active-sessions={{this.hasOtherActiveSessions}}
            >
              {{#unless pastSessionsLoading}}
                <HistoryIcon />
              {{/unless}}
            </Button>
          {{/let}}
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
        --ai-assistant-panel-header-height: 4.5rem;
        --ai-assistant-panel-gradient-start-proportion: 0.6;
        --ai-assistant-panel-padding: var(--boxel-sp-sm);

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
        padding: var(--ai-assistant-panel-padding);

        display: grid;
        grid-template-columns: 20px auto 20px 20px 20px;
        gap: var(--boxel-sp-xxxs);

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
        margin: 0;
        padding-right: var(--boxel-sp-xl);
        padding-left: 2px;
        color: var(--boxel-light);
        font: 600 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
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
            var(--ai-assistant-panel-gradient-start-proportion) -
            var(--ai-assistant-panel-padding)
        );
        width: 100%;
      }

      .button {
        --boxel-button-text-color: var(--boxel-highlight);
        --boxel-button-padding: 1px 0;
        --boxel-button-min-width: 0;
        --boxel-button-min-height: 0;
        --boxel-loading-indicator-size: 16px;

        border-radius: var(--boxel-border-radius-xs);
        transform: translateY(-1px);
      }

      .button:hover {
        --boxel-button-text-color: var(--boxel-dark);

        background-color: var(--boxel-highlight);
      }

      .button[disabled] {
        --boxel-button-text-color: var(--boxel-400);

        background-color: transparent;
        border-color: transparent;
      }

      .button svg {
        width: 18px;
        height: 18px;
        stroke-width: 2.25;
      }

      /* This icon looks slightly bigger so this makes it match */
      .button.past-sessions-button svg {
        padding: 2px;
      }

      .button :deep(.loading-indicator) {
        margin-right: 0;
        padding-top: 1px;
      }

      .has-other-active-sessions {
        animation: cycle-color-to-background 1s ease-in infinite alternate;
      }

      .loading-new-session {
        margin: auto;
      }

      .room {
        padding-top: calc(var(--ai-assistant-panel-header-height) * 0.5);
      }

      @keyframes cycle-color-to-background {
        100% {
          color: color-mix(
            in oklab,
            var(--boxel-highlight),
            var(--boxel-ai-purple) 75%
          );
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
