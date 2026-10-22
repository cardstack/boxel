import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import HistoryIcon from '@cardstack/boxel-icons/history';
import { AgentMark } from '@cardstack/pretui/components/agent-mark';

import { restartableTask } from 'ember-concurrency';
import { modifier } from 'ember-modifier';
import { Velcro } from 'ember-velcro';

import type { ResizeHandle } from '@cardstack/boxel-ui/components';

import {
  ContextButton,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { cssVar, not } from '@cardstack/boxel-ui/helpers';

import type { ResolvedCodeRef } from '@cardstack/runtime-common';
import { aiBotUsername } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';

import type ToolService from '@cardstack/host/services/tool-service';

import NewSession from '../ai-assistant/new-session';
import AiAssistantPastSessionsList from '../ai-assistant/past-sessions';
import RenameSession from '../ai-assistant/rename-session';
import Room from '../matrix/room';
import DeleteModal from '../operator-mode/delete-modal';

import FallbackBanner from './fallback-banner';
import NewSessionButton from './new-session-button';

import type MatrixService from '../../services/matrix-service';
import type { MonacoSDK } from '../../services/monaco-service';
import type MonacoService from '../../services/monaco-service';
import type { WithBoundArgs } from '@glint/template';

const { matrixServerName } = ENV;
export const aiBotUserId = `@${aiBotUsername}:${matrixServerName}`;

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onClose: () => void;
    resizeHandle?: WithBoundArgs<
      typeof ResizeHandle,
      'groupId' | 'orientation' | 'registerResizeHandle'
    >;
    // show this room instead of the current one: the assistant board shows
    // several sessions side by side, each in a panel of its own
    roomId?: string;
    selectedCardRef?: ResolvedCodeRef;
  };
}

export default class AiAssistantPanel extends Component<Signature> {
  @tracked private copiedRoomId: string | null = null;
  @tracked private isFallbackBannerDismissed = false;
  @tracked private bannerBottomPx: number | undefined;

  <template>
    <Velcro
      @placement='bottom-end'
      @offsetOptions={{this.velcroOffsetOptions}}
      as |popoverVelcro|
    >
      <div
        class='ai-assistant-panel'
        {{! a card the assistant opens doesn't take focus from the panel }}
        data-holds-focus
        data-test-ai-assistant-panel
        data-test-room-has-messages={{if this.roomResource.messages true false}}
        data-test-room-is-empty={{if this.roomResource.messages false true}}
        style={{cssVar chat-top-clearance=this.chatTopClearanceCss}}
        data-assistant-room={{this.roomId}}
        ...attributes
      >
        {{#if @resizeHandle}}
          <@resizeHandle class='ai-assistant-panel-resize-handle' />
        {{/if}}
        <div class='panel-header-container'>
          <header class='panel-header'>
            {{! the assistant's own mark, still: the animated mark belongs to
                the cap by the message box alone, so the panel shows one
                thing working at a time }}
            <AgentMark
              class='panel-agent-mark'
              @working={{false}}
              @size={{20}}
              aria-label='AI Assistant'
              data-test-agent-mark={{if this.isAssistantWorking 'working'}}
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
                  {{if
                    this.hasOtherActiveSessions
                    "has-other-active-sessions"
                  }}'
                @icon={{HistoryIcon}}
                @label='Past Sessions'
                @size='extra-small'
                @variant='ghost'
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
              @variant='ghost'
              class='button'
              {{on 'click' @onClose}}
              data-test-close-ai-assistant
            />
          </header>

          {{#if this.shouldShowFallbackBanner}}
            <FallbackBanner
              @onDismiss={{this.dismissFallbackBanner}}
              {{this.measureBanner}}
            />
          {{/if}}
        </div>

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
            {{#if this.roomId}}
              <Room
                class='room'
                @roomId={{this.roomId}}
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
        --ai-assistant-menu-background: var(--boxel-650);
        --ai-assistant-menu-foreground: var(--boxel-light);
        --ai-assistant-menu-border: var(--boxel-light-25);
        --ai-assistant-menu-divider: var(--boxel-575);
        --ai-assistant-menu-hover-background: var(--boxel-700);
      }

      .ai-assistant-panel {
        /* Theme bridge: Pret UI components (StickToBottom, MarkdownStream,
           ToolRow, Thinking, DiffBlock…) read the kit's semantic tokens.
           The panel is dark, so map them onto Boxel values that read on
           --boxel-ai-purple; without this they fall back to light-theme
           literals. Everything Pret UI inside the panel inherits these. */
        /* the assistant visual system (pretui/docs/assistant-visual-
           system.md): a tested ink ladder, four states, four type sizes,
           a 4 px space scale and three radii. Components read these roles;
           this block is the Boxel dark theme's values for them. */
        /* ink-1 ≥ 12:1, ink-2 ≥ 7:1, ink-3 ≥ 4.5:1 at 11 px, on the panel,
           its cards and its insets */
        --foreground: #f7f8fa;
        --ink-2: #c9c4d6;
        --ink-3: #a8a2ba;
        --ai-assistant-ink: var(--foreground);
        --pretui-toolrow-settled-ink: var(--ink-2);
        --muted-foreground: var(--ink-2);
        --subtle-foreground: var(--ink-3);
        --state-live: var(--boxel-highlight);
        --state-attention: #f0b44c;
        --state-failed: #f07272;
        /* type: reading, UI, caption, heading, display, data */
        --type-read: 14px;
        --leading-read: 22px;
        --type-ui: 12.5px;
        --leading-ui: 18px;
        --type-caption: 11px;
        --leading-caption: 16px;
        --type-head: 17px;
        --leading-head: 24px;
        --type-display: 22px;
        --leading-display: 28px;
        --type-data: 12px;
        --leading-data: 18px;
        /* old names, for one release */
        --text-ui-xs: var(--type-caption);
        --text-ui-sm: var(--type-caption);
        --text-ui-md: var(--type-ui);
        --text-ui: var(--type-ui);
        /* space, radius, measure */
        --step-4: 4px;
        --step-8: 8px;
        --step-12: 12px;
        --step-16: 16px;
        --step-24: 24px;
        --step-32: 32px;
        --step-48: 48px;
        --round-chip: 4px;
        --round-row: 8px;
        --round-surface: 12px;
        --measure-read: 68ch;
        --card: color-mix(
          in oklch,
          var(--boxel-light) 6%,
          var(--boxel-ai-purple)
        );
        --inset: color-mix(
          in oklch,
          var(--boxel-light) 9%,
          var(--boxel-ai-purple)
        );
        --muted: var(--inset);
        --hover: color-mix(
          in oklch,
          var(--boxel-light) 12%,
          var(--boxel-ai-purple)
        );
        --border: color-mix(in oklch, var(--boxel-light) 10%, transparent);
        --border-strong: color-mix(
          in oklch,
          var(--boxel-light) 20%,
          transparent
        );
        --pretui-shadow-hairline: 0 0 0 1px var(--border);
        /* the card is darker than the inset here, so a segmented pill gets
           its own lighter face, and labels on a card face read light */
        --card-foreground: var(--foreground);
        --pretui-highlight-pill: color-mix(
          in oklch,
          var(--boxel-light) 18%,
          var(--boxel-ai-purple)
        );
        --pretui-seg-active-ink: var(--foreground);
        /* the reader's bubble takes the kit's default: it steps back on
           --inset with ink-1 text, not white */
        /* the assistant's own icon for Pret UI's AgentMark: still when
           settled, animated while it works */
        --pretui-agent-icon: image-set(
          url('./ai-assist-icon.webp') 1x,
          url('./ai-assist-icon@2x.webp') 2x,
          url('./ai-assist-icon@3x.webp') 3x
        );
        --pretui-agent-icon-working: url('./ai-assist-icon-animated.webp');
        --pretui-agent-glyph: '';
        /* the diff's code well: deeper than the panel, as the board draws it */
        --pretui-code-well: color-mix(
          in oklch,
          black 28%,
          color-mix(in oklch, var(--boxel-light) 6%, var(--boxel-ai-purple))
        );
        --ring: var(--boxel-highlight);
        --primary: var(--boxel-highlight);
        --pretui-primary-ink: var(--boxel-highlight);
        --pretui-link: var(--boxel-highlight);
        --success: var(--boxel-highlight);
        --success-ink: var(--boxel-highlight);
        --destructive: var(--boxel-danger);
        --pretui-destructive-ink: color-mix(
          in oklch,
          var(--boxel-danger) 55%,
          var(--boxel-light)
        );
        /* amber is the panel's one "needs you" colour: the row's gate, its
           ring and the composer cap's waiting dot all speak it; teal is
           spent only on the moment's one primary action */
        --pretui-attention: var(--state-attention);
        --pretui-attention-ink: var(--state-attention);
        /* the message box: a tinted light, raised on the dark panel, so it
           is the one thing that reads as "yours to write in"; its status is
           a dark cap on its top edge */
        --ai-composer-surface: color-mix(
          in oklch,
          var(--boxel-ai-purple) 5%,
          var(--boxel-light)
        );
        --ai-composer-well: color-mix(
          in oklch,
          var(--boxel-ai-purple) 12%,
          var(--boxel-light)
        );
        --ai-composer-cap-surface: color-mix(
          in oklch,
          var(--boxel-light) 9%,
          var(--boxel-ai-purple)
        );
        --ai-composer-cap-edge: color-mix(
          in oklch,
          var(--boxel-light) 16%,
          var(--boxel-ai-purple)
        );
        --ai-composer-attention: var(--pretui-attention);
        --font-mono: var(--boxel-monospace-font-family);
        --pretui-code-string: #a8e6a1;
        --pretui-code-number: #f7b07a;
        --pretui-code-keyword: #d7a6ff;
        --pretui-code-name: #8fc7ff;
        --pretui-code-comment: var(--boxel-450);

        --ai-assistant-panel-header-height: 4.5rem;
        --ai-assistant-panel-top-gradient-start-proportion: 0.6;
        /* the spine: the transcript's marks and text edge sit 16 in */
        --ai-assistant-panel-padding: var(--step-16, 16px);

        --ai-assistant-panel-bottom-gradient-height: var(--step-16, 16px);

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
      .panel-header-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        z-index: 10;
        display: flex;
        flex-direction: column;
        height: var(--ai-assistant-panel-header-height);

        background: var(--top-gradient-hidden);

        animation: ai-assistant-chat-gradient-scroll-timeline linear forwards;
        animation-timeline: --ai-assistant-chat-scroll-timeline;
      }

      .panel-header {
        padding: var(--ai-assistant-panel-padding);

        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) repeat(3, 1.75rem);
        align-items: center;
        gap: var(--boxel-sp-4xs);
        /* the header's actions are quiet: teal is spent on the moment's one
           primary action, down in the composer */
        color: #c9c4d6;
      }

      .panel-title-text {
        position: relative;
        margin: 0;
        padding-right: var(--boxel-sp-xl);
        padding-left: 2px;
        color: var(--boxel-light);
        font: 600 var(--boxel-font-sm);
        letter-spacing: 0;
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
        position: relative;
        width: 1.75rem;
        height: 1.75rem;
        border-radius: 0.5rem;
        color: inherit;
      }
      .button:hover,
      .button[aria-expanded='true'] {
        color: var(--boxel-light);
        background-color: color-mix(
          in oklch,
          var(--boxel-light) 10%,
          transparent
        );
      }
      .button :deep(svg) {
        stroke-width: 2;
      }
      .button :deep(.loading-icon) {
        width: 16px;
        height: 16px;
      }

      /* another session has news: a teal dot on Past Sessions, not a
         blinking icon */
      .has-other-active-sessions::after {
        content: '';
        position: absolute;
        top: 0.25rem;
        right: 0.25rem;
        width: 0.4375rem;
        height: 0.4375rem;
        border-radius: 50%;
        background: var(--boxel-highlight);
        box-shadow: 0 0 0 2px var(--boxel-ai-purple);
      }

      .loading-new-session {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
      }

      .room {
        padding-top: var(
          --chat-top-clearance,
          calc(var(--ai-assistant-panel-header-height) * 0.5)
        );
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

  @service declare private matrixService: MatrixService;
  @service declare private monacoService: MonacoService;
  @service declare private aiAssistantPanelService: AiAssistantPanelService;
  @service declare private toolService: ToolService;

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

  private get shouldShowFallbackBanner() {
    return (
      this.matrixService.isUsingFallbackSystemCard &&
      !this.isFallbackBannerDismissed
    );
  }

  private get chatTopClearanceCss() {
    return this.bannerBottomPx ? `${this.bannerBottomPx}px` : undefined;
  }

  // The banner is a flex child that can overflow its fixed-height container,
  // so its bottom y in the panel — not its height — is what the room must clear.
  private measureBanner = modifier((el: HTMLElement) => {
    let update = () => {
      this.bannerBottomPx = el.offsetTop + el.offsetHeight;
    };
    let ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.parentElement) {
      ro.observe(el.parentElement);
    }
    return () => {
      ro.disconnect();
      this.bannerBottomPx = undefined;
    };
  });

  @action
  private dismissFallbackBanner() {
    this.isFallbackBannerDismissed = true;
  }

  private get roomId() {
    return this.args.roomId ?? this.matrixService.currentRoomId;
  }

  // The assistant is answering, or a call it made is still running.
  private get isAssistantWorking() {
    let messages = this.roomResource?.messages ?? [];
    let last = messages[messages.length - 1];
    let streaming =
      last?.author.userId === aiBotUserId &&
      !last.isStreamingFinished &&
      !last.isCanceled;
    return Boolean(
      streaming || this.toolService.currentlyExecutingToolRequestIds.size,
    );
  }

  private get roomResource() {
    return this.roomId
      ? this.matrixService.roomResources.get(this.roomId)
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
      this.roomId &&
      this.maybeMonacoSDK &&
      !this.aiAssistantPanelService.loadingRooms &&
      this.aiAssistantPanelService.isCreateRoomIdle,
    );
  }
}
