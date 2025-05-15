import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached } from '@glimmer/tracking';

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

import { TrackedObject, TrackedSet, TrackedArray } from 'tracked-built-ins';

import { v4 as uuidv4 } from 'uuid';

import { BoxelButton, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { and, eq, not } from '@cardstack/boxel-ui/helpers';

import {
  type getCard,
  GetCardContextName,
  ResolvedCodeRef,
  internalKeyFor,
  isCardInstance,
  isLocalId,
} from '@cardstack/runtime-common';
import { DEFAULT_LLM_LIST } from '@cardstack/runtime-common/matrix-constants';

import AddSkillsToRoomCommand from '@cardstack/host/commands/add-skills-to-room';
import UpdateSkillActivationCommand from '@cardstack/host/commands/update-skill-activation';
import { Message } from '@cardstack/host/lib/matrix-classes/message';
import type { StackItem } from '@cardstack/host/lib/stack-item';
import { getAutoAttachment } from '@cardstack/host/resources/auto-attached-card';
import { RoomResource } from '@cardstack/host/resources/room';

import type CardService from '@cardstack/host/services/card-service';
import type CommandService from '@cardstack/host/services/command-service';
import type LoaderService from '@cardstack/host/services/loader-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { type MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type PlaygroundPanelService from '@cardstack/host/services/playground-panel-service';
import type StoreService from '@cardstack/host/services/store';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import { type FileDef } from 'https://cardstack.com/base/file-api';
import type { Skill } from 'https://cardstack.com/base/skill';

import AiAssistantAttachmentPicker from '../ai-assistant/attachment-picker';
import AiAssistantChatInput from '../ai-assistant/chat-input';
import LLMSelect from '../ai-assistant/llm-select';
import { AiAssistantConversation } from '../ai-assistant/message';
import NewSession from '../ai-assistant/new-session';
import AiAssistantSkillMenu from '../ai-assistant/skill-menu';

import { Submodes } from '../submode-switcher';

import RoomMessage from './room-message';

import type RoomData from '../../lib/matrix-classes/room';
import type { RoomSkill } from '../../resources/room';

interface Signature {
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
        data-room-settled={{(and
          this.doWhenRoomChanges.isIdle
          (not this.matrixService.isLoadingTimeline)
        )}}
        data-test-room-settled={{(and
          this.doWhenRoomChanges.isIdle
          (not this.matrixService.isLoadingTimeline)
        )}}
        data-test-room-name={{@roomResource.name}}
        data-test-room={{@roomId}}
        data-room-id={{@roomId}}
      >
        <AiAssistantConversation
          @registerConversationScroller={{this.registerConversationScroller}}
          @setScrollPosition={{this.setScrollPosition}}
        >
          {{#if this.matrixService.isLoadingTimeline}}
            <LoadingIndicator
              @color='var(--boxel-light)'
              class='loading-indicator'
            />
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
          {{/if}}
          {{#if this.room}}
            {{#if this.showUnreadIndicator}}
              <div class='unread-indicator'>
                <BoxelButton
                  @size='tall'
                  @kind='primary'
                  class='unread-button'
                  data-test-unread-messages-button
                  {{on 'click' this.scrollToFirstUnread}}
                >{{this.unreadMessageText}}</BoxelButton>
              </div>
            {{else}}
              <AiAssistantSkillMenu
                class='skills'
                @skills={{this.sortedSkills}}
                @onChooseCard={{perform this.attachSkillTask}}
                @onUpdateSkillIsActive={{perform this.updateSkillIsActiveTask}}
                data-test-skill-menu
              />
            {{/if}}
          {{/if}}
        </AiAssistantConversation>

        <footer class='room-actions'>
          <div class='chat-input-area' data-test-chat-input-area>
            <AiAssistantChatInput
              @value={{this.messageToSend}}
              @onInput={{this.setMessage}}
              @onSend={{this.sendMessage}}
              @canSend={{this.canSend}}
              data-test-message-field={{@roomId}}
            />
            <div class='chat-input-area__bottom-section'>
              <AiAssistantAttachmentPicker
                @autoAttachedCardIds={{this.autoAttachedCardIds}}
                @cardIdsToAttach={{this.cardIdsToAttach}}
                @chooseCard={{this.chooseCard}}
                @removeCard={{this.removeCard}}
                @chooseFile={{this.chooseFile}}
                @removeFile={{this.removeFile}}
                @submode={{this.operatorModeStateService.state.submode}}
                @autoAttachedFile={{this.autoAttachedFile}}
                @filesToAttach={{this.filesToAttach}}
                @autoAttachedCardTooltipMessage={{if
                  (eq this.operatorModeStateService.state.submode Submodes.Code)
                  'Current card is shared automatically'
                  'Topmost card is shared automatically'
                }}
              />
              <LLMSelect
                @selected={{@roomResource.activeLLM}}
                @onChange={{perform @roomResource.activateLLMTask}}
                @options={{this.supportedLLMs}}
                @disabled={{@roomResource.isActivatingLLM}}
              />
            </div>
          </div>
        </footer>
      </section>
    {{/if}}

    <style scoped>
      .room {
        display: grid;
        grid-template-rows: 1fr auto;
        height: 100%;
        overflow: hidden;
      }
      .skills {
        position: sticky;
        bottom: 0;
        margin-left: auto;
      }
      .unread-indicator {
        position: sticky;
        bottom: 0;
        margin-left: auto;
        width: 100%;
      }
      .unread-button {
        width: 100%;
      }
      .room-actions {
        padding: var(--boxel-sp-xxs) var(--boxel-sp) var(--boxel-sp);
        box-shadow: var(--boxel-box-shadow);
      }
      .chat-input-area {
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .chat-input-area__bottom-section {
        display: flex;
        justify-content: space-between;
        padding-right: var(--boxel-sp-xxs);
        gap: var(--boxel-sp-xxl);
      }
      .chat-input-area__bottom-section
        :deep(.ember-basic-dropdown-content-wormhole-origin) {
        position: absolute; /* This prevents layout shift when menu opens */
      }
      :deep(.ai-assistant-conversation > *:first-child) {
        margin-top: auto;
      }
      :deep(.ai-assistant-conversation > *:nth-last-of-type(2)) {
        padding-bottom: var(--boxel-sp-xl);
      }
      .loading-indicator {
        margin-top: auto;
        margin-bottom: auto;
        margin-left: auto;
        margin-right: auto;
      }
    </style>
  </template>

  @consume(GetCardContextName) private declare getCard: getCard;

  @service private declare store: StoreService;
  @service private declare cardService: CardService;
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare loaderService: LoaderService;
  @service private declare playgroundPanelService: PlaygroundPanelService;

  private autoAttachmentResource = getAutoAttachment(this, {
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

  // For efficiency, read receipts are implemented using “up to” markers. This
  // marker indicates that the acknowledgement applies to all events “up to and
  // including” the event specified. For example, marking an event as “read” would
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

  private get unreadMessageText() {
    return `${this.numberOfUnreadMessages} unread ${pluralize(
      'message',
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

  private get supportedLLMs(): string[] {
    return DEFAULT_LLM_LIST.sort();
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
    return this.matrixService.messagesToSend.get(this.args.roomId) ?? '';
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
      true,
      myLastMessage.clientGeneratedId,
    );
  }

  @action
  private setMessage(message: string) {
    this.matrixService.messagesToSend.set(this.args.roomId, message);
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
      Boolean(prompt),
    );
  }

  @action
  private chooseCard(cardId: string) {
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
    } else if (this.autoAttachmentResource.cardIds.has(id)) {
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
      keepInputAndAttachments: boolean = false,
      clientGeneratedId: string = uuidv4(),
    ) => {
      if (!keepInputAndAttachments) {
        // this is for situations when a message is sent via some other way than the text box
        // (example: ai prompt from new-session screen)
        // if there were cards attached or a typed — but not sent — message, do not erase or remove them
        this.matrixService.messagesToSend.set(this.args.roomId, undefined);
        this.matrixService.cardsToSend.set(this.args.roomId, undefined);
      }
      let openCardIds = new Set([
        ...(this.operatorModeStateService.getOpenCardIds(
          this.args.selectedCardRef,
        ) || []),
        ...this.autoAttachedCardIds,
      ]);
      let context = {
        submode: this.operatorModeStateService.state.submode,
        openCardIds: this.makeRemoteIdsList([...openCardIds]),
      };
      try {
        if (files?.length) {
          files = await this.matrixService.uploadFiles(files);
        }
        let cards: CardDef[] | undefined;
        if (typeof cardsOrIds?.[0] === 'string') {
          // we use detached instances since these are just
          // serialized and send to matrix--these don't appear
          // elsewhere in our app.
          cards = (
            await Promise.all(
              (cardsOrIds as string[]).map((id) => this.store.get(id)),
            )
          )
            .filter(Boolean)
            .filter(isCardInstance) as CardDef[];
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
        console.error('Error sending message', e);
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

  private makeRemoteIdsList(ids: (string | undefined)[]) {
    return ids
      .map((id) => {
        if (!id) {
          return undefined;
        }
        if (isLocalId(id)) {
          let maybeInstance = this.store.peek(id);
          if (
            maybeInstance &&
            isCardInstance(maybeInstance) &&
            maybeInstance.id
          ) {
            return maybeInstance.id;
          } else {
            return undefined;
          }
        }
        return id;
      })
      .filter(Boolean) as string[];
  }

  private get autoAttachedCardIds() {
    if (this.operatorModeStateService.state.submode === Submodes.Code) {
      // also get the card ids of the cards that are open in code mode
      let cardIds = new TrackedSet<string>();
      if (this.autoAttachedFileUrl?.endsWith('.json')) {
        // remove the json extension. TODO: is there a way of getting the actual card id
        let cardId = this.autoAttachedFileUrl.replace(/\.json$/, '');
        cardIds.add(cardId);
      }
      if (this.playgroundPanelCardId) {
        cardIds.add(this.playgroundPanelCardId);
      }
      return cardIds;
    }

    return this.autoAttachmentResource.cardIds;
  }

  private updateSkillIsActiveTask = task(
    async (isActive: boolean, skillCardId?: string) => {
      await new UpdateSkillActivationCommand(
        this.commandService.commandContext,
      ).execute({
        roomId: this.args.roomId,
        skillCardId,
        isActive,
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
      !this.matrixService.isLoadingTimeline
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
    let addSkillsToRoomCommand = new AddSkillsToRoomCommand(
      this.commandService.commandContext,
    );

    let skillCard = await this.store.get<Skill>(cardId);
    if (skillCard && isCardInstance(skillCard)) {
      await addSkillsToRoomCommand.execute({
        roomId: this.args.roomId,
        skills: [skillCard],
      });
    }
  });
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Room {
    'Matrix::Room': typeof Room;
  }
}
