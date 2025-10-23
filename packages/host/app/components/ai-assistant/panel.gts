import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked, cached } from '@glimmer/tracking';

import HistoryIcon from '@cardstack/boxel-icons/history';

import { restartableTask } from 'ember-concurrency';
import { Velcro } from 'ember-velcro';

import {
  ContextButton,
  LoadingIndicator,
  ResizeHandle,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import { ResolvedCodeRef, aiBotUsername } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';

import { type MonacoSDK } from '../../services/monaco-service';
import NewSession from '../ai-assistant/new-session';

import AiAssistantPastSessionsList from '../ai-assistant/past-sessions';
import RenameSession from '../ai-assistant/rename-session';
import Room from '../matrix/room';
import DeleteModal from '../operator-mode/delete-modal';

import assistantIcon from './ai-assist-icon.webp';
import NewSessionButton from './new-session-button';

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
  @tracked private copiedRoomId: string | null = null;

  <template>
    <Velcro
      @placement='bottom-end'
      @offsetOptions={{this.velcroOffsetOptions}}
      as |popoverVelcro|
    >
      <div
        class='ai-assistant-panel'
        data-test-ai-assistant-panel
        data-test-room-has-messages={{if this.roomResource.messages true false}}
        data-test-room-is-empty={{if this.roomResource.messages false true}}
        ...attributes
      >
        <@resizeHandle class='ai-assistant-panel-resize-handle' />
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
          <NewSessionButton
            @disabled={{not this.roomResource.messages.length}}
            @onCreateNewSession={{this.aiAssistantPanelService.createNewSession}}
          />
          {{#let
            this.aiAssistantPanelService.loadingRooms
            as |pastSessionsLoading|
          }}
            <ContextButton
              title='Past Sessions'
              class='button past-sessions-button
                {{if this.hasOtherActiveSessions "has-other-active-sessions"}}'
              @icon={{HistoryIcon}}
              @label='Past Sessions'
              @size='extra-small'
              @variant='highlight-icon'
              @width='14'
              @height='14'
              @loading={{pastSessionsLoading}}
              @disabled={{this.aiAssistantPanelService.displayRoomError}}
              {{on 'click' this.aiAssistantPanelService.displayPastSessions}}
              data-test-past-sessions-button
              data-test-has-active-sessions={{this.hasOtherActiveSessions}}
              aria-expanded='{{this.aiAssistantPanelService.isShowingPastSessions}}'
            />
          {{/let}}
          <ContextButton
            title='Close AI Assistant'
            @icon='close'
            @size='extra-small'
            @width='18'
            @height='18'
            @label='close ai assistant'
            @variant='highlight-icon'
            class='button'
            {{on 'click' @onClose}}
            data-test-close-ai-assistant
          />
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
      :global(:root) {
        --ai-assistant-menu-background: #4f4b57;
        --past-sessions-divider-color: #75707e;
        --ai-assistant-menu-hover-background: #797788;
      }

      .left-border {
        border-left: 1px solid var(--boxel-600);
      }

      .ai-assistant-panel {
        --ai-assistant-panel-header-height: 4.5rem;
        --ai-assistant-panel-top-gradient-start-proportion: 0.6;
        --ai-assistant-panel-padding: var(--boxel-sp-sm);

        --ai-assistant-panel-bottom-gradient-height: var(--boxel-sp-xl);

        --top-gradient-hidden: linear-gradient(
          to bottom,
          transparent,
          transparent
            calc(var(--ai-assistant-panel-top-gradient-start-proportion) * 100%),
          transparent 100%
        );

        --top-gradient-showing: linear-gradient(
          to bottom,
          var(--boxel-ai-purple),
          var(--boxel-ai-purple)
            calc(var(--ai-assistant-panel-top-gradient-start-proportion) * 100%),
          transparent 100%
        );

        background-color: var(--boxel-ai-purple);
        border-radius: 0;
        color: var(--boxel-light);
        height: 100%;
        position: relative;

        timeline-scope: --ai-assistant-chat-scroll-timeline;
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
        background: var(--top-gradient-hidden);

        animation: ai-assistant-chat-gradient-scroll-timeline linear forwards;
        animation-timeline: --ai-assistant-chat-scroll-timeline;
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
            var(--ai-assistant-panel-top-gradient-start-proportion) -
            var(--ai-assistant-panel-padding)
        );
        width: 100%;
      }

      .button {
        --host-outline-offset: 2px;
        transform: translateY(-1px);
      }
      .button :deep(svg) {
        stroke-width: 2.5;
      }
      .button :deep(.loading-icon) {
        width: 16px;
        height: 16px;
      }

      .has-other-active-sessions {
        animation: cycle-color-to-background 1s ease-in infinite alternate;
      }

      .loading-new-session {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
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
        padding: var(--ai-assistant-panel-padding);
      }

      .session-error :deep(.intro) {
        margin-top: calc(var(--ai-assistant-panel-header-height) * 0.5);
      }

      .ai-assistant-panel-resize-handle {
        z-index: calc(var(--host-ai-panel-z-index) + 1);
      }

      @keyframes ai-assistant-chat-gradient-scroll-timeline {
        0% {
          background: var(--top-gradient-hidden);
        }

        1% {
          background: var(--top-gradient-showing);
        }

        100% {
          background: var(--top-gradient-showing);
        }
      }
    </style>
  </template>

  @service private declare matrixService: MatrixService;
  @service private declare monacoService: MonacoService;
  @service private declare aiAssistantPanelService: AiAssistantPanelService;

  @tracked private maybeMonacoSDK: MonacoSDK | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.loadMonaco.perform();
  }

  get velcroOffsetOptions() {
    return {
      mainAxis: 10,
      crossAxis: 50,
    };
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
      copyRoomId: (roomId: string) => this.copyRoomIdTask.perform(roomId),
      getCopiedRoomId: () => this.copiedRoomId,
    };
  }

  private copyRoomIdTask = restartableTask(async (roomId: string) => {
    await navigator.clipboard.writeText(roomId);
    this.copiedRoomId = roomId;
    setTimeout(() => {
      this.copiedRoomId = null;
    }, 2000);
  });

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
