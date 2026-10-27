import { isDestroying, registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';

import type { SafeString } from '@ember/template';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { registerSettle } from '@cardstack/choreo';
import { SpeakerLabel } from '@cardstack/pretui/components/speaker-label';
import { StickToBottom } from '@cardstack/pretui/components/stick-to-bottom';
import { formatToolDuration } from '@cardstack/pretui/components/tool-row';
import { TurnChanges } from '@cardstack/pretui/components/turn-changes';
import { format as formatDate } from 'date-fns';
import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import Modifier, { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';

import { Alert } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

import {
  MINIMUM_AI_CREDITS_TO_CONTINUE,
  type CardErrorJSONAPI,
  type getCardCollection,
  rri,
} from '@cardstack/runtime-common';

import {
  formatCredits,
  formatTokenUsage,
} from '@cardstack/host/lib/format-token-usage';
import type { HtmlTagGroup } from '@cardstack/host/lib/formatted-message/utils';
import type { MessageCompaction } from '@cardstack/host/lib/matrix-classes/message';
import type MessageTool from '@cardstack/host/lib/matrix-classes/message-tool';
import type {
  AnswerFooterData,
  ReasoningMode,
  TurnHead,
  ChangedFile,
} from '@cardstack/host/lib/turn-summary';
import type BillingService from '@cardstack/host/services/billing-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { MessageMotion, TranscriptMotion } from '../motion/transcript-motion';

import AiBotMessage from './aibot-message';
import AnswerFooter from './answer-footer';
import Attachments from './attachments';
import CompactionStatus from './compaction-status';
import Meta from './meta';
import UserMessage from './user-message';

import type { FileDef } from '@cardstack/base/file-api';
import type { TokenUsage } from '@cardstack/base/matrix-event';
import type { StickToBottomApi } from '@cardstack/pretui/components/stick-to-bottom';

import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    reasoningContent?: string | null;
    messageHTML?: string;
    messageHTMLParts?: HtmlTagGroup[];
    /** the bot's markdown as written; when present, it streams through
     * MarkdownStream rather than the pre-split htmlParts */
    messageBody?: string;
    isCanceled?: boolean;
    datetime: Date;
    isFromAssistant: boolean;
    isStreaming: boolean;
    // the message is in the room's latest turn, where its rows can still
    // change; older messages keep their motion region idle
    inLatestTurn?: boolean;
    isMostRecentMessage?: boolean;
    profileAvatar?: ComponentLike;
    collectionResource?: ReturnType<getCardCollection>;
    files?: FileDef[] | undefined;
    attachedCardsAsFiles?: FileDef[] | undefined;
    index: number;
    roomId: string;
    eventId: string;
    monacoSDK: MonacoSDK;
    registerScroller: (args: {
      index: number;
      element: HTMLElement;
      scrollTo: Element['scrollIntoView'];
    }) => void;
    unregisterScroller?: (args: {
      index: number;
      element: HTMLElement;
    }) => void;
    errorMessage?: string;
    reloadBillingData?: boolean;
    isDebugMessage?: boolean;
    isPending?: boolean;
    retryAction?: () => void;
    waitAction?: () => void;
    hideMeta?: boolean;
    // a person's message: who posted it, and whether it is the reader
    authorName?: string;
    isSelf?: boolean;
    // the same person's message right after their last one
    continuesRun?: boolean;
    // the bubble carries the same cards and files as the user's last one:
    // the context did not change, so the chips step aside
    repeatsContext?: boolean;
    isCodePatchCorrectness?: boolean;
    commands?: MessageTool[];
    usage?: TokenUsage;
    compaction?: MessageCompaction;
    // a message the host posted for the reader (a background run's result):
    // shown as this line in place of a bubble
    deliveryNote?: string;
    // this message is its turn's final reply: the quiet actions under it
    answerFooter?: AnswerFooterData;
    // the turn is folded: its reasoning folds with its tool rows
    reasoningFolded?: boolean;
    /** where this reply's reasoning shows within its turn (room.gts) */
    reasoningMode?: ReasoningMode;
    // the head of the assistant turn this message opens, when it isn't
    // folded: Pret UI's AgentTurn header
    turnHead?: TurnHead;
  };
  Blocks: { default: [] };
}

interface MessageScrollerSignature {
  Args: {
    Named: {
      index: number;
      registerScroller: (args: {
        index: number;
        element: HTMLElement;
        scrollTo: Element['scrollIntoView'];
      }) => void;
      unregisterScroller?: (args: {
        index: number;
        element: HTMLElement;
      }) => void;
    };
  };
}

class MessageScroller extends Modifier<MessageScrollerSignature> {
  private hasRegistered = false;
  private observer?: MutationObserver;
  private element?: HTMLElement;
  private index?: number;
  private unregisterScroller?:
    | MessageScrollerSignature['Args']['Named']['unregisterScroller']
    | undefined;
  private hasDestructor = false;
  modify(
    element: HTMLElement,
    _positional: [],
    {
      index,
      registerScroller,
      unregisterScroller,
    }: MessageScrollerSignature['Args']['Named'],
  ) {
    if (!this.hasDestructor) {
      this.hasDestructor = true;
      registerDestructor(this, () => this.unregister());
    }

    if (
      this.element !== element ||
      this.index !== index ||
      this.unregisterScroller !== unregisterScroller
    ) {
      this.unregister();
      this.element = element;
      this.index = index;
      this.unregisterScroller = unregisterScroller;
      this.hasRegistered = false;
    }

    if (!this.hasRegistered) {
      this.hasRegistered = true;
      registerScroller({
        index,
        element,
        scrollTo: element.scrollIntoView.bind(element),
      });
    }

    this.observer?.disconnect();
    this.observer = new MutationObserver(() => {
      registerScroller({
        index,
        element,
        scrollTo: element.scrollIntoView.bind(element),
      });
    });
    this.observer.observe(element, { childList: true, subtree: true });
  }

  private unregister() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.hasRegistered = false;
    if (this.element && this.index != null && this.unregisterScroller) {
      this.unregisterScroller({
        index: this.index,
        element: this.element,
      });
    }
    this.element = undefined;
    this.index = undefined;
    this.unregisterScroller = undefined;
  }
}

// an amount of pixels from the bottom of the element that we would consider to
// be scrolled "all the way down"
export const BOTTOM_THRESHOLD = 50;

// how long a press keeps a settled message's motion region awake: long
// enough for what it opened or closed to finish moving
const ENGAGED_MS = 2500;
const HTTP_PROTOCOL = new RegExp('^https?:$');

interface ReloadBillingOnInsertSignature {
  Args: {
    Named: {
      shouldReloadBillingData: boolean;
      reload: () => void;
    };
  };
}

// In the future if we implement subscription to credit consumption, we can remove this modifier
// It's currently used to reload the billing data when an out of credits error message is shown so that we can
// conditionally display the "buy more credits" button, or "credits added" message + retry button
class ReloadBillingOnInsert extends Modifier<ReloadBillingOnInsertSignature> {
  private hasReloaded = false;

  private runReload(reload: () => void) {
    reload();
  }

  modify(
    _element: HTMLElement,
    _positional: [],
    {
      shouldReloadBillingData,
      reload,
    }: ReloadBillingOnInsertSignature['Args']['Named'],
  ) {
    if (shouldReloadBillingData && !this.hasReloaded) {
      this.hasReloaded = true;
      scheduleOnce('afterRender', this, this.runReload, reload);
    }
  }
}

function isThinkingMessage(s: string | null | undefined) {
  if (!s) {
    return false;
  }
  return s.trim() === 'Thinking...';
}

function isPresent(val: SafeString | string | null | undefined) {
  if (val?.toString) {
    val = val?.toString().trim();
  }
  return val ? val !== '' : false;
}

export function attachedCardErrorMessages(errors: CardErrorJSONAPI[]) {
  let unreachableCount = 0;
  let runtimeErrorCount = 0;
  let genericErrorCount = 0;

  for (let error of errors) {
    if (isUnreachableCardError(error)) {
      unreachableCount++;
    } else if (error.status >= 500) {
      runtimeErrorCount++;
    } else {
      genericErrorCount++;
    }
  }

  return [
    ...(unreachableCount > 0
      ? [
          unreachableCount === 1
            ? `The card is unreachable. It may have been deleted, or you don't have permission to see it.`
            : `These cards are unreachable. They may have been deleted, or you don't have permission to see them.`,
        ]
      : []),
    ...(runtimeErrorCount > 0
      ? [
          runtimeErrorCount === 1
            ? `This card could not be displayed because it hit a runtime error.`
            : `Some cards could not be displayed because they hit runtime errors.`,
        ]
      : []),
    ...(genericErrorCount > 0
      ? [
          genericErrorCount === 1
            ? `This card could not be displayed because it has an error.`
            : `Some cards could not be displayed because they have errors.`,
        ]
      : []),
  ];
}

function isUnreachableCardError(error: CardErrorJSONAPI) {
  return [403, 404].includes(error.status);
}

export default class AiAssistantMessage extends Component<Signature> {
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private billingService: BillingService;

  // The files this turn changed, for TurnChanges.
  private get changedFiles(): ChangedFile[] {
    return this.args.answerFooter?.diff?.perFile ?? [];
  }

  // A changed file opens in the code editor.
  private openChangedFile = (file: { path: string }) => {
    let changed = this.changedFiles.find(
      (candidate) => candidate.path === file.path,
    );
    if (changed) {
      this.operatorModeStateService.updateCodePath(rri(changed.url));
    }
  };

  // The reasoning trace is shown, but closed by default: a transcript reads
  // as conclusions, and the reader opens the trace when they want it. Their
  // choice is remembered per message across re-renders.
  private get isReasoningExpanded() {
    return (
      this.matrixService.reasoningExpandedState.get(this.args.eventId) ?? false
    );
  }
  private setReasoningExpanded = (expanded: boolean) => {
    this.matrixService.reasoningExpandedState.set(this.args.eventId, expanded);
  };
  // Still reasoning: the model is streaming and has not started its answer.
  private get isReasoning() {
    return this.args.isStreaming && !isPresent(this.args.messageHTML);
  }

  @action
  private async downloadFile(file: FileDef) {
    try {
      await this.matrixService.downloadAsFileInBrowser(file);
    } catch (error) {
      console.error('Error downloading file:', error);
    }
  }

  private reloadBillingDataTask = task(async () => {
    if (!this.billingService.loadingSubscriptionData) {
      await this.billingService.loadSubscriptionData();
    }
  });

  // a person's bubble names its author and time itself; the avatar row
  // stays for the assistant and for host-posted notes
  private get showsMeta() {
    if (this.args.hideMeta) {
      return false;
    }
    return this.args.isFromAssistant || Boolean(this.args.deliveryNote);
  }

  private get showsTurnHead() {
    return Boolean(this.args.isFromAssistant && this.args.turnHead);
  }

  private get turnHeadWorking() {
    return Boolean(this.args.turnHead?.working || this.isAvatarAnimated);
  }

  // A settled message's motion region sits render passes out: with one
  // region per message, a long transcript otherwise measured every message
  // on every pass. It wakes for the latest turn, and for a moment after the
  // reader presses inside it (a fold, a row opening), so what that press
  // changes still moves.
  @tracked private engaged = false;
  private engagedTimer: ReturnType<typeof setTimeout> | undefined;

  private engage = (event: Event) => {
    if (
      event instanceof KeyboardEvent &&
      event.key !== 'Enter' &&
      event.key !== ' '
    ) {
      return;
    }
    if (!this.engaged) {
      this.engaged = true;
    }
    clearTimeout(this.engagedTimer);
    this.engagedTimer = setTimeout(() => {
      if (!isDestroying(this)) {
        this.engaged = false;
      }
    }, ENGAGED_MS);
  };

  // on the press itself, before the click renders what it changes, so the
  // region is watching for that pass; capture, so a row that stops the
  // event still wakes its message
  private wakeOnPress = modifier((element: HTMLElement) => {
    element.addEventListener('pointerdown', this.engage, true);
    element.addEventListener('keydown', this.engage, true);
    return () => {
      element.removeEventListener('pointerdown', this.engage, true);
      element.removeEventListener('keydown', this.engage, true);
    };
  });

  private get motionIdle() {
    return !(this.args.inLatestTurn || this.args.isStreaming || this.engaged);
  }

  // While the turn works the header only counts its time: what it is
  // doing is the cap's to say, by the message box
  @tracked private now = Date.now();
  private tick = modifier(() => {
    if (!this.args.turnHead?.working || isTesting()) {
      return;
    }
    let timer = setInterval(() => (this.now = Date.now()), 1000);
    return () => clearInterval(timer);
  });

  private get turnHeadLabel() {
    let head = this.args.turnHead;
    if (!head) {
      return 'Assistant';
    }
    if (head.working) {
      let seconds = Math.max(0, (this.now - head.at.getTime()) / 1000);
      return isTesting() ? 'Working' : formatToolDuration(seconds);
    }
    if (typeof head.seconds !== 'number' || head.seconds < 1) {
      return 'Assistant';
    }
    // what the work came to, so a reader can skip the rows below it
    return [
      `Worked for ${formatToolDuration(head.seconds)}`,
      head.calls ? `${head.calls} call${head.calls === 1 ? '' : 's'}` : '',
      head.files
        ? `${head.files} file${head.files === 1 ? '' : 's'} changed`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // the transcript's one time format is "11:03 PM"; the full date stays
  // on hover
  private get turnHeadTime() {
    let at = this.args.turnHead?.at;
    return at ? formatDate(at, 'iiii MMM d, yyyy, h:mm aa') : undefined;
  }

  private get shortTime() {
    return formatDate(this.args.datetime, 'h:mm aa');
  }

  <template>
    <section
      data-scroll-anchor
      class={{cn
        'ai-assistant-message'
        from-assistant=@isFromAssistant
        meta-hidden=@hideMeta
        code-patch-correctness=@isCodePatchCorrectness
      }}
      {{MessageScroller
        index=@index
        registerScroller=@registerScroller
        unregisterScroller=@unregisterScroller
      }}
      {{ReloadBillingOnInsert
        shouldReloadBillingData=this.shouldReloadBillingData
        reload=(perform this.reloadBillingDataTask)
      }}
      {{motion id=@eventId role=(if @isStreaming 'message-live' 'message')}}
      {{this.wakeOnPress}}
      data-test-ai-assistant-message
      data-test-ai-assistant-message-pending={{@isPending}}
      ...attributes
    >
      {{#if this.showsTurnHead}}
        {{! who is speaking and where the turn stands: the assistant's mark,
            still, and "Worked for 24s"; the time is on hover. While the turn
            works a quiet turning ring stands in for the mark: the animated
            mark belongs to the cap by the message box alone }}
        <div
          class='turn-head'
          title={{this.turnHeadTime}}
          data-test-turn-head
          {{this.tick}}
        >
          <SpeakerLabel
            @agent={{true}}
            @name='Assistant'
            @time={{this.turnHeadLabel}}
            @working={{this.turnHeadWorking}}
            data-test-ai-avatar
          />
          {{#if @turnHead.toggleThinking}}
            <button
              type='button'
              class='turn-head-thinking'
              aria-expanded={{if @turnHead.thinkingShown 'true' 'false'}}
              data-test-turn-thinking-toggle
              {{on 'click' @turnHead.toggleThinking}}
            >{{if
                @turnHead.thinkingShown
                'Hide thinking'
                'Show thinking'
              }}</button>
          {{/if}}
        </div>
      {{else if this.showsMeta}}
        <Meta
          @datetime={{@datetime}}
          @isFromAssistant={{@isFromAssistant}}
          @profileAvatar={{@profileAvatar}}
          @isAvatarAnimated={{false}}
        />
      {{/if}}
      <MessageMotion
        class='content'
        @live={{@isStreaming}}
        @idle={{this.motionIdle}}
        data-test-ai-message-content
      >
        {{#if @isFromAssistant}}
          {{#if @compaction}}
            <CompactionStatus @compaction={{@compaction}} />
          {{/if}}
          {{#if this.hasBotMessage}}
            <AiBotMessage
              @monacoSDK={{@monacoSDK}}
              @htmlParts={{@messageHTMLParts}}
              @body={{@messageBody}}
              @isCanceled={{@isCanceled}}
              @roomId={{@roomId}}
              @eventId={{@eventId}}
              @isStreaming={{@isStreaming}}
              @reasoning={{if
                this.shownReasoning
                (hash
                  content=this.shownReasoning
                  isExpanded=this.isReasoningExpanded
                  setExpanded=this.setReasoningExpanded
                  isWorking=this.isReasoning
                  mode=@reasoningMode
                )
              }}
            />
          {{/if}}
          {{#if this.hasItems}}
            <Attachments
              @items={{this.items}}
              @downloadFile={{if @isDebugMessage this.downloadFile}}
            />
          {{/if}}
        {{else if @deliveryNote}}
          <p class='delivery-note' data-test-run-delivery-note>
            <span class='delivery-note-mark' aria-hidden='true'>↳</span>
            {{@deliveryNote}}
          </p>
        {{else}}
          <UserMessage
            @html={{@messageHTML}}
            @isPending={{@isPending}}
            @authorName={{unless @hideMeta @authorName}}
            @isSelf={{unless @hideMeta @isSelf}}
            @continued={{@continuesRun}}
            @time={{this.shortTime}}
            @avatar={{@profileAvatar}}
          >
            <:attachments>{{#if this.hasItems}}<Attachments
                  class={{if @repeatsContext 'repeats-context'}}
                  @items={{this.items}}
                  @attachedCardsAsFiles={{@attachedCardsAsFiles}}
                  @downloadFile={{if @isDebugMessage this.downloadFile}}
                />{{/if}}</:attachments>
          </UserMessage>
        {{/if}}

        {{yield}}

        {{#if this.errorMessages.length}}
          {{#if this.isOutOfCreditsErrorMessage}}
            <Alert @type='error' as |Alert|>
              <Alert.Messages @messages={{this.errorMessages}} />
              {{#if this.isOutOfCredits}}
                <Alert.Action
                  @actionName='Buy More Credits'
                  @action={{this.operatorModeStateService.toggleProfileSettings}}
                />
              {{else if @retryAction}}
                <div class='credits-action-row'>
                  <div class='credits-added' data-test-credits-added>
                    Credits added!
                  </div>
                  <Alert.Action @actionName='Retry' @action={{@retryAction}} />
                </div>
              {{/if}}
            </Alert>
          {{else}}
            <Alert @type='error' as |Alert|>
              <Alert.Messages @messages={{this.errorMessages}} />
              {{#if this.hasAlertActions}}
                <div
                  class='alert-action-buttons-row'
                  data-test-alert-action-buttons-row
                >
                  {{#if @waitAction}}
                    <Alert.Action
                      @actionName='Wait longer'
                      @action={{@waitAction}}
                    />
                  {{/if}}
                  {{#if @retryAction}}
                    <Alert.Action
                      @actionName='Retry'
                      @action={{@retryAction}}
                    />
                  {{/if}}
                </div>
              {{/if}}
            </Alert>
          {{/if}}
        {{/if}}

        {{#if @answerFooter.diff.perFile.length}}
          {{! what the turn changed, file by file, with its size; a file
              opens in the editor (Pret UI's TurnChanges). It has no Review:
              the host has no view that reviews a turn's changes }}
          {{! a later answer does not take it away: what a turn changed is
              part of the turn (ADR 013 §1.16) }}
          <TurnChanges
            class='turn-changes-row'
            @files={{this.changedFiles}}
            @onOpen={{this.openChangedFile}}
            data-test-turn-changes
          />
        {{/if}}
        {{#if @answerFooter}}
          {{! superseded by a later answer, it stays as it was (ADR 013
              §1.16) }}
          <AnswerFooter @footer={{@answerFooter}} title={{this.tokenUsage}} />
        {{/if}}
        {{#if this.tokenUsage}}
          {{! the turn's footer carries the cost; this line stays for the
              diagnostic count, and takes no line of its own }}
          <div
            class='token-usage'
            title={{this.tokenUsage}}
            data-test-token-usage
          >
            {{this.tokenCredits}}
          </div>
        {{/if}}
      </MessageMotion>
    </section>

    <style scoped>
      .ai-assistant-message {
        --ai-bot-message-background-color: var(--boxel-650);
        --ai-assistant-message-avatar-size: 0.75rem; /* 12px. */
        --ai-assistant-message-meta-height: 0.75rem; /* 12px */
        --ai-assistant-message-gap: var(--boxel-sp-xxxs);
        --profile-avatar-icon-size: var(--ai-assistant-message-avatar-size);
        --profile-avatar-icon-border: 1px solid var(--boxel-400);
      }
      .ai-assistant-message > * + * {
        margin-top: var(--step-12, 12px);
      }
      .content {
        /* clip only sideways: wide content stays in the column, and what
           shows below the last line on hover (the bubble's time) isn't cut */
        overflow: clip visible;
        /* room for what hangs outside the text edge (a step row's hover
           inset and its rounded corners), given back so the text edge
           stays where it was */
        padding-inline: 13px;
        margin-inline: -13px;
        /* and a framed row's 1px ring, drawn just outside its box, at the
           bottom of the message (and at its top); the margins below give
           the 2px back, so the parts' own rhythm is what shows */
        padding-block: 2px;
        margin-bottom: -2px;
      }
      .ai-assistant-message > .content:first-child {
        margin-top: -2px;
      }
      .ai-assistant-message > * + .content {
        margin-top: calc(var(--step-12, 12px) - 2px);
      }
      /* the turn's label sits 8px over what it labels, as the study's
         speaker line does */
      .ai-assistant-message > .turn-head + .content {
        margin-top: calc(var(--step-8, 8px) - 2px);
      }
      /* a turn's parts: 12px between blocks; calls in a run 4px apart,
         and plain step rows flush, as one list */
      .content > :deep(* + *) {
        margin-top: var(--step-12, 12px);
      }
      .content > :deep(.room-message-tool + .room-message-tool) {
        margin-top: var(--step-4, 4px);
      }
      .content
        > :deep(
          .room-message-tool:has(> .pretui-toolrow:not([data-framed]))
            + .room-message-tool:has(> .pretui-toolrow:not([data-framed]))
        ) {
        margin-top: 0;
      }
      /* a framed call is a box: it stands 8px off the call beside it, so
         two open boxes never touch */
      .content
        > :deep(
          .room-message-tool:has(> .pretui-toolrow[data-framed])
            + .room-message-tool
        ),
      .content
        > :deep(
          .room-message-tool
            + .room-message-tool:has(> .pretui-toolrow[data-framed])
        ) {
        margin-top: var(--step-8, 8px);
      }
      /* Choreo's layers come first in a message's region and sit out of
         flow: the rhythm starts at the message's first part, not 12px
         below an invisible layer */
      .content > :deep([data-choreo-tethers] + *) {
        margin-top: 0;
      }

      .ai-assistant-message.code-patch-correctness
        .content
        > :deep(.room-message-tool.compact + .room-message-tool.compact) {
        margin-top: 0;
      }
      /* code in what was written (the reply, the user's message) wraps;
         a Pret UI code block or a tool row's code keeps its own rules */
      :deep(:is(.pretui-md-block, .markdown-content, .user-message-text) pre) {
        white-space: pre-wrap;
      }
      :deep(:is(.pretui-md-block, .markdown-content, .user-message-text) code) {
        overflow-wrap: break-word;
      }

      /* the turn's head sits as a row does: the mark on the mark column
         (16px), its words on the row-title edge (40px) */
      /* the turn's thinking, behind one quiet control in its header */
      .turn-head-thinking {
        flex: none;
        white-space: nowrap;
        margin-inline-start: var(--step-8, 8px);
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        color: var(--ink-3, var(--boxel-450));
        text-decoration: underline;
        text-decoration-color: color-mix(
          in oklch,
          currentColor 40%,
          transparent
        );
        text-underline-offset: 0.18em;
        cursor: pointer;
      }
      .turn-head-thinking:hover {
        color: var(--ink-2, var(--boxel-300));
      }
      .turn-head-thinking:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
        border-radius: 2px;
      }
      /* the speaker line and its one control; "Worked for 24s" is the
         line's time, its figures tabular */
      .turn-head {
        display: flex;
        align-items: center;
        gap: var(--step-8, 8px);
        min-width: 0;
        font-variant-numeric: tabular-nums;
      }
      .turn-head > :deep(.pretui-speaker) {
        flex: 0 1 auto;
      }

      .delivery-note {
        display: flex;
        align-items: baseline;
        gap: var(--step-8, 8px);
        margin: 0;
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        color: var(--ink-2, var(--boxel-450));
      }
      .delivery-note-mark {
        color: var(--success, var(--boxel-teal));
      }

      .alert-action-buttons-row {
        display: flex;
        justify-content: flex-end;
        gap: var(--boxel-sp-sm);
      }

      .alert-action-buttons-row > :deep(.action-button) {
        margin-left: 0;
      }

      .add-more-credits-button {
        --boxel-button-padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        --boxel-button-min-height: max-content;
        --boxel-button-min-width: max-content;
        border-color: transparent;
        width: fit-content;
        margin-left: auto;
        font-size: var(--type-ui, 12.5px);
        font-weight: 600;
      }
      .credits-action-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--boxel-sp-sm);
      }
      .credits-action-row :deep(.action-button) {
        margin-left: 0;
      }
      .credits-added {
        font-size: var(--type-ui, 12.5px);
        font-weight: 600;
      }
      .ai-assistant-message {
        position: relative;
      }
      /* the per-message count is a diagnostic: the footer's title and the
         session line say it to the eye; here it is only text for assistive
         tech and tools, with no box that could overlap the next row */
      .content > .token-usage {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
      }
    </style>
  </template>

  // The "Thinking..." placeholder stands for work not yet visible; while a
  // compaction runs, its own row says what the assistant is doing instead.
  // Once the turn is past it, a placeholder with no reasoning behind it is
  // an empty "Thought" chip: it shows nothing, so it is not shown.
  private get reasoningContent() {
    if (
      isThinkingMessage(this.args.reasoningContent) &&
      (this.args.compaction?.status === 'running' || !this.isReasoning)
    ) {
      return null;
    }
    return this.args.reasoningContent;
  }

  // the reply has something to show: its words, reasoning that isn't
  // folded away, or the line that says it was stopped. An empty reply takes
  // no place in the turn's rhythm
  private get hasBotMessage() {
    return Boolean(
      this.args.messageHTMLParts?.length ||
      this.shownReasoning ||
      this.args.isCanceled,
    );
  }

  private get shownReasoning(): string | null {
    if (this.args.reasoningFolded || this.args.reasoningMode === 'hidden') {
      return null;
    }
    return this.reasoningContent ?? null;
  }

  // The provider's token counts for the turn that produced this message.
  // Shown only behind the `showTokens` query param: it is a diagnostic for
  // measuring prompt cost, not something every reader needs to see.
  @cached
  private get tokenUsage() {
    if (!this.operatorModeStateService.operatorModeController.showTokens) {
      return undefined;
    }
    let { usage } = this.args;
    if (usage?.promptTokens == null && usage?.completionTokens == null) {
      return undefined;
    }
    return formatTokenUsage(usage);
  }

  // What the turn cost, in the unit the account is billed in. The token
  // breakdown stays one hover away, on the line's title.
  private get tokenCredits() {
    let cost = this.args.usage?.costUsd;
    return cost != null ? formatCredits(cost) : this.tokenUsage;
  }

  private get isAvatarAnimated() {
    return this.args.isStreaming && !this.args.errorMessage;
  }

  private get hasItems() {
    return (
      (this.args.files && this.args.files.length > 0) ||
      (this.args.collectionResource &&
        (this.args.collectionResource.cards.length > 0 ||
          this.args.collectionResource.cardErrors.length > 0))
    );
  }

  private get items() {
    return [
      ...(this.args.collectionResource ? [this.args.collectionResource] : []),
      ...(this.args.files ?? []),
    ];
  }

  private get errorMessages() {
    return [
      ...(this.args.errorMessage ? [this.args.errorMessage] : []),
      ...attachedCardErrorMessages(
        this.args.collectionResource?.cardErrors ?? [],
      ),
    ];
  }

  private get hasAlertActions() {
    return Boolean(this.args.waitAction || this.args.retryAction);
  }

  private get shouldReloadBillingData() {
    return Boolean(
      this.args.reloadBillingData && this.args.isMostRecentMessage,
    );
  }

  private get isOutOfCreditsErrorMessage(): boolean {
    return this.errorMessages.some((error) =>
      /You need a minimum of \d+ credits to continue using the AI bot\. Please upgrade to a larger plan, or top up your account\./.test(
        error,
      ),
    );
  }

  private get hasMinimumCreditsToContinue(): boolean {
    return (
      this.billingService.availableCredits >= MINIMUM_AI_CREDITS_TO_CONTINUE
    );
  }

  private get isOutOfCredits() {
    return !this.hasMinimumCreditsToContinue;
  }
}

/** Bring an element of the transcript into view, through its scroll owner */
export type ConversationNavigate = (
  element: HTMLElement,
  opts?: { block?: 'start' | 'center'; behavior?: ScrollBehavior },
) => void;

interface AiAssistantConversationSignature {
  Element: HTMLDivElement;
  Args: {
    // changes whenever the transcript's content does: a reader following
    // the end is pinned to it in the same render (Pret UI StickToBottom)
    revision?: unknown;
    setScrollPosition: (args: { isBottom: boolean }) => void;
    registerConversationScroller: (
      isScrollable: () => boolean,
      scrollToBottom: () => void,
      navigate: ConversationNavigate,
    ) => void;
    /** a response is streaming: selecting text while it streams holds the
     * transcript still */
    isStreaming?: boolean;
    /** the room's history is in: what renders before then is a load, not a
     * change, and is not animated (ADR 013 §1.19) */
    ready?: boolean;
  };
  Blocks: {
    default: [];
  };
}

/** Hands the room its two handles on the transcript once the scroll owner
 * exists: whether it scrolls, and how to send it to the end. Both read the
 * live element when called, so they stay right across re-renders. */
const registerConversation = modifier(
  (
    _element: HTMLElement,
    [api, register]: [
      StickToBottomApi,
      AiAssistantConversationSignature['Args']['registerConversationScroller'],
    ],
  ) => {
    register(
      () => {
        let el = api.scrollElement;
        return el ? el.scrollHeight > el.clientHeight : false;
      },
      () => api.scrollToEnd(),
      (element, opts) => api.navigate(element, opts),
    );
    // the transcript holds its scroll anchor in Choreo's SETTLE phase: after
    // the pass's mounts, before any region measures, so the motion layer
    // sees the page as the reader will (scroll-anchoring-protocol.md)
    return registerSettle(() => api.settle());
  },
);

// The transcript's scroll owner is Pret UI's StickToBottom: it follows new
// content while the reader is at the end, lets go the moment they read
// elsewhere, and keeps their line still when the footer grows. The room keeps
// its own contract — told when the reader is at the bottom, handed a way to
// scroll there — so its unread and auto-scroll logic is unchanged.
class AiAssistantConversation extends Component<AiAssistantConversationSignature> {
  // A link out of Boxel, anywhere in the session (an answer, its sources, a
  // tool row's line), opens in its own window so the session stays put.
  // Cards and files keep their own click: they open in Quick Look.
  private openLinkOut = (event: Event) => {
    if (event.defaultPrevented || (event as MouseEvent).button !== 0) {
      return;
    }
    let link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      'a[href]',
    );
    if (!link || link.closest('[data-card-ref]')) {
      return;
    }
    let url: URL;
    try {
      url = new URL(link.href, window.location.href);
    } catch {
      return;
    }
    if (
      !HTTP_PROTOCOL.test(url.protocol) ||
      url.origin === window.location.origin
    ) {
      return;
    }
    event.preventDefault();
    window.open(url.href, '_blank', 'noopener,noreferrer');
  };

  private followChanged = (following: boolean) => {
    this.args.setScrollPosition({ isBottom: following });
  };

  <template>
    <StickToBottom
      class='ai-assistant-conversation'
      @label='AI Bot conversation'
      @active={{@isStreaming}}
      @threshold={{BOTTOM_THRESHOLD}}
      @onFollowChange={{this.followChanged}}
      @revision={{@revision}}
      @recede={{true}}
      aria-live='polite'
      data-test-ai-assistant-conversation
    >
      <:default as |scroll|>
        <TranscriptMotion
          class='ai-assistant-conversation-messages'
          @live={{@isStreaming}}
          @ready={{@ready}}
          {{registerConversation scroll @registerConversationScroller}}
          {{on 'click' this.openLinkOut}}
        >
          {{yield}}
        </TranscriptMotion>
      </:default>
    </StickToBottom>
    <style scoped>
      .ai-assistant-conversation {
        /* This lets the conversation be visible in the missing border radius of the form, with its gradient */
        margin-bottom: calc(var(--chat-input-area-border-radius) * -1);
        /* the conversation is a grid item: without these, its widest child
           (a long unbroken label, a wide table) sets the panel's width.
           The old scroller got this for free from overflow: auto */
        min-height: 0;
        min-width: 0;
        --pretui-stick-to-bottom-ground: transparent;
        /* the transcript answers the panel's width, not the window's:
           narrow (320), medium (440) and wide (680) panels each read right */
        container-type: inline-size;
        container-name: ai-conversation;
      }
      /* the reader's bubble is Pret UI's UserBubble, which keeps its own
         reading measure (92% narrow, 80%, 70% wide) and hangs left */
      /* narrow: give the text the panel's edges back */
      /* the gutter stays 16px at every width: a framed row and a reply's
         table hang 12px into it, so their text sits on the text edge, and
         4px of panel always shows outside them */
      /* the header's fade runs on this scroll: it must name the element
         that scrolls, which in Pret UI's StickToBottom is the viewport, not
         its content */
      .ai-assistant-conversation :deep(.pretui-stick-to-bottom-viewport) {
        scroll-timeline: --ai-assistant-chat-scroll-timeline;
        /* the kit keeps the bar thin and its gutter stable; this quietens
           its thumb on the dark panel */
        scrollbar-color: color-mix(in oklch, var(--foreground) 24%, transparent)
          transparent;
      }
      .ai-assistant-conversation-messages {
        display: flex;
        flex-direction: column;
        /* the transcript's base is the UI type (rows, steps, status);
           answers and the reader's bubble set the reading type themselves */
        font-size: var(--type-ui, 12.5px);
        line-height: var(--leading-ui, 18px);
        /* the transcript's own words (rows, steps, receipts) are settled
           work: ink-2, as the study draws them. Answers and the reader's
           bubble set ink-1 themselves */
        color: var(--pretui-toolrow-settled-ink, var(--foreground));
        --pretui-toolrow-title-size: var(--type-ui, 12.5px);
        /* the spine: text edges at 16 from the transcript's edge (marks at
           16, row titles at 40) */
        /* at the end, just clear of the fade over the composer's edge: the
           last answer ends close to the box it was asked from */
        padding: var(--step-16, 16px) var(--ai-assistant-panel-padding)
          calc(
            var(--ai-assistant-panel-bottom-gradient-height) +
              var(--step-4, 4px)
          )
          var(--ai-assistant-panel-padding);
      }
      /* one rhythm: 12 between blocks within a turn, 24 between turns */
      .ai-assistant-conversation-messages > :deep(* + *),
      .ai-assistant-conversation-messages > :deep(* + .meta-hidden) {
        margin-top: var(--step-12, 12px);
      }
      /* a change of speaker starts a turn: 24px, either way round */
      .ai-assistant-conversation-messages
        > :deep(.from-assistant + .ai-assistant-message:not(.from-assistant)),
      .ai-assistant-conversation-messages
        > :deep(
          .ai-assistant-message:not(.from-assistant)
            + .ai-assistant-message.from-assistant
        ) {
        margin-top: var(--step-24, 24px);
      }
      /* a headerless bot-tool indicator message stacks flush against a
         preceding message of the same kind — headered or not, since the run's
         first message may carry the header — so a burst of reads presents as
         one list */
      .ai-assistant-conversation-messages
        > :deep(.bot-tools-only + .bot-tools-only.meta-hidden) {
        margin-top: 0;
      }
      .ai-assistant-conversation-messages > :deep(* + .code-patch-correctness) {
        margin-top: var(--step-8, 8px);
      }
      /* a turn's calls are one list across its events: a call event under
         one that ended in a call stacks 4px apart; an answer keeps the
         12px a block gets */
      .ai-assistant-conversation-messages
        > :deep(
          .from-assistant:has(.room-message-tool) + .work-part.meta-hidden
        ) {
        margin-top: var(--step-4, 4px);
      }
      .ai-assistant-conversation-messages
        > :deep(
          .from-assistant:has(.room-message-tool > .pretui-toolrow[data-framed])
            + .work-part.meta-hidden
        ),
      .ai-assistant-conversation-messages
        > :deep(
          .from-assistant:has(.room-message-tool)
            + .work-part.meta-hidden:has(
              .room-message-tool > .pretui-toolrow[data-framed]
            )
        ) {
        margin-top: var(--step-8, 8px);
      }
      /* a check right after a write is a step like any other: on the
         rows' edge, at their size, 4px under the write as work parts are */
      .ai-assistant-conversation-messages
        :deep(.code-patch-correctness .pretui-toolrow-header) {
        min-height: 24px;
        padding-block: 4px;
      }

      /* a part folded away is hidden at once; its region moves what is
         left (motion/transcript-motion.gts) */
      .ai-assistant-conversation-messages
        :deep(
          :is(.ai-assistant-conversation-messages > *, .content > *)[hidden]
        ) {
        display: none;
      }
      /* Choreo's own layers (leavers, raised, wires) come first in the
         region and sit out of flow; the rhythm starts at the first message */
      .ai-assistant-conversation-messages > :deep([data-choreo-tethers] + *) {
        margin-top: 0;
      }
    </style>
  </template>
}

export { AiAssistantConversation };
