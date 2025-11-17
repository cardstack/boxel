import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import {
  enqueueTask,
  restartableTask,
  timeout,
  all,
  task,
} from 'ember-concurrency';

import perform from 'ember-concurrency/helpers/perform';
import { consume } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';
import max from 'lodash/max';

import { MatrixEvent } from 'matrix-js-sdk';

import pluralize from 'pluralize';

import { TrackedObject, TrackedArray } from 'tracked-built-ins';

import { v4 as uuidv4 } from 'uuid';

import { Alert, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { and, eq, not } from '@cardstack/boxel-ui/helpers';

import {
  type getCard,
  GetCardContextName,
  ResolvedCodeRef,
  internalKeyFor,
  isCardInstance,
} from '@cardstack/runtime-common';
import {
  DEFAULT_LLM_LIST,
  DEFAULT_LLM_ID_TO_NAME,
} from '@cardstack/runtime-common/matrix-constants';

import UpdateRoomSkillsCommand from '@cardstack/host/commands/update-room-skills';
import { Message } from '@cardstack/host/lib/matrix-classes/message';
import type { StackItem } from '@cardstack/host/lib/stack-item';
import { getAutoAttachment } from '@cardstack/host/resources/auto-attached-card';
import { RoomResource } from '@cardstack/host/resources/room';

import type AiAssistantPanelService from '@cardstack/host/services/ai-assistant-panel-service';
import type CardService from '@cardstack/host/services/card-service';
import type CommandService from '@cardstack/host/services/command-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type SpecPanelService from '@cardstack/host/services/spec-panel-service';
import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { FileDef } from 'https://cardstack.com/base/file-api';

import AiAssistantActionBar from '../ai-assistant/action-bar';
import AiAssistantAttachmentPicker from '../ai-assistant/attachment-picker';
import AiAssistantChatInput from '../ai-assistant/chat-input';
import FocusPill from '../ai-assistant/focus-pill';
import LLMModeToggle from '../ai-assistant/llm-mode-toggle';
import LLMSelect from '../ai-assistant/llm-select';
import { AiAssistantConversation } from '../ai-assistant/message';
import NewSession from '../ai-assistant/new-session';
import AiAssistantSkillMenu from '../ai-assistant/skill-menu';

import { Submodes } from '../submode-switcher';

import RoomMessage from './room-message';

import type RoomData from '../../lib/matrix-classes/room';
import type { RoomSkill } from '../../resources/room';

interface Signature {
  Element: HTMLElement;
  Args: {
    roomId: string;
    roomResource: RoomResource;
    monacoSDK: MonacoSDK;
    selectedCardRef?: ResolvedCodeRef;
  };
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
        ...attributes
      >
        <AiAssistantConversation
          @registerConversationScroller={{this.registerConversationScroller}}
          @setScrollPosition={{this.setScrollPosition}}
        >
          {{#if this.matrixService.isLoadingTimeline}}
            <div class='session-preparation-container'>
              <LoadingIndicator
                @color='var(--boxel-light)'
                class='loading-indicator'
              />
            </div>
          {{else if this.aiAssistantPanelService.isPreparingSession}}
            <div
              class='session-preparation-container'
              data-test-session-preparation
            >
              <LoadingIndicator
                @color='var(--boxel-light)'
                class='loading-indicator'
              />
              <span class='session-preparation-message'>
                {{#if
                  (and
                    this.aiAssistantPanelService.isSummarizingSession
                    this.aiAssistantPanelService.isCopyingFileHistory
                  )
                }}
                  Summarizing session and copying files
                {{else if this.aiAssistantPanelService.isSummarizingSession}}
                  Summarizing previous session
                {{else if this.aiAssistantPanelService.isCopyingFileHistory}}
                  Copying file history from previous session
                {{else}}
                  Preparing session context
                {{/if}}
              </span>
              <span class='session-preparation-message'>
                Please keep Assistant open
              </span>
              <span class='session-preparation-small-message'>
                Takes 10-20 seconds
              </span>
              <button
                type='button'
                class='session-preparation-skip-button'
                {{on 'click' this.skipSessionPreparation}}
                data-test-session-preparation-skip-button
              >
                Skip
              </button>
            </div>
          {{else}}
            {{#each this.messages key='eventId' as |message i|}}
              <RoomMessage
                @roomId={{@roomId}}
                @roomResource={{@roomResource}}
                @index={{i}}
                @registerScroller={{this.registerMessageScroller}}
                @isPending={{this.isPendingMessage message}}
                @monacoSDK={{@monacoSDK}}
                @isStreaming={{this.isMessageStreaming message}}
                @retryAction={{this.maybeRetryAction i message}}
                data-test-message-idx={{i}}
              />
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
            @chooseFile={{this.chooseFile}}
            @removeFile={{this.removeFile}}
            @autoAttachedFile={{this.autoAttachedFile}}
            @filesToAttach={{this.filesToAttach}}
            @autoAttachedCardTooltipMessage={{if
              (eq this.operatorModeStateService.state.submode Submodes.Code)
              'Current card is shared automatically'
              'Topmost card is shared automatically'
            }}
            as |AttachedItems AttachButton|
          >
            {{#if this.displayActionBar}}
              <AiAssistantActionBar
                @acceptAll={{perform this.executeAllReadyActionsTask}}
                @cancel={{this.cancelActionBar}}
                @acceptingAll={{this.isAcceptingAll}}
                @acceptingAllLabel={{this.acceptingAllLabel}}
                @generatingResults={{this.generatingResults}}
                @stop={{perform this.stopGeneratingTask}}
                @stopping={{this.stopGeneratingTask.isRunning}}
                @showUnreadIndicator={{this.showUnreadIndicator}}
                @unreadMessageText={{this.unreadMessageText}}
                @scrollToFirstUnread={{this.scrollToFirstUnread}}
              />
            {{/if}}
            <div class='chat-input-area' data-test-chat-input-area>
              <AiAssistantChatInput
                @attachButton={{AttachButton}}
                @value={{this.messageToSend}}
                @onInput={{this.setMessage}}
                @onSend={{this.sendMessage}}
                @canSend={{this.canSend}}
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
                {{#if this.displaySkillMenu}}
                  <AiAssistantSkillMenu
                    class='skill-menu'
                    @skills={{this.sortedSkills}}
                    @onChooseCard={{perform this.attachSkillTask}}
                    @onUpdateSkillIsActive={{perform
                      this.updateSkillIsActiveTask
                    }}
                    @onExpand={{fn this.setSelectedBottomAction 'skill-menu'}}
                    @onCollapse={{fn this.setSelectedBottomAction undefined}}
                    data-test-skill-menu
                  />
                {{/if}}
                {{#if this.displayLLMSelect}}
                  <LLMSelect
                    class='llm-select'
                    @selected={{@roomResource.activeLLM}}
                    @onChange={{perform @roomResource.activateLLMTask}}
                    @options={{this.llmsForSelectMenu}}
                    @disabled={{@roomResource.isActivatingLLM}}
                    @onExpand={{fn this.setSelectedBottomAction 'llm-select'}}
                    @onCollapse={{fn this.setSelectedBottomAction undefined}}
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
          </AiAssistantAttachmentPicker>
        </footer>
      </section>
    {{/if}}

    <style scoped>
      .room {
        display: grid;
        grid-template-rows: 1fr auto;
        height: 100%;
        overflow: hidden;
        position: relative;

        --chat-input-area-border-radius: var(--boxel-border-radius-xxl);
      }
      .room-actions {
        position: relative;
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

      .chat-input-area {
        --boxel-pill-menu-header-padding: 0;
        --boxel-pill-menu-content-padding: var(--boxel-sp) 0;
        --boxel-pill-menu-footer-padding: 0;
        --boxel-pill-menu-button-padding: 2px 6px;

        --chat-input-area-bottom-padding: var(--boxel-sp-sm);

        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        border-radius: var(--chat-input-area-border-radius);

        position: relative;
        z-index: 2;

        timeline-scope: --chat-input-scroll-timeline;
      }
      .chat-input-area__bottom-actions {
        display: flex;
        align-items: center;
        padding: var(--chat-input-area-bottom-padding);
        gap: var(--boxel-sp-sm);
        background-color: var(--boxel-light-100);
        border-bottom-left-radius: var(--chat-input-area-border-radius);
        border-bottom-right-radius: var(--chat-input-area-border-radius);
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

      :deep(.ai-assistant-conversation > *:first-child) {
        margin-top: auto;
      }

      .session-preparation-container {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 100%;
        gap: 4px;
      }

      .loading-indicator {
        margin-bottom: var(--boxel-sp-xxs);
      }

      .session-preparation-message {
        text-align: center;
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);
      }

      .session-preparation-small-message {
        color: var(--boxel-400);
        font: 500 var(--boxel-font-xs);
      }

      .session-preparation-skip-button {
        background: none;
        border: 1px solid var(--boxel-400);
        border-radius: var(--boxel-border-radius-lg);
        color: var(--boxel-light);
        font: 500 var(--boxel-font-xs);
        padding: 4px 12px;
        cursor: pointer;
        transition: all 0.2s ease;
        margin-top: var(--boxel-sp-sm);
      }

      .session-preparation-skip-button:hover {
        background: var(--boxel-400);
        color: var(--boxel-light);
      }

      .chat-input-area :deep(.pill-menu-button) {
        height: 22px;
        gap: var(--boxel-sp-xxxs);
      }

      .chat-input-area :deep(.pill-menu-button:hover) {
        border-color: var(--boxel-dark);
      }

      .llm-select :deep(.menu-content) {
        margin-right: calc(-2 * var(--boxel-sp-sm));
        width: 100%;
      }

      .chat-input-area :deep(.minimized-arrow) {
        margin-left: 0;
      }
    </style>
  </template>

  @consume(GetCardContextName) private declare getCard: getCard;
  @tracked private selectedBottomAction:
    | 'skill-menu'
    | 'llm-select'
    | undefined;
  @tracked lastCanceledActionMessageId: string | undefined;
  @tracked acceptingAllLabel: string | undefined;

  @service private declare store: StoreService;
  @service private declare cardService: CardService;
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare playgroundPanelService: PlaygroundPanelService;
  @service private declare specPanelService: SpecPanelService;
  @service private declare aiAssistantPanelService: AiAssistantPanelService;

  private autoAttachmentResource = getAutoAttachment(this, {
    submode: () => this.operatorModeStateService.state.submode,
    moduleInspectorPanel: () =>
      this.operatorModeStateService.moduleInspectorPanel,
    autoAttachedFileUrl: () => this.autoAttachedFileUrl,
    playgroundPanelCardId: () => this.playgroundPanelCardId,
    activeSpecId: () => this.specPanelService.specSelection,
    topMostStackItems: () => this.topMostStackItems,
    attachedCardIds: () => this.cardIdsToAttach,
    removedCardIds: () => this.removedAttachedCardIds,
  });
  private removedAttachedCardIds = new TrackedArray<string>();
  private getConversationScrollability: (() => boolean) | undefined;
  private scrollConversationToBottom: (() => void) | undefined;
  private roomScrollState: WeakMap<
    RoomData,
    {
      messageElements: WeakMap<HTMLElement, number>;
      messageScrollers: Map<number, Element['scrollIntoView']>;
      messageVisibilityObserver: IntersectionObserver;
      isScrolledToBottom: boolean;
      userHasScrolled: boolean;
      isConversationScrollable: boolean;
    }
  > = new WeakMap();

  @tracked private unknownMessageSendError: string | undefined = undefined;
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
    registerDestructor(this, () => {
      this.scrollState().messageVisibilityObserver.disconnect();
    });
  }

  private scrollState() {
    if (!this.room) {
      throw new Error(`Cannot get room scroll state before room is loaded`);
    }
    let state = this.roomScrollState.get(this.room);
    if (!state) {
      state = new TrackedObject({
        isScrolledToBottom: false,
        userHasScrolled: false,
        isConversationScrollable: false,
        messageElements: new WeakMap(),
        messageScrollers: new Map(),
        messageVisibilityObserver: new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            let index = this.messageElements.get(entry.target as HTMLElement);
            if (index != null) {
              if (
                (!this.isConversationScrollable || entry.isIntersecting) &&
                index > this.lastReadMessageIndex
              ) {
                this.sendReadReceipt(this.messages[index]);
              }
            }
          });
        }),
      });
      this.roomScrollState.set(this.room, state);
    }
    return state;
  }

  // Using a resource for automatically attached files,
  // so the file can be reattached after being removed
  // when the user opens a different file and then returns to this one.
  @use private autoAttachedFileResource = resource(() => {
    let state = new TrackedObject<{
      value: FileDef | undefined;
      remove: () => void;
    }>({
      value: undefined,
      remove: () => {
        state.value = undefined;
      },
    });

    if (!this.autoAttachedFileUrl) {
      state.value = undefined;
    } else {
      state.value = this.matrixService.fileAPI.createFileDef({
        sourceUrl: this.autoAttachedFileUrl,
        name: this.autoAttachedFileUrl.split('/').pop(),
      });
    }

    return state;
  });

  private get autoAttachedFileUrl() {
    return this.operatorModeStateService.state.codePath?.href;
  }

  private get autoAttachedFile() {
    return this.operatorModeStateService.state.submode === Submodes.Code
      ? this.autoAttachedFileResource.value
      : undefined;
  }

  private get removeAutoAttachedFile() {
    return this.autoAttachedFileResource.remove;
  }

  private get filesToAttach() {
    return this.matrixService.filesToSend.get(this.args.roomId) ?? [];
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
      let moduleId = internalKeyFor(this.args.selectedCardRef, undefined);
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
    return this.scrollState().isScrolledToBottom;
  }

  private get userHasScrolled() {
    return this.scrollState().userHasScrolled;
  }

  private get isConversationScrollable() {
    return this.scrollState().isConversationScrollable;
  }

  private get messageElements() {
    return this.scrollState().messageElements;
  }

  private get messageScrollers() {
    return this.scrollState().messageScrollers;
  }

  private get messageVisibilityObserver() {
    return this.scrollState().messageVisibilityObserver;
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
    this.messageElements.set(element, index);
    this.messageScrollers.set(index, scrollTo);
    this.messageVisibilityObserver.observe(element);
    this.scrollState().isConversationScrollable = Boolean(
      this.getConversationScrollability?.(),
    );
    if (!this.isConversationScrollable || !this.isAllowedToAutoScroll) {
      return;
    }

    // TODO udpate this so that we preserve the scroll position as the user
    // changes rooms and we restore the scroll position when a user enters a room
    if (
      // If we are permitted to auto-scroll and if there are no unread messages in the
      // room, then scroll to the last message in the room.
      !this.hasUnreadMessages &&
      index === this.messages.length - 1 &&
      !this.isScrolledToBottom
    ) {
      scrollTo();
    } else if (
      // otherwise if we are permitted to auto-scroll and if there are unread
      // messages in the room, then scroll to the first unread message in the room.
      this.hasUnreadMessages &&
      index === this.lastReadMessageIndex + 1
    ) {
      scrollTo();
    } else if (this.isScrolledToBottom) {
      this.scrollConversationToBottom?.();
    }
  };

  private registerConversationScroller = (
    isConversationScrollable: () => boolean,
    scrollToBottom: () => void,
  ) => {
    this.getConversationScrollability = isConversationScrollable;
    this.scrollConversationToBottom = scrollToBottom;
  };

  private setScrollPosition = ({ isBottom }: { isBottom: boolean }) => {
    this.scrollState().isScrolledToBottom = isBottom;
    if (!isBottom) {
      this.scrollState().userHasScrolled = true;
    }
  };

  private scrollToFirstUnread = () => {
    if (!this.hasUnreadMessages) {
      return;
    }

    let firstUnreadIndex = this.lastReadMessageIndex + 1;
    let scrollTo = this.messageScrollers.get(firstUnreadIndex);
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
      this.hasUnreadMessages &&
      !this.isScrolledToBottom
    );
  }

  private get isAcceptingAll() {
    return (
      this.executeAllReadyActionsTask.isRunning ||
      this.commandService.isPerformingAcceptAllForRoom(this.args.roomId)
    );
  }

  private get unreadMessageText() {
    return `${this.numberOfUnreadMessages} New ${pluralize(
      'Message',
      this.numberOfUnreadMessages,
    )}`;
  }

  private sendReadReceipt(message: Message) {
    if (this.matrixService.profile.userId === message.author.userId) {
      return;
    }
    if (this.matrixService.currentUserEventReadReceipts.has(message.eventId)) {
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

    // Without scheduling this after render, this produces the "attempted to
    // update value, but it had already been used previously in the same
    // computation" error
    schedule('afterRender', () => {
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

  private get skills(): RoomSkill[] {
    return this.args.roomResource.skills;
  }

  private get llmsForSelectMenu() {
    // Read from the LLM environment card if available
    let systemCard = this.matrixService.systemCard;
    if (systemCard?.modelConfigurations) {
      let options: Record<string, string> = {};
      for (let modelConfig of systemCard.modelConfigurations) {
        if (modelConfig.modelId) {
          options[modelConfig.modelId] =
            modelConfig.title || modelConfig.modelId;
        }
      }
      // Add any used LLMs that aren't already in the options
      for (let usedLLM of this.args.roomResource.usedLLMs) {
        if (usedLLM && !options[usedLLM]) {
          options[usedLLM] = usedLLM; // Use model ID as display name
        }
      }
      return options;
    }

    // Fallback to hardcoded list for backwards compatibility
    let ids = [
      ...new Set([...DEFAULT_LLM_LIST, ...this.args.roomResource.usedLLMs]),
    ]
      .filter(Boolean)
      .sort();

    return ids.reduce((acc: Record<string, string>, id) => {
      acc[id] = DEFAULT_LLM_ID_TO_NAME[id] ?? id;
      return acc;
    }, {});
  }

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
    let room = this.args.roomResource.matrixRoom;
    return room;
  }

  private doWhenRoomChanges = restartableTask(async () => {
    await all([this.cardService.cardsSettled(), timeout(500)]);
  });

  private get messageToSend() {
    return this.matrixService.getMessageToSend(this.args.roomId) ?? '';
  }

  private get cardIdsToAttach() {
    return this.matrixService.cardsToSend.get(this.args.roomId);
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
    if (this.autoAttachedFile) {
      files.push(this.autoAttachedFile);
    }
    files.push(...this.filesToAttach);

    this.doSendMessage.perform(
      prompt ?? this.messageToSend,
      cards.length ? cards : undefined,
      files.length ? files : undefined,
    );
  }

  @action
  private chooseCard(cardId: string) {
    // handle the case where auto-attached card pill is clicked
    if (this.autoAttachedCardIds.has(cardId)) {
      this.removedAttachedCardIds.push(cardId);
    }

    let cardIds = this.cardIdsToAttach ?? [];
    if (!cardIds.includes(cardId)) {
      this.matrixService.cardsToSend.set(this.args.roomId, [
        ...cardIds,
        cardId,
      ]);
    }
  }

  @action
  private removeCard(id: string) {
    if (this.playgroundPanelCardId === id) {
      this.removePlaygroundPanelCard();
    } else if (this.autoAttachedCardIds.has(id)) {
      this.removedAttachedCardIds.push(id);
    } else {
      const cardIndex = this.cardIdsToAttach?.findIndex((url) => url === id);
      if (cardIndex != undefined && cardIndex !== -1) {
        if (this.cardIdsToAttach !== undefined) {
          this.cardIdsToAttach.splice(cardIndex, 1);
        }
      }
    }
    this.matrixService.cardsToSend.set(
      this.args.roomId,
      this.cardIdsToAttach?.length ? this.cardIdsToAttach : undefined,
    );
  }

  @action
  private chooseFile(file: FileDef) {
    // handle the case where auto-attached file pill is clicked
    if (this.isAutoAttachedFile(file)) {
      this.removeAutoAttachedFile();
    }

    let files = this.filesToAttach;
    if (!files?.find((f) => f.sourceUrl === file.sourceUrl)) {
      this.matrixService.filesToSend.set(this.args.roomId, [...files, file]);
    }
  }

  @action
  private isAutoAttachedFile(file: FileDef) {
    return this.autoAttachedFile?.sourceUrl === file.sourceUrl;
  }

  @action
  private removeFile(file: FileDef) {
    if (this.isAutoAttachedFile(file)) {
      this.removeAutoAttachedFile();
      return;
    }

    const fileIndex = this.filesToAttach?.findIndex(
      (f) => f.sourceUrl === file.sourceUrl,
    );
    if (fileIndex != undefined && fileIndex !== -1) {
      if (this.filesToAttach !== undefined) {
        this.filesToAttach.splice(fileIndex, 1);
      }
    }

    this.matrixService.cardsToSend.set(
      this.args.roomId,
      this.cardIdsToAttach?.length ? this.cardIdsToAttach : undefined,
    );
  }

  private doSendMessage = enqueueTask(
    async (
      message: string | undefined,
      cardsOrIds?: CardDef[] | string[],
      files?: FileDef[],
      clientGeneratedId: string = uuidv4(),
      keepInputAndAttachments = false,
    ) => {
      this.unknownMessageSendError = undefined;
      let messageToSend = this.matrixService.getMessageToSend(this.args.roomId);
      let cardsToSend =
        this.matrixService.cardsToSend.get(this.args.roomId) ?? undefined;
      let cardsToSendCopy = cardsToSend ? [...cardsToSend] : undefined;
      const shouldClearDraft = !keepInputAndAttachments;

      // We copy the draft and attachments into local variables before clearing them
      // (unless we're intentionally preserving the user's current draft for a retry).
      // Clearing immediately empties the input so the user sees that their message is “in flight”.
      // If the send fails, we restore those saved values in the catch block so nothing is lost.
      if (shouldClearDraft) {
        this.matrixService.setMessageToSend(this.args.roomId, undefined);
        this.matrixService.cardsToSend.set(this.args.roomId, undefined);
      }

      let openCardIds = new Set([
        ...(this.operatorModeStateService.getOpenCardIds() || []),
        ...this.autoAttachedCardIds,
      ]);
      let context =
        await this.operatorModeStateService.getSummaryForAIBot(openCardIds);
      try {
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
          this.args.roomId,
          message,
          cards,
          files,
          clientGeneratedId,
          context,
        );
      } catch (e) {
        console.error(e);
        this.unknownMessageSendError =
          'There was an error sending your message. This could be due to network issues, or serialization issues with the cards or files you are trying to send. It might be helpful to refresh the page and try again.';

        if (shouldClearDraft) {
          this.matrixService.setMessageToSend(this.args.roomId, messageToSend);
          if (cardsToSendCopy && cardsToSendCopy.length > 0) {
            this.matrixService.cardsToSend.set(
              this.args.roomId,
              cardsToSendCopy,
            );
          }
        }
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
    this.removedAttachedCardIds.splice(0);
  });

  private get autoAttachedCardIds() {
    return this.autoAttachmentResource.cardIds;
  }

  private updateSkillIsActiveTask = task(
    async (isActive: boolean, skillCardId?: string) => {
      await new UpdateRoomSkillsCommand(
        this.commandService.commandContext,
      ).execute({
        roomId: this.args.roomId,
        skillCardIdsToActivate: isActive ? [skillCardId!] : [],
        skillCardIdsToDeactivate: isActive ? [] : [skillCardId!],
      });
    },
  );

  private get canSend() {
    return (
      !this.doSendMessage.isRunning &&
      Boolean(
        this.messageToSend?.trim() ||
          this.cardIdsToAttach?.length ||
          this.autoAttachedCardIds.size !== 0,
      ) &&
      !!this.room &&
      !this.messages.some((m) => this.isPendingMessage(m)) &&
      !this.matrixService.isLoadingTimeline &&
      !this.aiAssistantPanelService.isPreparingSession
    );
  }

  @action
  private isLastMessage(messageIndex: number) {
    return (this.room && messageIndex === this.messages.length - 1) ?? false;
  }

  private isPendingMessage(message: Message) {
    return message.status === 'sending' || message.status === 'queued';
  }

  private attachSkillTask = task(async (cardId: string) => {
    let updateRoomSkillsCommand = new UpdateRoomSkillsCommand(
      this.commandService.commandContext,
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

  private get displayLLMModeSelect() {
    return this.displaySkillMenu && this.displayLLMSelect;
  }

  private get displayAttachedItems() {
    return (
      this.filesToAttach?.length ||
      this.cardIdsToAttach?.length ||
      this.autoAttachedFile ||
      this.autoAttachedCardIds?.size
    );
  }

  @cached
  private get readyCommands() {
    let lastMessage = this.messages[this.messages.length - 1];

    if (!lastMessage || !lastMessage.commands) {
      return [];
    }
    return lastMessage.commands.filter(
      (command) =>
        (command.status === 'ready' || command.status === undefined) &&
        !this.commandService.currentlyExecutingCommandRequestIds.has(
          command.id!,
        ) &&
        !this.commandService.executedCommandRequestIds.has(command.id!),
    );
  }

  @cached
  private get readyCodePatches() {
    let lastMessage = this.messages[this.messages.length - 1];
    if (!lastMessage || !lastMessage.htmlParts) return [];
    return this.commandService.getReadyCodePatches(lastMessage.htmlParts);
  }

  private get generatingResults() {
    return (
      this.messages[this.messages.length - 1] &&
      !this.messages[this.messages.length - 1].isStreamingFinished
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
    return (
      this.showUnreadIndicator ||
      this.generatingResults ||
      this.readyCommands.length > 0 ||
      this.readyCodePatches.length > 0 ||
      this.isAcceptingAll
    );
  }

  private async executeReadyCommands() {
    for (let command of this.readyCommands) {
      this.acceptingAllLabel = command.actionVerb;
      await this.commandService.run.unlinked().perform(command);
      this.acceptingAllLabel = undefined;
    }
  }

  private async executeReadyCodePatches() {
    let lastMessage = this.messages[this.messages.length - 1];
    if (!lastMessage || !lastMessage.htmlParts) return;

    await this.commandService.executeReadyCodePatches(
      this.args.roomId,
      lastMessage.htmlParts,
    );
  }

  private executeAllReadyActionsTask = task(async () => {
    await this.executeReadyCodePatches();
    await this.executeReadyCommands();
  });

  @action
  private cancelActionBar() {
    let lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage) {
      this.lastCanceledActionMessageId = lastMessage.eventId;
    }
  }

  private stopGeneratingTask = task(async () => {
    await this.matrixService.sendStopGeneratingEvent(this.args.roomId);
  });
}
