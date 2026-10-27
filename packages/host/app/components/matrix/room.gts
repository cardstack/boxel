import {
  isDestroyed,
  isDestroying,
  registerDestructor,
} from '@ember/destroyable';
import { fn } from '@ember/helper';
import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { schedule, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { ContextRing } from '@cardstack/pretui/components/context-ring';
import { JumpChip } from '@cardstack/pretui/components/jump-chip';
import { SessionPrep } from '@cardstack/pretui/components/session-prep';

import {
  enqueueTask,
  restartableTask,
  timeout,
  all,
  task,
} from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';
import { motion } from 'glimmer-motion';
import { max } from 'lodash-es';

import pluralize from 'pluralize';

import { TrackedObject, TrackedMap, TrackedSet } from 'tracked-built-ins';

import { v4 as uuidv4 } from 'uuid';

import {
  Alert,
  BoxelButton,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';
import { and, eq, not } from '@cardstack/boxel-ui/helpers';

import type {
  RealmResourceIdentifier,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  baseFileRef,
  formattedError,
  type getCard,
  GetCardContextName,
  inferContentType,
  internalKeyFor,
  isCardInstance,
  resolveFileDefCodeRef,
  stringifyErrorForLog,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { AI_BOT_EXECUTOR } from '@cardstack/runtime-common/commands';
import { LOCAL_SOURCE_URL_PREFIX } from '@cardstack/runtime-common/matrix-constants';
import type { Query } from '@cardstack/runtime-common/query';

import ENV from '@cardstack/host/config/environment';

import { isAskUserTool } from '@cardstack/host/lib/ask-user';
import type { FileUploadState } from '@cardstack/host/lib/file-upload-state';
import {
  formatCredits,
  formatTokenUsage,
} from '@cardstack/host/lib/format-token-usage';
import type { Message } from '@cardstack/host/lib/matrix-classes/message';
import {
  modelIdsOf,
  pickableModels,
} from '@cardstack/host/lib/pickable-models';
import { STOPPED_BY_USER } from '@cardstack/host/lib/realm-runner/types';
import type { StackItem } from '@cardstack/host/lib/stack-item';
import { isAutoExecutableTool } from '@cardstack/host/lib/tool-auto-execute';
import { plainTitle } from '@cardstack/host/lib/tool-title';
import {
  turnSummary,
  type AnswerFooterData,
  type TurnHead,
  type TurnPlace,
  type ReasoningMode,
  type TurnFold,
} from '@cardstack/host/lib/turn-summary';
import { getAutoAttachment } from '@cardstack/host/resources/auto-attached-card';
import { isReady } from '@cardstack/host/resources/file';
import type { RoomResource } from '@cardstack/host/resources/room';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type CardService from '@cardstack/host/services/card-service';
import type FileUploadService from '@cardstack/host/services/file-upload';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type RealmService from '@cardstack/host/services/realm';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import type StoreService from '@cardstack/host/services/store';
import type ToolService from '@cardstack/host/services/tool-service';
import UpdateRoomSkillsTool from '@cardstack/host/tools/update-room-skills';
import { FileDefAttributesExtractor } from '@cardstack/host/utils/file-def-attributes-extractor';

import { errorJsonApiToErrorEntry } from '../../lib/window-error-handler';

import AiAssistantAttachmentPicker from '../ai-assistant/attachment-picker';
import AiAssistantChatInput from '../ai-assistant/chat-input';
import AiAssistantComposerCap from '../ai-assistant/composer-cap';
import FocusPill from '../ai-assistant/focus-pill';
import LLMModeToggle from '../ai-assistant/llm-mode-toggle';
import LLMSelect, { type LLMOption } from '../ai-assistant/llm-select';
import {
  AiAssistantConversation,
  type ConversationNavigate,
} from '../ai-assistant/message';
import { ComposerMotion } from '../ai-assistant/motion/composer-motion';
import NewSession from '../ai-assistant/new-session';
import AiAssistantSkillMenu from '../ai-assistant/skill-menu';

import { Submodes } from '../submode-switcher';

import RoomMessage from './room-message';

import type RoomData from '../../lib/matrix-classes/room';
import type { RoomSkill } from '../../resources/room';
import type { Gate } from '../ai-assistant/composer-cap';
import type { CardDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';
import type { SessionPrepStep } from '@cardstack/pretui/components/session-prep';
import type { ToolPlanStep as TaskStep } from '@cardstack/pretui/components/tool-plan';
import type { MatrixEvent } from 'matrix-js-sdk';

interface Signature {
  Element: HTMLElement;
  Args: {
    roomId: string;
    roomResource: RoomResource;
    monacoSDK: MonacoSDK;
    selectedCardRef?: ResolvedCodeRef;
  };
}

interface RoomScrollState {
  messageElements: Map<HTMLElement, number>;
  messageScrollers: Map<number, Element['scrollIntoView']>;
  messageVisibilityObserver: IntersectionObserver;
  isScrolledToBottom: boolean;
  userHasScrolled: boolean;
  isConversationScrollable: boolean;
}

// how long the action bar stays after the loop looks idle
// how long the cap holds through a gap between two phases: between one
// call's result and the next answer the loop reads as idle for a few hundred
// milliseconds, and a cap that left and came back would jump the transcript
const CAP_HOLD_MS = 1000;
// the slot's close transition plus a frame or two, in case transitionend
// never comes (reduced motion, a hidden tab)
const CAP_CLOSE_FALLBACK_MS = 400;
// how long the reader must be left behind before "new messages" shows
const UNREAD_SETTLE_MS = 400;
// how long a question or approval waits before the cap points back to it
const POINTER_SETTLE_MS = 2000;
// how long a turn waits for the bot's answer to its last calls' results
// before it settles anyway: a bot that never answers must not leave the turn
// working forever
const CONTINUATION_WAIT_MS = 30_000;
// a turn whose results are older than this on the browser's clock settles at
// once: a session reopened later, far past any skew between the browser's
// and the homeserver's clocks
const CONTINUATION_STALE_MS = 10 * 60_000;

interface CapState {
  gates: Gate[];
  gateBusy: boolean;
  gateBusyLabel: string | undefined;
  working: boolean;
  workingLabel: string;
  stopping: boolean;
  workingCalls: number;
  waitingDecisions: number;
  plan: { steps: TaskStep[]; activity?: string } | undefined;
}

export default class Room extends Component<Signature> {
  <template>
    {{#if (not this.doMatrixEventFlush.isRunning)}}
      <section
        class='room'
        data-room-settled={{and
          this.doWhenRoomChanges.isIdle
          (not this.matrixService.isLoadingTimeline)
        }}
        data-test-room-settled={{and
          this.doWhenRoomChanges.isIdle
          (not this.matrixService.isLoadingTimeline)
        }}
        data-test-room-name={{@roomResource.name}}
        data-test-room={{@roomId}}
        data-room-id={{@roomId}}
        {{this.watchOpenGates}}
        ...attributes
      >
        <AiAssistantConversation
          @registerConversationScroller={{this.registerConversationScroller}}
          @setScrollPosition={{this.setScrollPosition}}
          @isStreaming={{this.generatingResults}}
          @revision={{this.transcriptRevision}}
          @ready={{and
            (not this.matrixService.isLoadingTimeline)
            (not this.aiAssistantPanelService.isPreparingSession)
          }}
        >
          {{#if this.matrixService.isLoadingTimeline}}
            <div class='session-preparation-container'>
              <LoadingIndicator
                @color='var(--boxel-light)'
                class='loading-indicator'
              />
            </div>
          {{else if this.aiAssistantPanelService.isPreparingSession}}
            <SessionPrep
              class='session-prep'
              @steps={{this.sessionPrepSteps}}
              @note='Please keep Assistant open · Takes 10-20 seconds'
              @onSkip={{this.skipSessionPreparation}}
              @skipLabel='Skip'
              data-test-session-preparation
            />
          {{else}}
            {{#each this.messages key='eventId' as |message i|}}
              {{#unless (this.isFoldedMessage i)}}
                <RoomMessage
                  @roomId={{@roomId}}
                  @roomResource={{@roomResource}}
                  @message={{message}}
                  @index={{i}}
                  @isMostRecentMessage={{this.isLastMessage i}}
                  @registerScroller={{this.registerMessageScroller}}
                  @unregisterScroller={{this.unregisterMessageScroller}}
                  @isPending={{this.isPendingMessage message}}
                  @monacoSDK={{@monacoSDK}}
                  @isStreaming={{this.isMessageStreaming message}}
                  @inLatestTurn={{this.isInLatestTurn i}}
                  @retryAction={{this.maybeRetryAction i message}}
                  @foldCount={{this.foldCountFor i}}
                  @turnFold={{this.turnFoldFor i}}
                  @answerFooter={{this.answerFooterFor i}}
                  @turnHead={{this.turnHeadFor i}}
                  @reasoningMode={{this.reasoningModeFor i}}
                  data-test-message-idx={{i}}
                />
              {{/unless}}
            {{else}}
              <NewSession @sendPrompt={{this.sendMessage}} />
            {{/each}}

            {{#if this.shouldShowUnknownMessageSendError}}
              <Alert @type='error' as |Alert|>
                <Alert.Messages
                  @messages={{array this.unknownMessageSendError}}
                />
              </Alert>
            {{/if}}

          {{/if}}
        </AiAssistantConversation>

        <footer class='room-actions'>
          <AiAssistantAttachmentPicker
            @autoAttachedCardIds={{this.autoAttachedCardIds}}
            @cardIdsToAttach={{this.cardIdsToAttach}}
            @chooseCard={{this.chooseCard}}
            @removeCard={{this.removeCard}}
            @chooseFile={{perform this.chooseFileTask}}
            @chooseLocalFile={{perform this.chooseLocalFileTask}}
            @removeFile={{this.removeFile}}
            @autoAttachedFiles={{this.autoAttachedFiles}}
            @filesToAttach={{this.filesToAttach}}
            @fileUploadStates={{this.fileUploadStates}}
            @retryFileUpload={{this.retryFileUpload}}
            @inputModalities={{@roomResource.activeInputModalities}}
            @autoAttachedCardTooltipMessage={{if
              (eq this.operatorModeStateService.state.submode Submodes.Code)
              'Current card is shared automatically'
              'Topmost card is shared automatically'
            }}
            as |AttachedItems AttachButton|
          >
            {{this.holdCap this.capWanted}}
            {{this.settleUnread this.showUnreadIndicator}}
            {{! the composer's motion: the chip, the cap and the box are one
                scene (motion/composer-motion.gts); they only declare who
                they are here }}
            <ComposerMotion class='composer-stack'>
              {{! "new messages" is about the transcript, not about what the
                  assistant does now: it floats above the cap }}
              {{#if this.unreadChipShown}}
                <div class='unread-jump-row' {{motion id='unread' role='chip'}}>
                  <JumpChip
                    class='unread-jump'
                    @visible={{true}}
                    @count={{this.numberOfUnreadMessages}}
                    @label={{this.unreadMessageText}}
                    @onJump={{this.jumpToNew}}
                    data-test-unread-messages-button
                  />
                </div>
              {{/if}}
              {{! the cap on the composer's top edge: one status, the most
                  urgent (a decision, then work, then waiting) }}
              {{#if this.capSlotRendered}}
                {{! the cap's slot closes, not the cap: when the turn's work
                    ends its height goes to nothing over a beat, and the
                    transcript follows it down as one glide instead of
                    dropping when the cap leaves the layout (ADR 013 §1.14) }}
                <div
                  class='cap-slot'
                  data-closed={{unless this.showsCap 'true'}}
                  inert={{unless this.showsCap true}}
                  {{on 'transitionend' this.capSlotClosed}}
                  {{this.openCapSlot}}
                >
                  <div class='cap-slot-inner'>
                    {{#let (this.capShown this.capState) as |cap|}}
                      <AiAssistantComposerCap
                        {{motion id='composer-cap' role='cap'}}
                        @gates={{cap.gates}}
                        @gateBusy={{cap.gateBusy}}
                        @gateBusyLabel={{cap.gateBusyLabel}}
                        @working={{cap.working}}
                        @workingLabel={{cap.workingLabel}}
                        @stop={{perform this.stopGeneratingTask}}
                        @stopping={{cap.stopping}}
                        @workingCalls={{cap.workingCalls}}
                        @waitingDecisions={{cap.waitingDecisions}}
                        @plan={{cap.plan}}
                      />
                    {{/let}}
                  </div>
                </div>
              {{/if}}
              <div
                class='chat-input-area'
                data-test-chat-input-area
                data-drop-zone-active={{this.isDropZoneActive}}
                {{on 'dragover' this.handleChatInputDragOver}}
                {{on 'dragenter' this.handleChatInputDragEnter}}
                {{on 'dragleave' this.handleChatInputDragLeave}}
                {{on 'drop' this.handleChatInputDrop}}
                data-theme='light'
              >
                {{#if this.isDropZoneActive}}
                  <div
                    class='chat-input-drop-hint'
                    data-test-chat-input-drop-hint
                  >
                    Drop file to attach
                  </div>
                {{/if}}
                <AiAssistantChatInput
                  @attachButton={{AttachButton}}
                  @value={{this.messageToSend}}
                  @onInput={{this.setMessage}}
                  @onSend={{this.sendMessage}}
                  @onPaste={{this.handleChatInputPaste}}
                  @canSend={{this.canSend}}
                  @isSending={{this.isSending}}
                  data-test-message-field={{@roomId}}
                />
                {{#if this.aiAssistantPanelService.isFocusPillVisible}}
                  <FocusPill
                    @label={{this.aiAssistantPanelService.focusPillLabel}}
                    @metaPills={{this.aiAssistantPanelService.focusPillMetaPills}}
                    class='pill-row'
                  />
                {{/if}}
                {{#if this.displayAttachedItems}}
                  <AttachedItems class='pill-row' />
                {{/if}}

                <div class='chat-input-area__bottom-actions'>
                  {{#if this.displayLLMSelect}}
                    <LLMSelect
                      class='llm-select'
                      @selected={{@roomResource.activeLLM}}
                      @onChange={{perform @roomResource.activateLLMTask}}
                      @options={{this.llmsForSelectMenu}}
                      @disabled={{@roomResource.isActivatingLLM}}
                      @onExpand={{fn this.setSelectedBottomAction 'llm-select'}}
                      @onCollapse={{fn this.setSelectedBottomAction undefined}}
                    >
                      <:menuActions>
                        {{#if this.systemCardId}}
                          <BoxelButton
                            @kind='secondary'
                            @size='extra-small'
                            @pill={{true}}
                            class='llm-select-footer-action'
                            {{on 'click' this.goToSystemCard}}
                            data-test-go-to-system-card
                          >
                            Go to Current System Card
                          </BoxelButton>
                        {{/if}}
                        {{#unless this.isDefaultSystemCard}}
                          <BoxelButton
                            @kind='secondary'
                            @size='extra-small'
                            @pill={{true}}
                            class='llm-select-footer-action'
                            {{on
                              'click'
                              (perform this.restoreDefaultSystemCardTask)
                            }}
                            data-test-restore-default-system-card
                          >
                            Restore Default System Card
                          </BoxelButton>
                        {{/unless}}
                      </:menuActions>
                    </LLMSelect>
                  {{/if}}
                  {{#if this.displaySkillMenu}}
                    <AiAssistantSkillMenu
                      class='skill-menu'
                      @skills={{this.sortedSkills}}
                      @onChooseCard={{perform this.attachSkillTask}}
                      @onChooseSkillMarkdown={{perform this.attachSkillTask}}
                      @onUpdateSkillIsActive={{perform
                        this.updateSkillIsActiveTask
                      }}
                      @onExpand={{fn this.setSelectedBottomAction 'skill-menu'}}
                      @onCollapse={{fn this.setSelectedBottomAction undefined}}
                      data-test-skill-menu
                    />
                  {{/if}}
                  {{#if this.shownContextFullness}}
                    {{! Pret UI's ContextRing: how full the model's context is,
                      warning in the attention colour from 80%; it steps aside
                      with the model picker while a menu is open }}
                    <ContextRing
                      class='context-fullness'
                      @used={{this.shownContextFullness.used}}
                      @limit={{this.shownContextFullness.limit}}
                      data-level={{this.shownContextFullness.level}}
                      data-test-context-fullness
                    />
                  {{/if}}
                  {{#if this.displayLLMModeSelect}}
                    <LLMModeToggle
                      class='llm-mode-toggle'
                      @selected={{@roomResource.activeLLMMode}}
                      @onChange={{perform @roomResource.activateLLMModeTask}}
                      @disabled={{@roomResource.isActivatingLLMMode}}
                    />
                  {{/if}}
                </div>
              </div>
            </ComposerMotion>
          </AiAssistantAttachmentPicker>
        </footer>
      </section>
    {{/if}}

    <style scoped>
      .room {
        display: grid;
        grid-template-rows: minmax(0, 1fr) auto;
        height: 100%;
        /* clip, not hidden: a hidden box can still be scrolled by a
           scrollIntoView or a focus inside it, which slid the whole room,
           header and composer, up the panel */
        overflow: clip;
        position: relative;

        /* the message box is a surface: the surface radius */
        --chat-input-area-border-radius: var(--round-surface, 12px);
      }
      .room-actions {
        position: relative;
        min-width: 0;
        padding: 0 var(--ai-assistant-panel-padding)
          var(--ai-assistant-panel-padding);
        box-shadow: var(--boxel-box-shadow);
      }

      .room-actions::before {
        content: '';
        position: absolute;

        width: 100%;
        height: calc(
          var(--ai-assistant-panel-bottom-gradient-height) +
            var(--chat-input-area-border-radius)
        );
        left: 0;
        bottom: calc(100% - var(--chat-input-area-border-radius));

        background: linear-gradient(
          to top,
          var(--boxel-ai-purple),
          var(--boxel-ai-purple) 20%,
          transparent 100%
        );

        z-index: 0;
      }

      /* the cap's slot: a one-row grid whose row closes from the cap's
         height to nothing, so the box below and the transcript above move
         together over the beat. Clipped top and bottom only, so the cap's
         edge ring still shows at its sides */
      .cap-slot {
        display: grid;
        grid-template-rows: 1fr;
        /* the box rises over the cap's tuck; the tuck closes with the slot,
           so the box never sits over the transcript */
        margin-bottom: calc(-1 * var(--step-12, 12px));
        transition:
          grid-template-rows var(--pretui-dur-move, 260ms)
            cubic-bezier(0.3, 0.1, 0.3, 1),
          margin-bottom var(--pretui-dur-move, 260ms)
            cubic-bezier(0.3, 0.1, 0.3, 1);
      }
      .cap-slot[data-closed] {
        grid-template-rows: 0fr;
        margin-bottom: 0;
      }
      /* it opens the same way, from openCapSlot */
      .cap-slot-inner {
        min-height: 0;
        overflow-x: visible;
        overflow-y: clip;
        padding-top: 1px;
        margin-top: -1px;
      }
      .cap-slot-inner > :deep(*) {
        transition: opacity var(--pretui-dur-snap, 140ms) ease-out;
      }
      .cap-slot[data-closed] .cap-slot-inner > :deep(*) {
        opacity: 0;
      }
      @media (prefers-reduced-motion: reduce) {
        .cap-slot,
        .cap-slot-inner > :deep(*) {
          transition: none;
        }
      }
      .chat-input-area {
        --boxel-pill-menu-header-padding: 0;
        --boxel-pill-menu-content-padding: var(--boxel-sp) 0;
        --boxel-pill-menu-footer-padding: 0;
        --boxel-pill-menu-button-padding: 2px 6px;

        --chat-input-area-bottom-padding: var(--step-12, 12px);

        /* a tinted light, not white: raised on the dark panel, it is the
           one thing that reads as "yours to write in" without glaring */
        background-color: var(--ai-composer-surface, var(--boxel-light));
        color: var(--boxel-dark);
        border-radius: var(--chat-input-area-border-radius);
        box-shadow:
          0 0.625rem 1.875rem rgb(0 0 0 / 45%),
          0 0 0 1px rgb(255 255 255 / 8%);

        position: relative;
        z-index: 2;

        timeline-scope: --chat-input-scroll-timeline;
      }
      .chat-input-area[data-drop-zone-active='true'] {
        box-shadow: inset 0 0 0 2px var(--boxel-dark);
        background-color: #e8f0ff;
      }
      .chat-input-drop-hint {
        position: absolute;
        top: var(--boxel-sp-xs);
        right: var(--boxel-sp-xs);
        bottom: var(--boxel-sp-xs);
        left: var(--boxel-sp-xs);
        z-index: 3;
        pointer-events: none;
        color: var(--boxel-light-100);
        font-family: var(--boxel-font-family);
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        font-weight: 600;
        background-color: var(--boxel-darker-hover);
        border-radius: var(--round-row, 8px);
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .chat-input-area__bottom-actions {
        display: flex;
        align-items: center;
        padding: var(--chat-input-area-bottom-padding);
        gap: var(--boxel-sp-2xs);
        background-color: transparent;
        border-bottom-left-radius: var(--chat-input-area-border-radius);
        border-bottom-right-radius: var(--chat-input-area-border-radius);
      }

      .chat-input-area__bottom-actions > .llm-select {
        flex-shrink: 1;
      }

      .chat-input-area__bottom-actions:not(:has(.menu-content)) {
        height: 40px;
      }

      .chat-input-area__bottom-actions:has(.menu-content) {
        padding: 0;
      }

      .pill-row {
        margin: var(--boxel-sp-xxxs);
      }

      .pill-row + .pill-row {
        margin-top: 0;
      }

      .llm-mode-toggle {
        margin-left: auto;
        flex-shrink: 0;
      }

      /* "new messages" floats 8px above the composer, centred, over the
         transcript's bottom fade: a zero-height row, so it takes no line
         and the transcript never moves for it */
      .unread-jump-row {
        position: relative;
        z-index: 3;
        display: flex;
        justify-content: center;
        height: 0;
      }
      .unread-jump {
        position: static;
        transform: translateY(calc(-100% - var(--step-8, 8px)));
      }
      .session-prep {
        margin: var(--boxel-sp) 0;
      }
      .session-preparation-container {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 100%;
        gap: 4px;
      }

      /* the bottom row answers its own width, so the context ring can step
         aside before it squeezes the model's name out */
      .chat-input-area__bottom-actions:not(:has(.menu-content)) {
        container: composer / inline-size;
      }
      /* how full the model's context window is, beside the model it
         belongs to */
      /* a figure the reader reads on the box's light face: the ring's ink
         (ink-2) is the box's secondary ink, which holds 4.5:1 there */
      .context-fullness {
        flex: none;
        --ink-2: var(--boxel-500);
      }
      @container composer (width < 20rem) {
        .context-fullness {
          display: none;
        }
      }

      .loading-indicator {
        margin-bottom: var(--boxel-sp-xxs);
      }

      .llm-select {
        /* The LLM menu opens noticeably taller than the skill menu; a longer
           duration keeps the expanding edge moving at about the same speed. */
        --pill-menu-expand-duration: 0.25s;
        --pill-menu-collapse-duration: 0.19s;
      }

      .llm-select :deep(.menu-content) {
        margin-right: calc(-2 * var(--boxel-sp-sm));
        width: 100%;
      }

      .llm-select-footer-action {
        --boxel-button-font: 600 var(--type-ui, 12.5px) /
          var(--leading-ui, 18px) var(--boxel-font-family);
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-sm);
        --boxel-button-disabled-background: none;
        --boxel-button-disabled-opacity: 1;

        justify-content: flex-start;
        text-wrap: balance;
      }
    </style>
  </template>

  @consume(GetCardContextName) declare private getCard: getCard;
  @tracked private selectedBottomAction:
    | 'skill-menu'
    | 'llm-select'
    | undefined;
  @tracked lastCanceledActionMessageId: string | undefined;
  @tracked acceptingAllLabel: string | undefined;
  @tracked private isDropZoneActive = false;
  private dropZoneDragDepth = 0;

  @service declare private store: StoreService;
  @service declare private cardService: CardService;
  @service declare private realm: RealmService;
  @service declare private toolService: ToolService;
  @service('file-upload') declare private fileUpload: FileUploadService;
  @service('loader-service') declare private loaderService: LoaderService;
  @service declare private matrixService: MatrixService;
  @service declare private network: NetworkService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private playgroundPanelService: PlaygroundPanelService;
  @service declare private specPanelService: SpecPanelService;
  @service declare private aiAssistantPanelService: AiAssistantPanelService;

  private autoAttachmentResource = getAutoAttachment(this, {
    submode: () => this.operatorModeStateService.state.submode,
    moduleInspectorPanel: () =>
      this.operatorModeStateService.moduleInspectorPanel,
    autoAttachedFileUrls: () => this.autoAttachedFileUrls,
    playgroundPanelCardId: () => this.playgroundPanelCardId,
    activeSpecId: () => this.specPanelService.specSelection,
    topMostStackItems: () => this.topMostStackItems,
    attachedCardIds: () => this.cardIdsToAttach,
    removedCardIds: () => this.removedAttachedCardIds,
  });
  private removedAttachedCardIds = new TrackedSet<string>();
  private removedAttachedFileUrls: string[] = [];
  private lastAutoAttachedFileUrlsKey: string | undefined;
  private lastKnownRoom: RoomData | undefined;
  private getConversationScrollability: (() => boolean) | undefined;
  private scrollConversationToBottom: (() => void) | undefined;
  private roomScrollState: WeakMap<RoomData, RoomScrollState> = new WeakMap();

  @tracked private unknownMessageSendError: string | undefined = undefined;
  private _fileUploadStates = new TrackedMap<string, FileUploadState>();

  get fileUploadStates(): ReadonlyMap<string, FileUploadState> {
    return this._fileUploadStates;
  }
  private get shouldShowUnknownMessageSendError() {
    // Since unknownMessageSendError error is coming from the catch-all block in doSendMessage,
    // we need to check if there already exists an error message in the last message, which is
    // more specific and would take precedence (we don't want to show the generic unknown error
    // message if there is a more specific error message in the last message)
    if (!this.unknownMessageSendError) {
      return false;
    }
    let lastMessage = this.messages[this.messages.length - 1];
    return lastMessage?.errorMessage === undefined;
  }
  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.doMatrixEventFlush.perform();
    // Replay any persisted optimistic sends from a prior tab/session before
    // matrix-js-sdk's /sync delivers real echoes — entries left in 'not_sent'
    // surface the retry alert; matched real echoes reconcile via the cgi bridge.
    // Deferred to afterRender: hydration writes the room's tracked `_events`,
    // and doing it synchronously here would mutate tracked state during the
    // same render that created this component (the parent already read
    // `_events`), tripping Ember's backtracking assertion.
    schedule('afterRender', () => {
      if (isDestroyed(this) || isDestroying(this)) {
        return;
      }
      this.matrixService.ensurePendingSendsHydrated(this.args.roomId);
    });
    registerDestructor(this, () => {
      for (let timer of this.continuationTimers.values()) {
        clearTimeout(timer);
      }
      for (let timer of this.pointerTimers.values()) {
        clearTimeout(timer);
      }
      this.cleanupScrollState();
      this.getConversationScrollability = undefined;
      this.scrollConversationToBottom = undefined;
      this.navigateConversation = undefined;
    });
  }

  private get existingScrollState() {
    let room = this.roomForCleanup;
    return room ? this.roomScrollState.get(room) : undefined;
  }

  private ensureScrollState() {
    let room = this.room;
    if (!room) {
      return;
    }
    if (this.lastKnownRoom && this.lastKnownRoom !== room) {
      this.cleanupScrollState(this.lastKnownRoom);
    }
    this.lastKnownRoom = room;
    let state = this.roomScrollState.get(room);
    if (!state) {
      let nextState!: RoomScrollState;
      nextState = new TrackedObject({
        isScrolledToBottom: false,
        userHasScrolled: false,
        isConversationScrollable: false,
        messageElements: new Map(),
        messageScrollers: new Map(),
        messageVisibilityObserver: new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            let index = nextState.messageElements.get(
              entry.target as HTMLElement,
            );
            if (index != null) {
              if (
                (!nextState.isConversationScrollable || entry.isIntersecting) &&
                index > this.lastReadMessageIndex
              ) {
                this.sendReadReceipt(this.messages[index]);
              }
            }
          });
        }),
      });
      state = nextState;
      this.roomScrollState.set(room, state);
    }
    return state;
  }

  private cleanupScrollState(room = this.roomForCleanup) {
    if (!room) {
      return;
    }
    let scrollState = this.roomScrollState.get(room);
    if (!scrollState) {
      return;
    }
    for (let element of scrollState.messageElements.keys()) {
      scrollState.messageVisibilityObserver.unobserve(element);
    }
    scrollState.messageVisibilityObserver.disconnect();
    scrollState.messageElements.clear();
    scrollState.messageScrollers.clear();
    scrollState.isScrolledToBottom = false;
    scrollState.userHasScrolled = false;
    scrollState.isConversationScrollable = false;
    this.roomScrollState.delete(room);
  }

  // Using a resource for automatically attached files,
  // so the file can be reattached after being removed
  // when the user opens a different file and then returns to this one.
  @use private autoAttachedFileResource = resource(() => {
    let state = new TrackedObject<{
      value: FileDef[];
      remove: (sourceUrl?: string) => void;
    }>({
      value: [],
      remove: (sourceUrl?: string) => {
        if (!sourceUrl) {
          state.value = [];
          return;
        }
        state.value = state.value.filter(
          (file) => file.sourceUrl !== sourceUrl,
        );
      },
    });

    let autoAttachedFileUrls = this.autoAttachedFileUrls;
    let manuallyAttachedFiles = this.filesToAttach;
    let autoAttachedFileUrlsKey = autoAttachedFileUrls.join('\n');

    let removedFileUrls: string[];
    if (autoAttachedFileUrlsKey !== this.lastAutoAttachedFileUrlsKey) {
      this.removedAttachedFileUrls.splice(0);
      removedFileUrls = this.removedAttachedFileUrls;
      this.lastAutoAttachedFileUrlsKey = autoAttachedFileUrlsKey;
    } else {
      removedFileUrls = this.removedAttachedFileUrls;
    }

    let candidateUrls = autoAttachedFileUrls.filter((url) => {
      if (!url) {
        return false;
      }
      let isManuallyAttached = manuallyAttachedFiles.some(
        (file) => file.sourceUrl === url,
      );
      let isRemoved = removedFileUrls.includes(url);
      return !isManuallyAttached && !isRemoved;
    });

    state.value = candidateUrls.map((url) => {
      let name = url.split('/').pop();
      return this.matrixService.fileAPI.createFileDef({
        sourceUrl: url,
        name,
        contentType: url.endsWith('.json')
          ? SupportedMimeType.CardJson
          : name
            ? inferContentType(name)
            : undefined,
      });
    });

    return state;
  });

  private get autoAttachedFileUrls() {
    let codePathUrl = this.operatorModeStateService.state.codePath
      ? this.network.virtualNetwork.toURLHref(
          this.operatorModeStateService.state.codePath,
        )
      : undefined;
    if (!codePathUrl) {
      return [];
    }

    let urls = [codePathUrl];

    if (codePathUrl.endsWith('.json')) {
      let openFile = this.operatorModeStateService.openFile?.current;
      if (openFile && isReady(openFile)) {
        try {
          let fileContent = JSON.parse(openFile.content);
          let adoptsFrom = fileContent?.data?.meta?.adoptsFrom;
          if (adoptsFrom?.module) {
            let moduleRef = adoptsFrom.module.endsWith('.gts')
              ? adoptsFrom.module
              : `${adoptsFrom.module}.gts`;
            // The module may be prefix-form (`@cardstack/base/card-api`), so it
            // is resolved through the virtual network rather than joined onto
            // the open file's URL.
            let moduleURLWithExtension = this.network.virtualNetwork.resolveURL(
              moduleRef,
              openFile.url,
            );
            if (!urls.includes(moduleURLWithExtension.href)) {
              urls.push(moduleURLWithExtension.href);
            }
          }
        } catch (_error) {
          // If JSON parse fails, fall back to just the current file URL.
        }
      }
    }

    return urls;
  }

  private get autoAttachedFiles() {
    return this.operatorModeStateService.state.submode === Submodes.Code
      ? this.autoAttachedFileResource.value
      : [];
  }

  private get removeAutoAttachedFile() {
    return (sourceUrl?: string) => {
      this.autoAttachedFileResource.remove(sourceUrl);
    };
  }

  private markAttachedFileRemoved(sourceUrl?: string | null) {
    if (!sourceUrl) {
      return;
    }
    if (!this.removedAttachedFileUrls.includes(sourceUrl)) {
      this.removedAttachedFileUrls.push(sourceUrl);
    }
  }

  private get filesToAttach() {
    return this.matrixService.getFilesToSend(this.args.roomId) ?? [];
  }

  @use private playgroundPanelCardIdResource = resource(() => {
    let state = new TrackedObject<{
      value: string | undefined;
      remove: () => void;
    }>({
      value: undefined,
      remove: () => {
        state.value = undefined;
      },
    });

    (async () => {
      if (!this.args.selectedCardRef) {
        return;
      }
      let moduleId = internalKeyFor(
        this.args.selectedCardRef,
        undefined,
        this.network.virtualNetwork,
      );
      state.value = this.playgroundPanelService.getSelection(moduleId)?.cardId;
    })();

    return state;
  });

  private get playgroundPanelCardId() {
    return this.playgroundPanelCardIdResource.value;
  }

  private get removePlaygroundPanelCard() {
    return this.playgroundPanelCardIdResource.remove;
  }

  private get isScrolledToBottom() {
    return this.existingScrollState?.isScrolledToBottom ?? false;
  }

  private get userHasScrolled() {
    return this.existingScrollState?.userHasScrolled ?? false;
  }

  private get isConversationScrollable() {
    return this.existingScrollState?.isConversationScrollable ?? false;
  }

  private registerMessageScroller = ({
    index,
    element,
    scrollTo,
  }: {
    index: number;
    element: HTMLElement;
    scrollTo: (arg?: any) => void;
  }) => {
    let scrollState = this.ensureScrollState();
    if (!scrollState) {
      return;
    }
    for (let [
      registeredElement,
      registeredIndex,
    ] of scrollState.messageElements) {
      if (registeredIndex === index && registeredElement !== element) {
        scrollState.messageElements.delete(registeredElement);
        scrollState.messageVisibilityObserver.unobserve(registeredElement);
        break;
      }
    }
    scrollState.messageElements.set(element, index);
    scrollState.messageScrollers.set(index, scrollTo);
    scrollState.messageVisibilityObserver.observe(element);
    scrollState.isConversationScrollable = Boolean(
      this.getConversationScrollability?.(),
    );
    // The room lands once, when its history first registers; a message
    // registered after that is a live one.
    if (
      index === this.messages.length - 1 &&
      !this.landedRoomIds.has(this.args.roomId)
    ) {
      this.landedRoomIds.add(this.args.roomId);
      this.landOnFirstUnread(scrollState);
    }
    // The reader's own new message, however it was sent (the composer, "Fix
    // with AI", a card's command): follow the reply from here.
    // Once per message, as main does it: a message's scroller re-registers
    // on every change inside it (pills loading, a ring turning), and
    // following again each time would drag a reader who scrolled up back
    // to the end.
    let own = this.messages[index];
    if (
      index === this.messages.length - 1 &&
      own?.author.userId === this.matrixService.profile.userId &&
      own.eventId !== this.followedOwnMessageId
    ) {
      this.followedOwnMessageId = own.eventId;
      // registration runs inside render: following there writes the
      // scroller's tracked state after it was read, which autotracking
      // refuses, and the transcript stops following. Follow in the render
      // queue's next job instead: outside the transaction, but before the
      // afterRender queue, where the transcript's motion region measures the
      // pass, so it sees this scroll and moves what it moved.
      schedule('render', this, this.followAfterSend);
      return;
    }
    if (!this.isConversationScrollable || !this.isAllowedToAutoScroll) {
      return;
    }

    // Following the end, and holding a reader's place while they read, is
    // the transcript's scroll owner's (StickToBottom's anchor): the room
    // only asks it to show the first unread message, to a reader who is not
    // at the end. A room that opens on unread history goes to it once its
    // history has registered (landOnFirstUnread).
    if (
      !this.isScrolledToBottom &&
      this.hasUnreadMessages &&
      index === this.lastReadMessageIndex + 1
    ) {
      schedule('afterRender', null, () => {
        if (this.navigateConversation) {
          this.navigateConversation(element, { block: 'start' });
        } else {
          scrollTo();
        }
      });
    }
  };

  // A room that opens on history the reader hasn't read shows its first
  // unread message. Messages mount in steps, so the first unread one can
  // register before the transcript scrolls: this runs once the last one has
  // registered.
  private landOnFirstUnread(scrollState: RoomScrollState) {
    // a conversation that fits its view has nowhere to go, and asking would
    // stop it following the end
    if (
      !this.hasUnreadMessages ||
      !this.isAllowedToAutoScroll ||
      !scrollState.isConversationScrollable
    ) {
      return;
    }
    let firstUnreadIndex = this.lastReadMessageIndex + 1;
    let element = [...scrollState.messageElements].find(
      ([, index]) => index === firstUnreadIndex,
    )?.[0];
    if (!element) {
      return;
    }
    schedule('afterRender', null, () => {
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      this.navigateConversation?.(element, { block: 'start' });
    });
  }

  private unregisterMessageScroller = ({
    index,
    element,
  }: {
    index: number;
    element: HTMLElement;
  }) => {
    let scrollState = this.existingScrollState;
    if (!scrollState) {
      return;
    }
    let elementOwnsIndex = scrollState.messageElements.get(element) === index;
    scrollState.messageElements.delete(element);
    if (elementOwnsIndex) {
      scrollState.messageScrollers.delete(index);
    }
    scrollState.messageVisibilityObserver.unobserve(element);
  };

  private registerConversationScroller = (
    isConversationScrollable: () => boolean,
    scrollToBottom: () => void,
    navigate: ConversationNavigate,
  ) => {
    this.getConversationScrollability = isConversationScrollable;
    this.scrollConversationToBottom = scrollToBottom;
    this.navigateConversation = navigate;
  };
  // the transcript's scroll owner shows an element (StickToBottom.navigate):
  // the room never scrolls the transcript itself
  private navigateConversation: ConversationNavigate | undefined;

  // the reader's own message the transcript last followed for
  private followedOwnMessageId: string | undefined;
  // Rooms whose history has registered once. Not tracked: nothing renders
  // from it, and it is written while a message renders.
  private landedRoomIds = new Set<string>();

  private setScrollPosition = ({ isBottom }: { isBottom: boolean }) => {
    let scrollState = this.ensureScrollState();
    if (!scrollState) {
      return;
    }
    scrollState.isScrolledToBottom = isBottom;
    if (!isBottom) {
      scrollState.userHasScrolled = true;
    }
    // what the transcript held when the reader left the end: anything after
    // it is new below them, a message or the running reply growing
    if (isBottom) {
      this.leftEndAt = undefined;
    } else if (this.leftEndAt === undefined) {
      this.leftEndAt = this.revisionKey;
    }
  };

  @tracked private leftEndAt: string | undefined;

  // the transcript's content, and the steps its running calls have reported,
  // which change while the reply's own text does not
  private get revisionKey() {
    let last = this.messages[this.messages.length - 1];
    let steps = (last?.tools ?? [])
      .map((tool) =>
        tool.id
          ? (this.toolService.toolProgress.get(tool.id)?.lines.length ?? 0)
          : 0,
      )
      .join(',');
    return `${this.transcriptRevision}|${steps}`;
  }

  // the transcript grew since the reader scrolled away from its end
  private get grewBelow() {
    return this.leftEndAt !== undefined && this.revisionKey !== this.leftEndAt;
  }

  // the chip's jump: to the first unread message, or to the end when what
  // is new is the running reply
  private jumpToNew = () => {
    if (this.hasUnreadMessages) {
      this.scrollToFirstUnread();
    } else {
      this.scrollConversationToBottom?.();
    }
  };

  private scrollToFirstUnread = () => {
    if (!this.hasUnreadMessages) {
      return;
    }

    let firstUnreadIndex = this.lastReadMessageIndex + 1;
    let scrollTo =
      this.existingScrollState?.messageScrollers.get(firstUnreadIndex);
    if (!scrollTo) {
      console.warn(`No scroller for message index ${firstUnreadIndex}`);
    } else {
      scrollTo({ behavior: 'smooth' });
    }
  };

  private get isAllowedToAutoScroll() {
    return !this.userHasScrolled || this.isScrolledToBottom;
  }

  // For efficiency, read receipts are implemented using "up to" markers. This
  // marker indicates that the acknowledgement applies to all events "up to and
  // including" the event specified. For example, marking an event as "read" would
  // indicate that the user had read all events up to the referenced event.
  @cached private get lastReadMessageIndex() {
    let readReceiptIndicies: number[] = [];
    for (let receipt of this.matrixService.currentUserEventReadReceipts.keys()) {
      let maybeIndex = this.messages.findIndex((m) => m.eventId === receipt);
      if (maybeIndex != null) {
        readReceiptIndicies.push(maybeIndex);
      }
    }
    return max(readReceiptIndicies) ?? -1;
  }

  @cached private get numberOfUnreadMessages() {
    let unreadMessagesCount = 0;
    let firstUnreadIndex = this.lastReadMessageIndex + 1;
    for (let i = firstUnreadIndex; i < this.messages.length; i++) {
      if (
        this.matrixService.profile.userId === this.messages[i].author.userId
      ) {
        continue;
      }
      unreadMessagesCount++;
    }
    return unreadMessagesCount;
  }

  private get hasUnreadMessages() {
    return this.numberOfUnreadMessages > 0;
  }

  private get showUnreadIndicator() {
    // if user is already scrolled to bottom we don't show the indicator to
    // prevent the flash of the indicator appearing and then disappearing during
    // the read receipt acknowledgement
    return (
      this.isConversationScrollable &&
      (this.hasUnreadMessages || this.grewBelow) &&
      !this.isScrolledToBottom
    );
  }

  private get isAcceptingAll() {
    return (
      this.executeAllReadyActionsTask.isRunning ||
      this.toolService.isPerformingAcceptAllForRoom(this.args.roomId)
    );
  }

  private get unreadMessageText() {
    if (!this.hasUnreadMessages) {
      return 'New below';
    }
    return `${this.numberOfUnreadMessages} New ${pluralize(
      'Message',
      this.numberOfUnreadMessages,
    )}`;
  }

  private sendReadReceipt(message: Message) {
    if (this.matrixService.profile.userId === message.author.userId) {
      if (isTesting()) {
        console.log(
          `[read-receipt-trace] skip self event=${message.eventId} room=${this.args.roomId}`,
        );
      }
      return;
    }
    if (this.matrixService.currentUserEventReadReceipts.has(message.eventId)) {
      if (isTesting()) {
        console.log(
          `[read-receipt-trace] skip already-acked event=${message.eventId} room=${this.args.roomId}`,
        );
      }
      return;
    }

    // sendReadReceipt expects an actual MatrixEvent (as defined in the matrix
    // SDK), but it' not available to us here - however, we can fake it by adding
    // the necessary methods
    let matrixEvent = {
      getId: () => message.eventId,
      getRoomId: () => this.args.roomId,
      getTs: () => message.created.getTime(),
    };

    if (isTesting()) {
      console.log(
        `[read-receipt-trace] schedule event=${message.eventId} room=${this.args.roomId}`,
      );
    }
    // Without scheduling this after render, this produces the "attempted to
    // update value, but it had already been used previously in the same
    // computation" error
    schedule('afterRender', () => {
      if (isTesting()) {
        console.log(
          `[read-receipt-trace] dispatch event=${message.eventId} room=${this.args.roomId}`,
        );
      }
      this.matrixService.sendReadReceipt(matrixEvent as MatrixEvent);
    });
  }

  private maybeRetryAction = (messageIndex: number, message: Message) => {
    if (this.isLastMessage(messageIndex) && message.isRetryable) {
      return this.resendLastMessage;
    }
    return undefined;
  };

  private isMessageStreaming = (message: Message) => {
    return !message.isStreamingFinished;
  };

  private doMatrixEventFlush = restartableTask(async () => {
    await this.matrixService.flushMembership;
    await this.matrixService.flushTimeline;
    await this.args.roomResource.processing;
  });

  private get messages() {
    return this.args.roomResource.messages;
  }

  // The session's cost in Boxel credits; the token totals are its title.
  // The session's total, once there is more than one turn to add up: with
  // one, it only repeats that reply's own credits under it.
  private get showsSessionTotal() {
    if (!this.conversationTokenUsage) {
      return false;
    }
    let turns = this.messages.filter(
      (message) =>
        message.usage &&
        (message.usage.promptTokens != null ||
          message.usage.completionTokens != null),
    );
    return turns.length > 1;
  }

  private get conversationCredits() {
    if (!this.conversationTokenUsage) {
      return undefined;
    }
    let costUsd = 0;
    let turnsWithCost = 0;
    let turnsWithUsage = 0;
    for (let message of this.messages) {
      let usage = message.usage;
      if (
        !usage ||
        (usage.promptTokens == null && usage.completionTokens == null)
      ) {
        continue;
      }
      turnsWithUsage++;
      if (usage.costUsd != null) {
        costUsd += usage.costUsd;
        turnsWithCost++;
      }
    }
    // A partial sum would read as the whole bill: fall back to the tokens.
    return turnsWithCost === turnsWithUsage
      ? formatCredits(costUsd)
      : this.conversationTokenUsage;
  }

  // The session's token bill so far: every turn's counts summed. Input is
  // summed rather than read off the last turn because each turn re-sends the
  // whole conversation — the sum is what the provider actually billed. Shown
  // only behind the `showTokens` query param.
  @cached
  private get conversationTokenUsage() {
    if (!this.operatorModeStateService.operatorModeController.showTokens) {
      return undefined;
    }
    let promptTokens = 0;
    let completionTokens = 0;
    let cachedTokens = 0;
    let turnsWithCached = 0;
    let costUsd = 0;
    let turnsWithCost = 0;
    let turnsWithUsage = 0;
    for (let message of this.messages) {
      let usage = message.usage;
      // Same gate as the per-message line: a usage object without token
      // counts must not add a turn to the total that line never shows.
      if (
        !usage ||
        (usage.promptTokens == null && usage.completionTokens == null)
      ) {
        continue;
      }
      turnsWithUsage++;
      promptTokens += usage.promptTokens ?? 0;
      completionTokens += usage.completionTokens ?? 0;
      if (usage.cachedTokens != null) {
        cachedTokens += usage.cachedTokens;
        turnsWithCached++;
      }
      if (usage.costUsd != null) {
        costUsd += usage.costUsd;
        turnsWithCost++;
      }
    }
    // With a single counted turn the total merely repeats that message's own
    // line right below it; a sum only earns its place once there is
    // something to add up.
    if (turnsWithUsage < 2) {
      return undefined;
    }
    return formatTokenUsage({
      promptTokens,
      completionTokens,
      // An optional figure is only a session total when every counted turn
      // reported it; a partial sum would read as the whole bill.
      ...(turnsWithCached === turnsWithUsage ? { cachedTokens } : {}),
      ...(turnsWithCost === turnsWithUsage ? { costUsd } : {}),
    });
  }

  // How full the active model's context window is: the latest turn's input
  // and output, which the next turn sends again, against the model's context
  // length from the OpenRouter catalog. Unknown until both are known.
  private get contextFullness():
    | { percent: number; level: string; used: number; limit: number }
    | undefined {
    let option = this.baseLlmOptions.find(
      (candidate) => candidate.id === this.args.roomResource.activeLLM,
    );
    let limit = option
      ? this.modelContextLengthByModelId.get(option.modelId)
      : undefined;
    if (!limit) {
      return undefined;
    }
    let used: number | undefined;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      let usage = this.messages[i]!.usage;
      if (usage?.promptTokens != null) {
        used = usage.promptTokens + (usage.completionTokens ?? 0);
        break;
      }
    }
    if (used == null) {
      return undefined;
    }
    let percent = Math.min(100, Math.round((used / limit) * 100));
    return {
      percent,
      level: percent >= 80 ? 'high' : 'normal',
      used,
      limit,
    };
  }

  // What a new session is preparing from the last one, as Pret UI's
  // SessionPrep steps: only the work that is actually happening.
  private get sessionPrepSteps(): SessionPrepStep[] {
    let steps: SessionPrepStep[] = [];
    if (this.aiAssistantPanelService.isSummarizingSession) {
      steps.push({
        id: 'summarize',
        label: 'Summarizing previous session',
        state: 'running',
      });
    }
    if (this.aiAssistantPanelService.isCopyingFileHistory) {
      steps.push({
        id: 'copy-files',
        label: 'Copying file history from previous session',
        state: 'running',
      });
    }
    return steps;
  }

  private get skills(): RoomSkill[] {
    return this.args.roomResource.skills;
  }

  private get llmsForSelectMenu(): LLMOption[] {
    this.ensureModelCostTiersLoaded();
    let costTierByModelId = this.modelCostTierByModelId;
    return this.baseLlmOptions.map((option) => ({
      ...option,
      costTierLabel: costTierByModelId.get(option.modelId),
    }));
  }

  // The pickable models, before cost tiers are attached. Single source of
  // truth for both the rendered options and the cost-tier lookup's model-id
  // set, so the two can't drift apart.
  @cached
  private get baseLlmOptions(): LLMOption[] {
    return pickableModels(
      this.matrixService.systemCard,
      this.args.roomResource.usedLLMs,
    );
  }

  // The distinct OpenRouter model ids that can appear in the picker.
  @cached
  private get pickerModelIds(): string[] {
    return modelIdsOf(this.baseLlmOptions);
  }

  // Cost tier ($…$$$$ / Free) per model id, populated by `loadModelCostTiers`.
  @tracked private modelCostTierByModelId: Map<string, string> = new Map();
  @tracked private modelContextLengthByModelId: Map<string, number> = new Map();
  // Content key of the last load (realm + sorted model ids). Deliberately a
  // plain field, not tracked: it gates the load without being part of the
  // reactive graph.
  private lastModelCostTierKey = '';

  // Kicks a cost-tier load whenever the pickable model set changes. Keyed on
  // model-id *content* (not array identity), so the live matrix churn behind
  // `pickerModelIds` — new `usedLLMs` array each sync — can't retrigger it.
  // Called during render (from `llmsForSelectMenu`), so nothing on the
  // synchronous path here may write tracked state: when there is nothing to
  // load (realm unconfigured, no models) we return without performing the
  // task, and the task body itself only writes after its await.
  private ensureModelCostTiersLoaded() {
    let modelIds = this.pickerModelIds;
    let realmURL = ENV.resolvedOpenRouterRealmURL;
    let key =
      realmURL && modelIds.length > 0
        ? `${realmURL}::${[...modelIds].sort().join('|')}`
        : '';
    if (key === this.lastModelCostTierKey) {
      return;
    }
    this.lastModelCostTierKey = key;
    if (!key) {
      return;
    }
    this.loadModelCostTiers.perform(modelIds, realmURL!, key);
  }

  // Looks up the cost tier for each pickable model by matching its `modelId`
  // against the OpenRouter model catalog. The tier is a `computeVia` field on
  // the `OpenRouterModel` card (derived there from its own pricing), which is
  // correlated to a model configuration by the `modelId` string, not a link —
  // so we search that realm and read each match's `costTierLabel`. Degrades to
  // an empty map when the OpenRouter realm is unconfigured, unreachable, or a
  // model has no matching catalog card — the badge is cosmetic and must never
  // surface an error.
  //
  // This is a task rather than a `trackedFunction`/resource on purpose:
  // `store.search` hydrates cards (mutating tracked store state) and we then
  // read those cards' fields, so a reactive body would self-invalidate into an
  // endless re-run and never settle. The task runs the search + field reads off
  // the render's reactive path and only writes the tracked map the picker reads.
  private loadModelCostTiers = restartableTask(
    async (modelIds: string[], realmURL: string, key: string) => {
      let tiers = new Map<string, string>();
      let contexts = new Map<string, number>();
      try {
        let query: Query = {
          filter: {
            on: {
              module: this.network.virtualNetwork.unresolveURL(
                new URL('openrouter-model', realmURL).href,
              ),
              name: 'OpenRouterModel',
            },
            in: { modelId: modelIds },
          },
        };
        let instances = await this.store.search(query, [realmURL]);
        for (let instance of instances) {
          let model = instance as unknown as {
            modelId?: string;
            costTierLabel?: string;
            contextLength?: number | null;
            topProvider?: { contextLength?: number | null } | null;
          };
          if (!model.modelId) {
            continue;
          }
          let contextLength =
            model.topProvider?.contextLength ?? model.contextLength;
          if (typeof contextLength === 'number' && contextLength > 0) {
            contexts.set(model.modelId, contextLength);
          }
          if (model.costTierLabel) {
            tiers.set(model.modelId, model.costTierLabel);
          }
        }
      } catch (e) {
        console.warn('Failed to load model cost tiers', e);
        // Keep whatever map we already have and clear the gate key (if no
        // newer load has claimed it) so a later render retries. Skipping the
        // tracked-map write matters: writing it would invalidate the picker
        // and re-render straight back into a retry loop while the catalog
        // realm is down.
        if (this.lastModelCostTierKey === key) {
          this.lastModelCostTierKey = '';
        }
        return;
      }
      this.modelCostTierByModelId = tiers;
      this.modelContextLengthByModelId = contexts;
    },
  );

  private get systemCardId(): string | undefined {
    return this.matrixService.systemCard?.id;
  }

  private get isDefaultSystemCard(): boolean {
    let systemCardId = this.systemCardId;
    if (!ENV.defaultSystemCardId) {
      return true;
    }
    return (
      !systemCardId || this.matrixService.isDefaultSystemCardId(systemCardId)
    );
  }

  @action
  private goToSystemCard() {
    let systemCardId = this.systemCardId;
    if (systemCardId) {
      if (this.operatorModeStateService.workspaceChooserOpened) {
        this.operatorModeStateService.closeWorkspaceChooser();
      }
      let stackIndex = Math.min(
        this.operatorModeStateService.numberOfStacks(),
        1,
      );
      let stackItem = this.operatorModeStateService.createStackItem(
        systemCardId,
        stackIndex,
        'isolated',
      );
      this.operatorModeStateService.addItemToStack(stackItem);
    }
  }

  private restoreDefaultSystemCardTask = task(async () => {
    await this.matrixService.setUserSystemCard(undefined);
  });

  private get sortedSkills(): RoomSkill[] {
    return [...this.skills].sort((a, b) => {
      // Not all of the skills have a title, so we use the sourceUrl as a fallback
      // which should be consistent.
      let aTitle = a.cardId || a.fileDef.sourceUrl;
      let bTitle = b.cardId || b.fileDef.sourceUrl;
      return aTitle?.localeCompare(bTitle ?? '') ?? 0;
    });
  }

  private get room() {
    return this.args.roomResource?.matrixRoom;
  }

  private get roomForCleanup() {
    return this.room ?? this.lastKnownRoom;
  }

  private doWhenRoomChanges = restartableTask(async () => {
    await all([this.cardService.cardsSettled(), timeout(500)]);
  });

  private get messageToSend() {
    return this.matrixService.getMessageToSend(this.args.roomId) ?? '';
  }

  private get cardIdsToAttach() {
    return this.matrixService.getCardsToSend(this.args.roomId);
  }

  @action private resendLastMessage() {
    if (!this.room) {
      throw new Error(
        'Bug: should not be able to resend a message without a room.',
      );
    }

    let myMessages = this.messages.filter(
      (message) => message.author.userId === this.matrixService.userId,
    );
    if (myMessages.length === 0) {
      throw new Error(
        'Bug: should not be able to resend a message that does not exist.',
      );
    }
    let myLastMessage = myMessages[myMessages.length - 1];

    this.doSendMessage.perform(
      myLastMessage.body,
      myLastMessage!.attachedCardIds || [],
      myLastMessage.attachedFiles,
      myLastMessage.clientGeneratedId,
      true,
      // A retry resends the message as it was: one the app composed stays
      // unmarked.
      myLastMessage.typedByUser === true,
    );
  }

  @action
  private setMessage(message: string) {
    this.matrixService.setMessageToSend(this.args.roomId, message);
  }

  @action
  private sendMessage(prompt?: string) {
    let cards = [];
    if (this.cardIdsToAttach) {
      cards.push(...this.cardIdsToAttach);
    }
    if (this.autoAttachedCardIds.size > 0) {
      this.autoAttachedCardIds.forEach((card) => {
        cards.push(card);
      });
    }

    let files = [];
    if (this.autoAttachedFiles.length > 0) {
      files.push(...this.autoAttachedFiles);
    }
    files.push(...this.filesToAttach);

    this.doSendMessage.perform(
      prompt ?? this.messageToSend,
      cards.length ? cards : undefined,
      files.length ? files : undefined,
    );
    this.followAfterSend();
  }

  // Sending is the reader saying "I'm here now": go to the end and follow the
  // reply, even if they had scrolled up or the unread logic had parked the
  // view at the start of an earlier answer.
  private followAfterSend() {
    let scrollState = this.ensureScrollState();
    if (scrollState) {
      scrollState.isScrolledToBottom = true;
      scrollState.userHasScrolled = false;
    }
    this.scrollConversationToBottom?.();
  }

  @action
  private chooseCard(cardId: string) {
    // handle the case where auto-attached card pill is clicked
    if (this.autoAttachedCardIds.has(cardId)) {
      this.removedAttachedCardIds.add(cardId);
    }

    let cardIds = this.cardIdsToAttach ?? [];
    if (!cardIds.includes(cardId)) {
      this.matrixService.setCardsToSend(this.args.roomId, [...cardIds, cardId]);
    }
  }

  @action
  private removeCard(id: string) {
    if (this.playgroundPanelCardId === id) {
      this.removePlaygroundPanelCard();
      return;
    }

    if (this.autoAttachedCardIds.has(id)) {
      this.removedAttachedCardIds.add(id);
      return;
    }

    let cardIds = this.cardIdsToAttach ?? [];
    if (!cardIds.length) {
      return;
    }

    let next = cardIds.filter((url) => url !== id);
    if (next.length === cardIds.length) {
      return;
    }

    this.matrixService.setCardsToSend(
      this.args.roomId,
      next.length ? next : undefined,
    );
  }

  private chooseFileTask = enqueueTask(async (file: FileDef) => {
    // handle the case where auto-attached file pill is clicked
    if (this.isAutoAttachedFile(file)) {
      this.removeAutoAttachedFile(file.sourceUrl ?? undefined);
    }

    let files = this.filesToAttach;
    if (!files?.find((f) => f.sourceUrl === file.sourceUrl)) {
      await this.matrixService.prefetchFileContent(file);
      this.matrixService.setFilesToSend(this.args.roomId, [...files, file]);
      this.startFileUploadTask.perform(file);
    }
  });

  private chooseLocalFileTask = task(async () => {
    let localFile = await this.fileUpload.pickLocalFile();
    if (!localFile) {
      return;
    }
    await this.attachLocalFile(localFile);
  });

  @action
  private handleChatInputDragOver(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.isDropZoneActive = true;
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.dropEffect = 'copy';
    }
  }

  @action
  private handleChatInputDragEnter(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth++;
    this.isDropZoneActive = true;
  }

  @action
  private handleChatInputDragLeave(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer) && !this.isDropZoneActive) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth = Math.max(0, this.dropZoneDragDepth - 1);
    if (this.dropZoneDragDepth === 0) {
      this.isDropZoneActive = false;
    }
  }

  @action
  private handleChatInputDrop(event: Event) {
    let dragEvent = event as DragEvent;
    let files = Array.from(dragEvent.dataTransfer?.files ?? []);
    if (!files.length) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth = 0;
    this.isDropZoneActive = false;
    this.attachLocalFilesTask.perform(files);
  }

  @action
  private handleChatInputPaste(event: ClipboardEvent) {
    let files = this.getClipboardFiles(event.clipboardData);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.attachLocalFilesTask.perform(files);
  }

  private attachLocalFilesTask = enqueueTask(async (files: File[]) => {
    for (let file of files) {
      await this.attachLocalFile(file);
    }
  });

  private getClipboardFiles(clipboardData: DataTransfer | null): File[] {
    if (!clipboardData) {
      return [];
    }

    let files = Array.from(clipboardData.files ?? []);
    if (files.length) {
      return files;
    }

    let itemFiles: File[] = [];
    for (let item of Array.from(clipboardData.items ?? [])) {
      if (item.kind !== 'file') {
        continue;
      }
      let file = item.getAsFile();
      if (file) {
        itemFiles.push(file);
      }
    }

    return itemFiles;
  }

  private isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
    if (!dataTransfer) {
      return false;
    }
    return Array.from(dataTransfer.types ?? []).includes('Files');
  }

  private async attachLocalFile(localFile: File) {
    let bytes = new Uint8Array(await localFile.arrayBuffer());
    let file = await this.createLocalFileDef(localFile, bytes);
    let files = this.filesToAttach;
    let contentType =
      file.contentType || localFile.type || 'application/octet-stream';
    await this.matrixService.prefetchLocalFileContent(file, bytes, contentType);
    this.matrixService.setFilesToSend(this.args.roomId, [...files, file]);
    this.startFileUploadTask.perform(file);
  }

  @action
  private isAutoAttachedFile(file: FileDef) {
    return this.autoAttachedFiles.some(
      (autoFile) => autoFile.sourceUrl === file.sourceUrl,
    );
  }

  @action
  private removeFile(file: FileDef) {
    if (this.isAutoAttachedFile(file)) {
      this.removeAutoAttachedFile(file.sourceUrl ?? undefined);
      return;
    }

    let files = this.filesToAttach;
    if (!files.length) {
      return;
    }

    let newFiles = files.filter((f) => f.sourceUrl !== file.sourceUrl);
    if (newFiles.length === files.length) {
      return;
    }

    this.matrixService.setFilesToSend(
      this.args.roomId,
      newFiles.length ? newFiles : undefined,
    );

    this.markAttachedFileRemoved(file.sourceUrl);
    if (file.sourceUrl) {
      this._fileUploadStates.delete(file.sourceUrl);
    }
  }

  private startFileUploadTask = task(async (file: FileDef) => {
    let sourceUrl = file.sourceUrl;
    if (!sourceUrl) return;
    this._fileUploadStates.set(sourceUrl, { status: 'uploading' });
    try {
      let [uploadedFile] = await this.matrixService.uploadFiles([file]);
      let uploadedOrOriginal = uploadedFile ?? file;
      // Only update state if the file is still attached (guards against
      // race where file is removed while upload was in-flight).
      let files = this.filesToAttach;
      if (files?.find((f) => f.sourceUrl === sourceUrl)) {
        let nextFiles = files.map((f) =>
          f.sourceUrl === sourceUrl ? uploadedOrOriginal : f,
        );
        this.matrixService.setFilesToSend(this.args.roomId, nextFiles);
        this._fileUploadStates.set(sourceUrl, { status: 'complete' });
      }
    } catch (e: any) {
      // Only set error state if the file is still attached, to avoid
      // blocking canSend for a file the user already removed.
      if (this.filesToAttach?.find((f) => f.sourceUrl === sourceUrl)) {
        this._fileUploadStates.set(sourceUrl, {
          status: 'error',
          error: e?.message,
        });
      }
    }
  });

  private get hasFileUploadIssues() {
    for (let [, state] of this._fileUploadStates) {
      if (state.status === 'uploading' || state.status === 'error') {
        return true;
      }
    }
    return false;
  }

  @action
  private retryFileUpload(file: FileDef) {
    this.startFileUploadTask.perform(file);
  }

  private buildLocalSourceUrl(fileName: string): string {
    return `${LOCAL_SOURCE_URL_PREFIX}${uuidv4()}/${encodeURIComponent(fileName)}`;
  }

  private async createLocalFileDef(
    localFile: File,
    bytes: Uint8Array,
  ): Promise<FileDef> {
    let sourceUrl = this.buildLocalSourceUrl(localFile.name);
    let fileDefCodeRef = resolveFileDefCodeRef(new URL(sourceUrl));
    let extractor = new FileDefAttributesExtractor({
      loaderService: this.loaderService,
      network: this.network,
      fileURL: sourceUrl,
      fileDefCodeRef,
      baseFileDefCodeRef: baseFileRef,
      contentHash: undefined,
      contentSize: bytes.byteLength,
      fileSizeLimitBytes: ENV.fileSizeLimitBytes,
      fileBytes: bytes,
      buildError: (errorUrl, error) => {
        let errorJSONAPI = formattedError(errorUrl, error).errors[0];
        return errorJsonApiToErrorEntry(errorJSONAPI);
      },
    });
    let extracted = await extractor.extract();
    if (extracted.status === 'error' || !extracted.resource) {
      throw new Error(
        extracted.error?.error?.message ??
          `Failed to extract file metadata for ${localFile.name}`,
      );
    }

    let classCodeRef =
      extracted.resource.meta.adoptsFrom &&
      'module' in extracted.resource.meta.adoptsFrom &&
      'name' in extracted.resource.meta.adoptsFrom
        ? extracted.resource.meta.adoptsFrom
        : fileDefCodeRef;
    let fileDefModule = await this.loaderService.loader.import<
      Record<string, unknown>
    >(classCodeRef.module);
    let FileDefKlass = fileDefModule[classCodeRef.name] as
      | (new (attributes: Record<string, unknown>) => FileDef)
      | undefined;
    let baseAttributes = extracted.resource.attributes as Record<
      string,
      unknown
    >;
    let attributes: Record<string, unknown> = {
      ...baseAttributes,
      sourceUrl,
      url: sourceUrl,
      name: (baseAttributes.name as string | undefined) ?? localFile.name,
      contentSize:
        (baseAttributes.contentSize as number | undefined) ?? bytes.byteLength,
    };

    if (!FileDefKlass) {
      return this.matrixService.fileAPI.createFileDef({
        sourceUrl,
        url: sourceUrl,
        name: localFile.name,
        contentType:
          (attributes.contentType as string | undefined) ??
          localFile.type ??
          'application/octet-stream',
        contentHash: attributes.contentHash as string | undefined,
        contentSize: attributes.contentSize as number | undefined,
      });
    }

    // Build the typed instance through the deserialize path rather than the raw
    // `new FileDefKlass(attributes)` constructor. The constructor assigns every
    // attribute through the field setter, which rejects a composite field's
    // serialized (plain-object) value — e.g. a raster image's `colorProfile` /
    // `exif`. `createFromSerialized` deserializes those nested objects into
    // their FieldDef instances instead. No store is passed, so it deserializes
    // into an isolated store and stays a standalone instance, as before.
    let api = await this.cardService.getAPI();
    let resource = {
      ...extracted.resource,
      attributes,
    } as Parameters<typeof api.createFromSerialized>[0];
    return (await api.createFromSerialized(
      resource,
      { data: resource } as Parameters<typeof api.createFromSerialized>[1],
      new URL(sourceUrl),
    )) as FileDef;
  }

  private doSendMessage = enqueueTask(
    async (
      message: string | undefined,
      cardsOrIds?: CardDef[] | string[],
      files?: FileDef[],
      clientGeneratedId: string = uuidv4(),
      keepInputAndAttachments = false,
      typedByUser = true,
    ) => {
      this.unknownMessageSendError = undefined;
      const isRetry = keepInputAndAttachments;
      const roomId = this.args.roomId;

      // Snapshot the click-time inputs and render an optimistic bubble before
      // any awaited work. The pre-send pipeline (skill / command / card / file
      // serialization + upload) can take seconds; without this snapshot the
      // user sees an empty transcript while the pipeline runs.
      let snapshotBody = message ?? '';
      let snapshotCardIds: string[] = [];
      if (cardsOrIds) {
        if (typeof cardsOrIds[0] === 'string') {
          snapshotCardIds = (cardsOrIds as string[]).slice();
        } else {
          snapshotCardIds = (cardsOrIds as CardDef[])
            .map((c) => c.id as unknown as string)
            .filter((id) => Boolean(id));
        }
      }
      let snapshotFiles = files ?? [];

      if (!isRetry) {
        let originServerTs = await this.matrixService.addOptimisticEvent(
          roomId,
          {
            body: snapshotBody,
            clientGeneratedId,
            attachedCardIds: snapshotCardIds,
            attachedFiles: snapshotFiles.map((f) => f.serialize()),
          },
        );
        // Persist before clearing the draft so a tab close mid-pipeline still
        // restores the bubble on reload. Share the synthetic event's ts so
        // hydration reconstructs an identical origin_server_ts — otherwise
        // MessageBuilder.updateMessage may early-return when the real echo
        // arrives with an earlier ts.
        this.matrixService.persistOptimisticSend(roomId, {
          clientGeneratedId,
          body: snapshotBody,
          attachedCardIds: snapshotCardIds,
          attachedFiles: snapshotFiles.map((f) => f.serialize()),
          createdAt: originServerTs,
        });

        this.matrixService.setMessageToSend(roomId, undefined);
        this.matrixService.setCardsToSend(roomId, undefined);
        this.matrixService.setFilesToSend(roomId, undefined);
        this._fileUploadStates.clear();
      } else {
        // Retry — flip the existing bubble back to 'sending' and clear any
        // prior error so the alert / Retry button hides while the pipeline runs.
        this.matrixService.patchPendingSend(roomId, clientGeneratedId, {
          status: 'sending',
        });
      }

      try {
        let openCardIds = new Set([
          ...(this.operatorModeStateService.getOpenCardIds() || []),
          ...this.autoAttachedCardIds,
        ]) as Set<RealmResourceIdentifier>;
        let context = {
          ...(await this.operatorModeStateService.getSummaryForAIBot(
            openCardIds,
          )),
          // Sent from the chat composer, the user typed this message; a
          // retry carries over the original message's mark.
          typedByUser,
        };
        let cards: CardDef[] | undefined = [];
        if (typeof cardsOrIds?.[0] === 'string') {
          // we use detached instances since these are just
          // serialized and send to matrix--these don't appear
          // elsewhere in our app.
          let cardsOrErrors = await Promise.all(
            (cardsOrIds as string[]).map((id) => this.store.get(id)),
          );
          cardsOrErrors = cardsOrErrors.filter(Boolean);
          for (let cardOrError of cardsOrErrors) {
            if (isCardInstance(cardOrError)) {
              cards?.push(cardOrError as CardDef);
            } else {
              // error, let's attach it as a file instead if possible
              if (cardOrError.id) {
                let cardFileDef = this.matrixService.fileAPI.createFileDef({
                  sourceUrl: cardOrError.id + '.json',
                  name: cardOrError.id.split('/').pop(),
                });
                if (!files) {
                  files = [];
                }
                files.push(cardFileDef);
              }
            }
          }
        } else {
          cards = cardsOrIds as CardDef[] | undefined;
        }

        await this.matrixService.sendMessage(
          roomId,
          message,
          cards,
          files,
          clientGeneratedId,
          context,
        );
      } catch (e) {
        // Console sinks stringify a thrown plain object as "[object Object]",
        // which hides the actual failure; serialize it so the reason survives
        // into captured browser logs.
        console.error(
          `message send pipeline threw (clientGeneratedId=${clientGeneratedId}): ${stringifyErrorForLog(
            e,
          )}`,
        );

        // Inverse delivery race: client.sendEvent may have already handed the
        // event to matrix (status === 'sent') before a downstream throw escaped
        // into this catch. Flipping the bubble to 'not_sent' in that case
        // would briefly contradict the server's view. Consult the SDK's own
        // EventStatus first; only stamp 'not_sent' when matrix agrees the send
        // didn't land.
        let matrixStatus = this.matrixService.findPendingMatrixEventStatus(
          roomId,
          clientGeneratedId,
        );
        if (matrixStatus === 'sent') {
          console.warn(
            `sendMessage threw after matrix accepted clientGeneratedId=${clientGeneratedId}; ` +
              'leaving bubble in sending state for reconciliation.',
          );
          return;
        }

        this.unknownMessageSendError =
          'There was an error sending your message. This could be due to network issues, or serialization issues with the cards or files you are trying to send. It might be helpful to refresh the page and try again.';

        this.matrixService.patchPendingSend(roomId, clientGeneratedId, {
          status: 'not_sent',
          errorMessage: 'Failed to send',
        });
      }
    },
  );

  @cached
  private get topMostStackItems(): StackItem[] {
    // side effect: whenever the stack changes we reset the
    // auto-attached removed items state in a task to prevent rerender cycles
    this.resetAutoAttachedRemovedStateTask.perform();
    return this.operatorModeStateService.topMostStackItems();
  }

  private resetAutoAttachedRemovedStateTask = task(async () => {
    await Promise.resolve();
    this.removedAttachedCardIds.clear();
  });

  private get autoAttachedCardIds() {
    return this.autoAttachmentResource.cardIds;
  }

  private updateSkillIsActiveTask = task(
    async (isActive: boolean, skillCardId?: string) => {
      await new UpdateRoomSkillsTool(this.toolService.toolContext).execute({
        roomId: this.args.roomId,
        skillCardIdsToActivate: isActive ? [skillCardId!] : [],
        skillCardIdsToDeactivate: isActive ? [] : [skillCardId!],
      });
    },
  );

  private get isSending() {
    return this.doSendMessage.isRunning;
  }

  private get canSend() {
    return (
      !this.doSendMessage.isRunning &&
      Boolean(
        this.messageToSend?.trim() ||
        this.cardIdsToAttach?.length ||
        this.autoAttachedCardIds.size !== 0 ||
        this.filesToAttach?.length ||
        this.autoAttachedFiles.length > 0,
      ) &&
      !this.hasFileUploadIssues &&
      !!this.room &&
      // Block input only on a *failed* prior send. `doSendMessage` is an
      // enqueueTask, so concurrent sends are already serialized; a healthy
      // 'sending' bubble awaiting the matrix echo doesn't need a second
      // guard. A 'not_sent' bubble does need attention before the next send,
      // matching the retry-alert UX.
      !this.messages.some(
        (m) =>
          m.author.userId === this.matrixService.userId &&
          m.status === 'not_sent',
      ) &&
      !this.matrixService.isLoadingTimeline &&
      !this.aiAssistantPanelService.isPreparingSession
    );
  }

  // Where the latest turn starts: the reader's last message, or the first
  // message when no one has written yet. Messages from there on can still
  // change; the ones above it have settled.
  @cached
  private get latestTurnStart() {
    let messages = this.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.author.userId !== this.matrixService.aiBotUserId) {
        return i;
      }
    }
    return 0;
  }

  private isInLatestTurn = (index: number) => index >= this.latestTurnStart;

  @action
  private isLastMessage(messageIndex: number) {
    return (this.room && messageIndex === this.messages.length - 1) ?? false;
  }

  private isPendingMessage(message: Message) {
    return message.status === 'sending' || message.status === 'queued';
  }

  private attachSkillTask = task(async (cardId: string) => {
    let updateRoomSkillsCommand = new UpdateRoomSkillsTool(
      this.toolService.toolContext,
    );

    await updateRoomSkillsCommand.execute({
      roomId: this.args.roomId,
      skillCardIdsToActivate: [cardId],
    });
  });

  @action
  private setSelectedBottomAction(
    action: 'skill-menu' | 'llm-select' | undefined,
  ) {
    this.selectedBottomAction = action;
  }

  @action
  private skipSessionPreparation() {
    this.aiAssistantPanelService.skipSessionPreparation();
  }

  private get displaySkillMenu() {
    return (
      !this.selectedBottomAction || this.selectedBottomAction === 'skill-menu'
    );
  }

  private get displayLLMSelect() {
    return (
      !this.selectedBottomAction || this.selectedBottomAction === 'llm-select'
    );
  }

  // the ring, unless a menu is open and the row is the menu's
  private get shownContextFullness() {
    return this.selectedBottomAction ? undefined : this.contextFullness;
  }

  private get displayLLMModeSelect() {
    return this.displaySkillMenu && this.displayLLMSelect;
  }

  private get displayAttachedItems() {
    return (
      this.filesToAttach?.length ||
      this.cardIdsToAttach?.length ||
      this.autoAttachedFiles.length > 0 ||
      this.autoAttachedCardIds?.size
    );
  }

  @cached
  private get readyTools() {
    let lastMessage = this.messages[this.messages.length - 1];

    if (!lastMessage || !lastMessage.tools) {
      return [];
    }
    let roomResource = this.matrixService.roomResources.get(this.args.roomId);
    let activeMode = roomResource?.getActiveLLMModeForMessage(
      lastMessage.eventId,
    );
    let isOwnedByCurrentAgent =
      lastMessage.agentId === this.matrixService.agentId;
    return lastMessage.tools.filter(
      (command) =>
        (command.status === 'ready' || command.status === undefined) &&
        !this.toolService.currentlyExecutingToolRequestIds.has(command.id!) &&
        !this.toolService.executedToolRequestIds.has(command.id!) &&
        // A call ai-bot holds for approval is answered on its own, with its
        // full URL in view, never in bulk.
        !command.awaitsApproval &&
        // A question is answered by the user's pick, never by Accept all.
        !isAskUserTool(command) &&
        // Until its command is resolved, whether a call auto-executes is not
        // known yet.
        !command.isResolving &&
        // Commands destined for auto-execution must not surface the manual
        // Accept All / Cancel bar, even during the ~100ms debounce before
        // tool-service flips `acceptingAllRoomIds`. Without this filter,
        // the bar paints and then yanks itself once auto-execution starts,
        // which is the CS-11647 glitch.
        !isAutoExecutableTool(command, activeMode, isOwnedByCurrentAgent),
    );
  }

  private get generatingResults() {
    let lastMessage = this.messages[this.messages.length - 1];
    if (!lastMessage) {
      return false;
    }
    // The banner means "the AI is generating a reply". Only consider the bot's
    // streaming state — user messages don't carry `isStreamingFinished` on the
    // wire, so they read as not-streamed-yet even after they've landed. With
    // the optimistic bubble appearing at click-time, the user's message is the
    // last message for a longer window than before; without this author gate
    // the banner shows on the user's own pending bubble.
    if (lastMessage.author.userId !== this.matrixService.aiBotUserId) {
      return false;
    }
    return !lastMessage.isStreamingFinished;
  }

  // The assistant's loop is under way for its last message: the answer is
  // still streaming, or a tool that runs without the user's click has no
  // result yet, after which ai-bot starts the next turn on its own. Stop is
  // offered for all of it, and a stop ends the loop. A host tool runs only in
  // the client that sent the request, so only that client counts it as
  // running; elsewhere the tool shows as an ordinary call. A tool that can
  // never get a result (its result failed to send, or its answer ended in an
  // error) is not running either.
  @cached
  private get assistantLoopActive() {
    let lastMessage = this.messages[this.messages.length - 1];
    if (
      !lastMessage ||
      lastMessage.author.userId !== this.matrixService.aiBotUserId ||
      lastMessage.isCanceled ||
      lastMessage.errorMessage ||
      this.args.roomResource.isStopped(lastMessage.eventId)
    ) {
      return false;
    }
    if (!lastMessage.isStreamingFinished) {
      return true;
    }
    let activeMode = this.args.roomResource.getActiveLLMModeForMessage(
      lastMessage.eventId,
    );
    let isOwnedByCurrentAgent =
      lastMessage.agentId === this.matrixService.agentId;
    return lastMessage.tools.some(
      (tool) =>
        (tool.status === 'ready' ||
          tool.status === 'applying' ||
          tool.status === undefined) &&
        !tool.awaitsApproval &&
        !this.matrixService.failedToolState.has(tool.id!) &&
        (tool.executedBy === AI_BOT_EXECUTOR ||
          isAutoExecutableTool(tool, activeMode, isOwnedByCurrentAgent)),
    );
  }

  @cached
  private get displayActionBar() {
    let lastMessage = this.messages[this.messages.length - 1];
    if (
      (this.lastCanceledActionMessageId &&
        lastMessage?.eventId === this.lastCanceledActionMessageId) ||
      lastMessage?.isCanceled
    ) {
      return false;
    }
    // The cap's working row: the loop itself, with Stop. A turn that waits
    // on the reader isn't running, whatever else it has queued: the cap says
    // the decision instead, and a "Running tools · Stop" would contradict it.
    return this.assistantLoopActive && this.waitingDecisions === 0;
  }

  // What the assistant waits on, docked above the composer: the calls that
  // run on this tab's click, as one decision, then each call held for
  // approval on its own, with its reason.
  // Calls running in this tab right now.
  private get workingCalls() {
    return this.toolService.currentlyExecutingToolRequestIds.size;
  }

  // Decisions the last turn waits on: calls ready for a click, questions,
  // and calls held for approval.
  private get waitingDecisions() {
    let last = this.messages[this.messages.length - 1];
    if (!last || last.author.userId !== this.matrixService.aiBotUserId) {
      return 0;
    }
    return (last.tools ?? []).filter(
      (tool) =>
        (tool.status === 'ready' || tool.status === undefined) &&
        !this.toolService.currentlyExecutingToolRequestIds.has(tool.id ?? '') &&
        (isAskUserTool(tool) ||
          tool.awaitsApproval ||
          this.readyTools.includes(tool)),
    ).length;
  }

  // Changes whenever the transcript's content does: how many messages,
  // and the last one's text and calls. The conversation pins a following
  // reader to the end in the same render, so the transcript's motion region
  // moves what that scroll moved instead of letting it jump.
  private get transcriptRevision() {
    let last = this.messages[this.messages.length - 1];
    return [
      this.messages.length,
      last?.eventId,
      last?.body?.length ?? 0,
      (last?.tools ?? []).map((t) => t.status).join(','),
    ].join('|');
  }

  // The cap shows whenever it has a status to say: a decision, work, a
  // script's plan, or the reader's turn.
  private get capWanted() {
    return (
      this.gates.length > 0 ||
      this.displayActionBar ||
      this.stoppingCalls ||
      Boolean(this.livePlan) ||
      this.workingCalls > 0 ||
      this.waitingDecisions > 0
    );
  }

  // Between two phases (a reply ends, its tools start) the cap would leave
  // for a moment and come back; it holds instead, so the transcript above
  // doesn't move twice.
  @tracked private capHeld = false;
  private capRelease: ReturnType<typeof setTimeout> | undefined;
  private holdCap = (wanted: boolean) => {
    if (wanted) {
      if (this.capRelease) {
        clearTimeout(this.capRelease);
        this.capRelease = undefined;
      }
      if (!this.capHeld) {
        scheduleOnce('afterRender', this, this.setCapHeld, true);
      }
    } else if (this.capHeld && !this.capRelease) {
      this.capRelease = setTimeout(() => {
        this.capRelease = undefined;
        this.setCapHeld(false);
      }, CAP_HOLD_MS);
    }
    return '';
  };
  private setCapHeld(value: boolean) {
    if (!this.isDestroying && !this.isDestroyed) {
      // let go: the slot stays while it closes, in the same update
      if (!value && this.capHeld) {
        this.capClosing = true;
        clearTimeout(this.capCloseFallback);
        this.capCloseFallback = setTimeout(
          () => this.capSlotClosed(),
          CAP_CLOSE_FALLBACK_MS,
        );
      }
      if (value) {
        this.capClosing = false;
      }
      this.capHeld = value;
    }
  }

  // A new slot opens over the same beat it closes in. A Web Animation's
  // clock starts on the first frame after it is created, so the long task
  // that inserts the slot doesn't eat into it, as it would a CSS transition.
  private openCapSlot = modifier((element: HTMLElement) => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    let opening = element.animate(
      [
        { gridTemplateRows: '0fr', marginBottom: '0px' },
        { gridTemplateRows: '1fr', marginBottom: '-12px' },
      ],
      { duration: 260, easing: 'cubic-bezier(0.3, 0.1, 0.3, 1)' },
    );
    return () => opening.cancel();
  });

  // the cap's slot, while the cap shows and while its slot closes
  @tracked private capClosing = false;
  private capCloseFallback: ReturnType<typeof setTimeout> | undefined;
  private get capSlotRendered() {
    return this.showsCap || this.capClosing;
  }
  private capSlotClosed = (event?: Event) => {
    if (event && event.target !== event.currentTarget) {
      return;
    }
    clearTimeout(this.capCloseFallback);
    if (!this.isDestroying && !this.isDestroyed && !this.showsCap) {
      this.capClosing = false;
    }
  };
  private get showsCap() {
    return this.capWanted || this.capHeld;
  }

  // What a streaming reply is doing, in the cap: thinking until its words
  // start, then writing them
  private get streamingLabel(): string {
    let last = this.messages[this.messages.length - 1];
    return last?.body?.trim() ? 'Writing the answer' : 'Thinking';
  }

  // What the cap says now. Recorded while it has something to say, so that
  // while it holds or leaves it keeps its last words instead of emptying
  // first. Plain (untracked) memory of what was last drawn.
  private get capState(): CapState {
    return {
      gates: this.gates,
      gateBusy: this.isAcceptingAll,
      gateBusyLabel: this.acceptingAllLabel,
      working: this.displayActionBar || this.stoppingCalls,
      workingLabel: this.stoppingCalls
        ? 'Stopping'
        : this.generatingResults
          ? this.streamingLabel
          : this.lastReplyHasTools
            ? 'Running tools'
            : 'Working',
      stopping: this.stopGeneratingTask.isRunning || this.stoppingCalls,
      workingCalls: this.workingCalls,
      waitingDecisions: this.waitingDecisions,
      plan: this.livePlan,
    };
  }
  private lastCapState: CapState | undefined;
  private capShown = (state: CapState): CapState => {
    if (this.capWanted || !this.lastCapState) {
      this.lastCapState = state;
      return state;
    }
    return this.lastCapState;
  };

  // "Running tools" only for a reply that has tool calls: a reply with
  // none that is still settling is just working
  private get lastReplyHasTools() {
    let last = this.messages[this.messages.length - 1];
    return Boolean(last?.tools?.length);
  }

  // Gate rows that have been waiting long enough to point back to.
  private settledPointers = new TrackedSet<string>();
  private pointerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pointerSettled(id: string | undefined) {
    if (!id) {
      return true;
    }
    if (this.settledPointers.has(id)) {
      return true;
    }
    if (!this.pointerTimers.has(id)) {
      this.pointerTimers.set(
        id,
        setTimeout(() => {
          if (!this.isDestroying && !this.isDestroyed) {
            this.settledPointers.add(id);
          }
        }, POINTER_SETTLE_MS),
      );
    }
    return false;
  }

  // A stop the reader pressed while a call still runs: the call is asked
  // to stop and ends its current step, so the cap says so until it has.
  private get stoppingCalls() {
    let last = this.messages[this.messages.length - 1];
    return Boolean(
      last &&
      this.workingCalls > 0 &&
      this.args.roomResource.isStopped(last.eventId),
    );
  }

  // "New messages" shows once the reader has really been left behind, not
  // for the frame the cap takes to grow under a reader at the end.
  @tracked private unreadChipShown = false;
  private unreadTimer: ReturnType<typeof setTimeout> | undefined;
  private settleUnread = (shown: boolean) => {
    if (shown) {
      if (!this.unreadChipShown && !this.unreadTimer) {
        this.unreadTimer = setTimeout(() => {
          this.unreadTimer = undefined;
          if (!this.isDestroying && !this.isDestroyed) {
            this.unreadChipShown = this.showUnreadIndicator;
          }
        }, UNREAD_SETTLE_MS);
      }
    } else {
      if (this.unreadTimer) {
        clearTimeout(this.unreadTimer);
        this.unreadTimer = undefined;
      }
      if (this.unreadChipShown) {
        scheduleOnce('afterRender', this, this.hideUnreadChip);
      }
    }
    return '';
  };
  private hideUnreadChip() {
    if (!this.isDestroying && !this.isDestroyed) {
      this.unreadChipShown = false;
    }
  }

  private get gates(): Gate[] {
    let lastMessage = this.messages[this.messages.length - 1];
    if (
      !lastMessage ||
      (this.lastCanceledActionMessageId &&
        lastMessage.eventId === this.lastCanceledActionMessageId) ||
      lastMessage.isCanceled
    ) {
      return [];
    }
    let gates: Gate[] = [];
    let ready = this.readyTools;
    // one call waiting on a click, with its row on screen, is asked in the
    // row only; the dock stays for several at once, or for one out of view
    let askedInRow =
      ready.length === 1 &&
      Boolean(ready[0]!.id && this.openGatesInView.has(ready[0]!.id));
    // a lone call whose title hasn't resolved yet is asked in its row only:
    // a placeholder "Run the tool call" would flash first
    let untitled = ready.length === 1 && !ready[0]!.description;
    if ((ready.length > 0 && !askedInRow && !untitled) || this.isAcceptingAll) {
      let first = ready[0];
      gates.push({
        key: 'ready',
        label:
          ready.length > 1
            ? `Run ${ready.length} tool calls`
            : first?.description
              ? plainTitle(first.description)
              : 'Run the tool call',
        approveLabel: ready.length > 1 ? 'Accept all' : 'Accept',
        approve: () => this.executeAllReadyActionsTask.perform(),
        declineLabel: 'Cancel',
        decline: () => this.cancelActionBar(),
        review: first ? () => this.revealToolCall(first.id) : undefined,
        isBulk: true,
      });
    }
    for (let tool of lastMessage.tools ?? []) {
      // A question or an approval is answered in its own row. The dock
      // repeats it only while that row is out of view, as a pointer back.
      if (tool.id && this.openGatesInView.has(tool.id)) {
        continue;
      }
      // a question or approval just arrived: its row is still landing and
      // scrolling into view, so the cap waits a beat before pointing at it
      if (!this.pointerSettled(tool.id)) {
        continue;
      }
      if (
        isAskUserTool(tool) &&
        (tool.status === 'ready' || tool.status === undefined)
      ) {
        let question = tool.arguments?.attributes?.question;
        gates.push({
          key: tool.id ?? 'ask-user',
          label: 'A question is waiting',
          detail: typeof question === 'string' ? question : undefined,
          approveLabel: 'Show it',
          approve: () => this.revealToolCall(tool.id),
          isPointer: true,
          noun: 'question',
        });
        continue;
      }
      if (
        !tool.awaitsApproval ||
        tool.isResolving ||
        !(tool.status === 'ready' || tool.status === undefined) ||
        this.toolService.currentlyExecutingToolRequestIds.has(tool.id!)
      ) {
        continue;
      }
      // asked in its row, like a question: the dock only points back to it
      // while the row is out of view, as one line of the same height, so
      // the decision never moves between the row and the dock
      gates.push({
        key: tool.id ?? tool.name ?? 'approval',
        label: 'An approval is waiting',
        detail: tool.description ? plainTitle(tool.description) : undefined,
        approveLabel: 'Show it',
        approve: () => this.revealToolCall(tool.id),
        isPointer: true,
      });
    }
    return gates;
  }

  // A run of messages that each carry one finished call to the same tool and
  // nothing else (a correctness check after every save) folds into its
  // latest message, which reads "×N"; the latest stays, so the end of the
  // conversation never moves. A failed call never folds: it stays in view.
  @cached
  private get toolRuns(): { counts: Map<number, number>; folded: Set<number> } {
    let counts = new Map<number, number>();
    let folded = new Set<number>();
    let soloTool = (message: Message | undefined) => {
      if (
        !message ||
        message.author.userId !== this.matrixService.aiBotUserId ||
        message.tools?.length !== 1 ||
        message.htmlParts?.length ||
        message.reasoningContent
      ) {
        return undefined;
      }
      let tool = message.tools[0]!;
      return tool.status === 'applied' ? tool.name : undefined;
    };
    let previous: string | undefined;
    let run = 0;
    this.messages.forEach((message, index) => {
      let name = soloTool(message);
      if (name && name === previous) {
        folded.add(index - 1);
        counts.delete(index - 1);
        run += 1;
        counts.set(index, run);
      } else {
        run = 1;
      }
      previous = name;
    });
    return { counts, folded };
  }

  private isFoldedMessage = (index: number) =>
    this.toolRuns.folded.has(index) || this.isEmptyStop(index);

  // A reply the assistant stopped before it said or did anything, with
  // something after it (a delivered result, the next turn): it carries
  // nothing, so it takes no line ("Stopped before it answered" over the
  // answer that came anyway). The latest message keeps its stopped line.
  private isEmptyStop(index: number): boolean {
    let message = this.messages[index];
    if (
      !message ||
      index === this.messages.length - 1 ||
      message.author.userId !== this.matrixService.aiBotUserId ||
      !message.isCanceled
    ) {
      return false;
    }
    let reasoning = message.reasoningContent?.trim();
    return (
      !message.body?.trim() &&
      !message.tools?.length &&
      (!reasoning || reasoning === 'Thinking...')
    );
  }

  // ── turns: the fold and the answer footer ─────────────────────────────

  // Turns the reader unfolded, by the turn's first assistant message.
  private expandedTurns = new TrackedSet<string>();

  // Each assistant turn: the run of assistant messages after one of the
  // reader's. A turn that has finished, and that the reader has since
  // answered, folds its tool rows into one summary line; its prose stays.
  // Its final reply gets the answer footer.
  @cached
  private get turns(): {
    folds: Map<number, TurnFold>;
    footers: Map<number, AnswerFooterData>;
    heads: Map<number, TurnHead>;
    places: Map<number, TurnPlace>;
  } {
    let folds = new Map<number, TurnFold>();
    let footers = new Map<number, AnswerFooterData>();
    let heads = new Map<number, TurnHead>();
    let places = new Map<number, TurnPlace>();
    let messages = this.messages;
    let botId = this.matrixService.aiBotUserId;
    let i = 0;
    while (i < messages.length) {
      if (messages[i]!.author.userId === botId) {
        i++;
        continue;
      }
      let asked = messages[i]!;
      let start = i + 1;
      let end = start;
      while (end < messages.length && messages[end]!.author.userId === botId) {
        end++;
      }
      i = end;
      if (end === start) {
        continue;
      }
      let turn = messages.slice(start, end);
      let tools = turn.flatMap((message) => message.tools ?? []);
      let finished =
        turn.every((message) => message.isStreamingFinished) &&
        tools.every(
          (tool) =>
            (tool.status === 'applied' ||
              tool.status === 'failed' ||
              tool.status === 'invalid' ||
              tool.status === 'canceled') &&
            !this.toolService.liveRunToolIds.has(tool.id ?? '') &&
            !this.toolService.currentlyExecutingToolRequestIds.has(
              tool.id ?? '',
            ),
        ) &&
        !(end === messages.length && this.awaitsContinuation(turn.at(-1)!));
      let key = turn[0]!.eventId;
      let thinking = turn.some((message) => !!message.reasoningContent);
      for (let index = start; index < end; index++) {
        places.set(index, {
          key,
          working: !finished,
          last: index === end - 1,
        });
      }
      if (!finished) {
        heads.set(start, { working: true, at: asked.created });
        continue;
      }
      // the turn ran from the question to its replies' last server event
      // (a reply begins with a placeholder sent at once, so its `created` is
      // when it started, not when it finished); `updated` is this client's
      // clock and resets on reload, so it is not used
      let ended = Math.max(
        ...turn.map((message) =>
          (message.lastEventAt ?? message.created).getTime(),
        ),
      );
      let seconds = (ended - asked.created.getTime()) / 1000;
      let answered = end < messages.length;
      // a turn that folds says what it did in its fold line; the others get
      // the assistant's mark and how long they took
      if (!(answered && tools.length > 1)) {
        heads.set(start, {
          working: false,
          seconds,
          at: asked.created,
          calls: tools.length,
          files: this.turnDiff(tools)?.files,
          thinking,
        });
      }
      // one row already is one line: folding it would only hide what it
      // says ("Which poster · Night Shift" beats "Asked 1 question")
      if (answered && tools.length > 1) {
        let key = turn[0]!.eventId;
        let expanded = this.expandedTurns.has(key);
        let stopped = tools.filter((tool) =>
          tool.failureReason?.startsWith(STOPPED_BY_USER),
        ).length;
        let failed = tools.filter(
          (tool, index) =>
            tool.status === 'failed' &&
            !tool.failureReason?.startsWith(STOPPED_BY_USER) &&
            !tools.slice(index + 1).some((later) => later.status === 'applied'),
        ).length;
        let summary = turnSummary(
          tools.map((tool) => tool.name ?? 'tool'),
          { seconds, failed, stopped },
        );
        let firstWithTools = turn.findIndex((m) => m.tools?.length);
        for (let k = start; k < end; k++) {
          folds.set(k, {
            key,
            summary,
            expanded,
            isFirst: k === start + firstWithTools,
            toggle: () => this.toggleTurn(key),
          });
        }
      }
      // the final reply: the turn's last message that says something
      let replyIndex = -1;
      for (let k = end - 1; k >= start; k--) {
        if (messages[k]!.body?.trim()) {
          replyIndex = k;
          break;
        }
      }
      // the quiet actions sit under the latest answer, as the board draws
      // them; older turns are history, and the session line has the cost.
      // Every settled turn gets one, and all but the latest are marked
      // superseded below: a superseded footer stays as it was, losing only
      // Retry, so the turn above never gets shorter when the next one
      // settles (ADR 013 §1.16)
      if (replyIndex >= 0) {
        let costUsd = 0;
        let costed = false;
        for (let message of turn) {
          if (message.usage?.costUsd != null) {
            costUsd += message.usage.costUsd;
            costed = true;
          }
        }
        let reply = messages[replyIndex]!;
        let diff = this.turnDiff(tools);
        footers.set(replyIndex, {
          diff,
          markdown: reply.body,
          credits: costed ? formatCredits(costUsd) : undefined,
          // Retry is for a turn that went wrong: an error, a call that
          // failed or was invalid, a reply that was stopped. A turn that
          // answered needs no second try offered
          retry:
            !answered &&
            this.isLastMessage(replyIndex) &&
            (turn.some((m) => m.errorMessage || m.isCanceled) ||
              tools.some(
                (tool) => tool.status === 'failed' || tool.status === 'invalid',
              ))
              ? this.resendLastMessage
              : undefined,
          saveAsCard: this.canSaveAnswer(reply.body)
            ? () => this.saveAnswer(asked.body, reply.body)
            : undefined,
        });
      }
    }
    let latest = Math.max(-1, ...footers.keys());
    for (let [index, footer] of footers) {
      if (index !== latest) {
        footer.superseded = true;
        footer.retry = undefined;
      }
    }
    return { folds, footers, heads, places };
  }

  // The bot answers the results of its last message's calls with another
  // reply (getShouldRespond), but that reply's first event comes a moment
  // after the last result. Until it does, the turn is still going: settling
  // it would show the footer and the fold for that moment, and take them
  // away again as the reply lands. The turn's own check has already asked
  // that each call has its outcome (an approval is a result event too, but
  // its call reads as applying until ai-bot posts the outcome).
  private lapsedContinuations = new TrackedSet<string>();
  private continuationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private awaitsContinuation(last: Message): boolean {
    let tools = last.tools ?? [];
    if (
      !tools.length ||
      last.author.userId !== this.matrixService.aiBotUserId ||
      !last.isStreamingFinished ||
      last.isCanceled ||
      last.errorMessage ||
      this.args.roomResource.isStopped(last.eventId) ||
      this.lapsedContinuations.has(last.eventId) ||
      tools.some(
        (tool) =>
          !tool.toolResultEventTs ||
          tool.failureReason?.startsWith(STOPPED_BY_USER),
      )
    ) {
      return false;
    }
    let answeredAt = Math.max(...tools.map((tool) => tool.toolResultEventTs!));
    if (Date.now() - answeredAt > CONTINUATION_STALE_MS) {
      return false;
    }
    // The result's age is read on the homeserver's clock, against the
    // room's newest event, so a browser clock that is ahead or behind does
    // not shorten or stretch the wait; what is left of it is counted down on
    // this browser's clock from when it first saw the result.
    let newest = Math.max(
      answeredAt,
      ...this.messages.map((message) => message.created.getTime()),
    );
    let wait = answeredAt + CONTINUATION_WAIT_MS - newest;
    if (wait <= 0) {
      return false;
    }
    if (!this.continuationTimers.has(last.eventId)) {
      this.continuationTimers.set(
        last.eventId,
        setTimeout(() => {
          if (!this.isDestroying && !this.isDestroyed) {
            this.lapsedContinuations.add(last.eventId);
          }
        }, wait),
      );
    }
    return true;
  }

  // What a turn's calls changed in source files, summed from their rows.
  private turnDiff(tools: { id?: string | null }[]): AnswerFooterData['diff'] {
    let files = 0;
    let added = 0;
    let removed = 0;
    let perFile: NonNullable<AnswerFooterData['diff']>['perFile'] = [];
    for (let tool of tools) {
      let stats = tool.id
        ? this.toolService.toolDiffStats.get(tool.id)
        : undefined;
      if (stats) {
        files += stats.files;
        added += stats.added;
        removed += stats.removed;
        perFile.push(...(stats.perFile ?? []));
      }
    }
    if (!files) {
      return undefined;
    }
    return { files, added, removed, perFile };
  }

  private turnFoldFor = (index: number) => this.turns.folds.get(index);

  private answerFooterFor = (index: number) => {
    let footer = this.turns.footers.get(index);
    // the latest answer's footer carries the session's total too, on the
    // same line, rather than a second line of credits under it
    if (footer && index === this.sessionFooterIndex) {
      return {
        ...footer,
        credits: [footer.credits, `${this.conversationCredits} this session`]
          .filter(Boolean)
          .join(' · '),
      };
    }
    return footer;
  };

  // The answer whose footer says the session's total: the latest one, when
  // it ends the transcript
  private get sessionFooterIndex(): number | undefined {
    if (!this.showsSessionTotal || !this.conversationCredits) {
      return undefined;
    }
    let last = this.messages.length - 1;
    let footer = this.turns.footers.get(last);
    return footer && !footer.superseded ? last : undefined;
  }

  private turnHeadFor = (index: number) => {
    let head = this.turns.heads.get(index);
    let place = this.turns.places.get(index);
    if (!head || !place || head.working || !head.thinking) {
      return head;
    }
    let key = place.key;
    return {
      ...head,
      thinkingShown: this.shownThinking.has(key),
      toggleThinking: () => {
        if (this.shownThinking.has(key)) {
          this.shownThinking.delete(key);
        } else {
          this.shownThinking.add(key);
        }
      },
    };
  };

  // Where a reply's reasoning shows. While its turn works, only the turn's
  // last part shows it, as one line at the end that moves on as the work
  // does; once the turn settles it shows only when the reader asks, from
  // the turn's header. A message outside a turn keeps its own trace.
  private reasoningModeFor = (index: number): ReasoningMode | undefined => {
    let place = this.turns.places.get(index);
    if (!place) {
      return undefined;
    }
    if (place.working) {
      // the tail is the reasoning nothing has followed yet: once the part
      // has a call or words, those say where the work is
      let message = this.messages[index];
      let followed = !!message?.tools?.length || !!message?.body?.trim().length;
      return place.last && !followed ? 'tail' : 'hidden';
    }
    return this.shownThinking.has(place.key) ? 'shown' : 'hidden';
  };

  // the turns whose thinking the reader opened, by first reply
  private shownThinking = new TrackedSet<string>();

  private toggleTurn = (key: string) => {
    if (this.expandedTurns.has(key)) {
      this.expandedTurns.delete(key);
    } else {
      this.expandedTurns.add(key);
    }
  };

  // A reply worth keeping is one with structure: a heading, a table or a
  // list, long enough to be read again. It saves as a markdown file card in
  // the open workspace, when the reader can write there.
  private canSaveAnswer(markdown: string) {
    let realmURL = this.operatorModeStateService.realmURL;
    if (!realmURL || !this.realm.canWrite(realmURL)) {
      return false;
    }
    return (
      markdown.length >= 400 && /^(#{1,6} |\|.*\||[-*] |\d+\. )/m.test(markdown)
    );
  }

  private saveAnswer = async (question: string, markdown: string) => {
    let realmURL = this.operatorModeStateService.realmURL;
    if (!realmURL) {
      throw new Error('There is no open workspace to save the answer in');
    }
    let heading = markdown.match(/^#{1,6}\s+(.+)$/m)?.[1];
    let title = (heading ?? question).replace(/[#*_`]/g, '').trim();
    let slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'answer';
    let date = new Date().toISOString().slice(0, 10);
    let url = new URL(`Assistant Notes/${date}-${slug}.md`, realmURL);
    let content = heading ? markdown : `# ${title}\n\n${markdown}`;
    await this.cardService.saveSource(url, content, 'create-file');
    return url.href;
  };

  private foldCountFor = (index: number) => this.toolRuns.counts.get(index);

  // The calls whose open question or approval is on screen right now, read
  // from the rows themselves (`data-gate-open`). The dock leaves those out,
  // so a decision is never asked in two places at once.
  private openGatesInView = new TrackedSet<string>();
  private planRowsInView = new TrackedSet<string>();

  // The plan a running script is working through, for the turn's checklist
  // above the composer while that script's row is out of view.
  private get livePlan(): { steps: TaskStep[]; activity?: string } | undefined {
    for (let id of this.toolService.currentlyExecutingToolRequestIds) {
      let progress = this.toolService.toolProgress.get(id)?.progress;
      if (!progress?.plan?.length || this.planRowsInView.has(id)) {
        continue;
      }
      let current = progress.step;
      return {
        steps: progress.plan.map((label, i) => ({
          label,
          state: (i + 1 < current
            ? 'done'
            : i + 1 === current
              ? 'current'
              : 'next') as TaskStep['state'],
        })),
        activity: progress.label,
      };
    }
    return undefined;
  }

  private watchOpenGates = modifier((element: HTMLElement) => {
    // rows that wait on the reader, and rows whose script is working
    // through a plan: the dock and the turn checklist leave out what is on
    // screen already
    let watched: [
      attribute: string,
      key: string,
      inView: TrackedSet<string>,
    ][] = [
      ['data-gate-open', 'gateOpen', this.openGatesInView],
      ['data-plan-live', 'planLive', this.planRowsInView],
    ];
    let observed = new Set<Element>();
    let idsOf = (el: Element) =>
      watched.flatMap(([, key, inView]) => {
        let id = (el as HTMLElement).dataset[key];
        return id ? [[id, inView] as const] : [];
      });
    let intersections = new IntersectionObserver((entries) => {
      for (let entry of entries) {
        for (let [id, inView] of idsOf(entry.target)) {
          if (entry.isIntersecting) {
            inView.add(id);
          } else {
            inView.delete(id);
          }
        }
      }
    });
    let selector = watched.map(([attribute]) => `[${attribute}]`).join(',');
    let sync = () => {
      let current = new Set(element.querySelectorAll(selector));
      for (let el of observed) {
        if (!current.has(el)) {
          intersections.unobserve(el);
          observed.delete(el);
          for (let [id, inView] of idsOf(el)) {
            inView.delete(id);
          }
        }
      }
      for (let el of current) {
        if (!observed.has(el)) {
          observed.add(el);
          intersections.observe(el);
        }
      }
    };
    let mutations = new MutationObserver(sync);
    mutations.observe(element, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: watched.map(([attribute]) => attribute),
    });
    sync();
    return () => {
      mutations.disconnect();
      intersections.disconnect();
      this.openGatesInView.clear();
      this.planRowsInView.clear();
    };
  });

  // Bring a call's row into view, so Review shows what is being approved.
  private revealToolCall(toolCallId: string | undefined) {
    if (!toolCallId) {
      return;
    }
    let row = document.querySelector<HTMLElement>(
      `[data-tool-call-id="${CSS.escape(toolCallId)}"]`,
    );
    if (row) {
      this.showRow(row);
    }
  }

  // A row brought into view through the transcript's scroll owner, which
  // anchors it while the scroll lands; scrollIntoView only without one
  private showRow(row: HTMLElement) {
    if (this.navigateConversation) {
      this.navigateConversation(row, { block: 'center', behavior: 'smooth' });
    } else {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  private async executeReadyCommands() {
    for (let command of this.readyTools) {
      this.acceptingAllLabel = command.actionVerb;
      await this.toolService.run.unlinked().perform(command);
      this.acceptingAllLabel = undefined;
    }
  }

  private executeAllReadyActionsTask = task(async () => {
    await this.executeReadyCommands();
  });

  @action
  private cancelActionBar() {
    let lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage) {
      this.lastCanceledActionMessageId = lastMessage.eventId;
      this.matrixService.markActionAsCanceled(
        this.args.roomId,
        lastMessage.eventId,
      );
    }
  }

  // Stop means stop: the reply ends, and so does every call still running
  // that can be stopped (a script halts at its next realm call), rather
  // than finishing its work behind a cap that says it stopped.
  private stopGeneratingTask = task(async () => {
    this.toolService.stopToolsInRoom(this.args.roomId);
    await this.matrixService.sendStopGeneratingEvent(this.args.roomId);
  });
}
