import { fn } from '@ember/helper';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { CollapsedTurn } from '@cardstack/pretui/components/collapsed-turn';
import { ToolGroup } from '@cardstack/pretui/components/tool-group';

import { humanizeToolName } from '@cardstack/pretui/components/tool-row';
import { task } from 'ember-concurrency';

import { consume } from 'ember-provide-consume-context';

import { Avatar } from '@cardstack/boxel-ui/components';

import { bool, cn } from '@cardstack/boxel-ui/helpers';

import {
  type getCardCollection,
  GetCardCollectionContextName,
} from '@cardstack/runtime-common';

import type { Message } from '@cardstack/host/lib/matrix-classes/message';
import type MessageTool from '@cardstack/host/lib/matrix-classes/message-tool';
import { isRunDelivery } from '@cardstack/host/lib/run-delivery';
import { isAutoExecutableTool } from '@cardstack/host/lib/tool-auto-execute';
import type {
  AnswerFooterData,
  ReasoningMode,
  TurnFold,
  TurnHead,
} from '@cardstack/host/lib/turn-summary';
import type { RoomResource } from '@cardstack/host/resources/room';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type { MonacoSDK } from '@cardstack/host/services/monaco-service';
import type ToolService from '@cardstack/host/services/tool-service';

import AiAssistantMessage from '../ai-assistant/message';
import { aiBotUserId } from '../ai-assistant/panel';

import RoomMessageTool from './room-message-tool';

import type { ToolPart } from '@cardstack/pretui/components/tool-group';

interface ToolRun {
  key: string;
  command: MessageTool;
  count?: number;
  group?: MessageTool[];
  parts?: ToolPart[];
  summary?: string;
  // some calls in the group are still running
  pending?: boolean;
}

interface Signature {
  Element: HTMLElement;
  Args: {
    roomId: string;
    // The keyed #each over the room's messages keeps this component when other
    // messages change. The message itself comes as an arg so that only a change to
    // it re-renders this one: read through roomResource.messages, every getter here
    // reran on every event in the room (a new list each time), and the cached
    // ones (the attached cards) rebuilt for every message in the transcript.
    roomResource: RoomResource;
    message?: Message;
    index: number;
    monacoSDK: MonacoSDK;
    isStreaming: boolean;
    // the message is in the room's latest turn, where it can still change
    inLatestTurn?: boolean;
    isMostRecentMessage?: boolean;
    retryAction?: () => void;
    isPending?: boolean;
    // this message stands for a run of N identical calls folded into it
    foldCount?: number;
    // the settled turn this message belongs to folds its tool rows
    turnFold?: TurnFold;
    turnHead?: TurnHead;
    reasoningMode?: ReasoningMode;
    // this message is its turn's final reply: the quiet actions under it
    answerFooter?: AnswerFooterData;
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
}

const STREAMING_TIMEOUT_MS = 3 * 60 * 1000;
export const STREAMING_TIMEOUT_MINUTES = STREAMING_TIMEOUT_MS / 60_000;

// A message from the same author landing within this window of the previous
// message renders without its avatar/timestamp header.
const MESSAGE_GROUPING_WINDOW_MS = 2 * 60 * 1000;
// A conversation reads as one sitting until it pauses this long or the day
// changes; only then does a turn earn its date stamp again.
const CONVERSATION_PAUSE_MS = 15 * 60 * 1000;

export default class RoomMessage extends Component<Signature> {
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;
  @tracked private timeoutCheckTimestamp = Date.now();
  @tracked private waitStartTimestamp: number | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.checkStreamingTimeout.perform();
  }

  private get message(): Message {
    return (
      this.args.message ?? this.args.roomResource.messages[this.args.index]!
    );
  }

  @cached
  private get attachedCardCollection(): ReturnType<getCardCollection> {
    return this.getCardCollection(
      this,
      () => this.message.attachedCardIds ?? [],
    );
  }

  private checkStreamingTimeout = task(async () => {
    if (!this.isFromAssistant || !this.args.isStreaming) {
      return;
    }

    if (this.message.isStreamingFinished === true) {
      return;
    }

    this.bumpTimeoutCheckTimestamp();

    // Do this check every second
    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.checkStreamingTimeout.perform();
  });

  private waitLonger = () => {
    this.waitStartTimestamp = Date.now();
    this.bumpTimeoutCheckTimestamp();
    if (!this.checkStreamingTimeout.isRunning) {
      this.checkStreamingTimeout.perform();
    }
  };

  private bumpTimeoutCheckTimestamp() {
    // This is needed for the streamingTimeout getter reactivity - it will update on every tick of the checkStreamingTimeout task
    this.timeoutCheckTimestamp = Date.now();
  }

  private get streamingTimeout() {
    if (!this.isFromAssistant || !this.args.isStreaming) {
      return false;
    }

    if (!this.isLastAssistantMessage) {
      return false;
    }

    if (this.message.isStreamingFinished === true) {
      return false;
    }

    let lastActivityTimestamp = Math.max(
      Number(this.message.updated),
      this.waitStartTimestamp ?? 0,
    );

    // If message is streaming and hasn't been updated in the last three minutes, show a timeout message
    return (
      this.timeoutCheckTimestamp - lastActivityTimestamp > STREAMING_TIMEOUT_MS
    );
  }

  // before the Matrix SDK has loaded, no message is the reader's own
  private get isSelf() {
    let self = this.matrixService.loadedUserId;
    return Boolean(self) && this.message.author.userId === self;
  }

  private get isFromAssistant() {
    return this.message.author.userId === aiBotUserId;
  }

  private get isLastAssistantMessage() {
    return (
      this.isFromAssistant &&
      this.args.index === this.args.roomResource.indexOfLastNonDebugMessage
    );
  }

  // A call ai-bot holds for approval is "run" by approving it; ai-bot then
  // runs it. Every other call runs on the host. The work is the tool
  // service's: a settled turn folds and can take this message away while
  // the call runs, and that must not cancel it.
  private run = (command: MessageTool) => {
    if (command.awaitsApproval) {
      return this.toolService.answerApproval.perform(command, 'approve');
    }
    return this.toolService.run.perform(command);
  };

  private decline = (command: MessageTool) => {
    return this.toolService.answerApproval.perform(command, 'decline');
  };

  // Correctness-check messages render all their tools compactly; bot-executed
  // tools (e.g. readRealmFile) render compactly even inside a regular message,
  // since they are status indicators rather than actionable tool calls — except
  // one ai-bot holds for the user's approval, which shows in full.
  private isCompactTool = (tool: MessageTool) =>
    this.message.isCodePatchCorrectness ||
    (tool.isBotExecuted && !tool.awaitsApproval);

  // Three or more finished calls to one tool in a row (a correctness check
  // after each file a script wrote) read as one row, "×N": the latest call
  // stands for the run. Anything unfinished or failed stays on its own.
  // Each run carries its call's id as the key its row is rendered by: the
  // runs are rebuilt on every streamed update, and a row keyed by the run
  // object itself would be torn down and drawn again each time.
  // the call a ToolGroup entry stands for, by its id
  private toolInRun = (run: ToolRun, id: string) =>
    run.group?.find(
      (tool, index) => (tool.id ?? run.parts?.[index]?.id) === id,
    );

  private get toolRuns(): ToolRun[] {
    let tools = this.message.tools ?? [];
    let runs: ToolRun[] = [];
    let keyOf = (k: number) => tools[k]!.id ?? `call-${k}`;
    // A call joins a group while it runs, not only once it is done: a burst
    // of forty checks reads as one counting line from its third call. A
    // call that failed, or that waits on the reader (held for approval, or
    // ready but not one the host runs on its own), stays its own row, where
    // its gate is.
    let runsOnItsOwn = (tool: MessageTool) =>
      isAutoExecutableTool(
        tool,
        this.args.roomResource.getActiveLLMModeForMessage(this.message.eventId),
        tool.message.agentId === this.matrixService.agentId,
      ) && !tool.clickReasons.length;
    let groupable = (tool: MessageTool) =>
      (tool.status === 'applied' ||
        tool.status === 'applying' ||
        (tool.status === 'ready' && runsOnItsOwn(tool))) &&
      !tool.awaitsApproval;
    let i = 0;
    while (i < tools.length) {
      let j = i;
      while (
        j + 1 < tools.length &&
        tools[j + 1]!.name === tools[i]!.name &&
        groupable(tools[j + 1]!) &&
        groupable(tools[i]!)
      ) {
        j += 1;
      }
      let count = j - i + 1;
      if (count >= 3) {
        let group = tools.slice(i, j + 1);
        let done = group.filter((tool) => tool.status === 'applied').length;
        let pending = done < count;
        let isCheck = tools[i]!.name === 'checkCorrectness';
        let name = humanizeToolName(tools[i]!.name ?? 'tool');
        runs.push({
          key: keyOf(i),
          command: tools[j]!,
          count,
          group,
          pending,
          parts: group.map((tool, index) => ({
            id: tool.id ?? `call-${i + index}`,
            name: tool.name ?? 'tool',
            state: tool.status === 'applied' ? 'completed' : 'running',
          })),
          summary: isCheck
            ? pending
              ? `Checking ${count} files · ${done} done`
              : `Checked ${count} files · all pass`
            : pending
              ? `${name} ×${count} · ${done} done`
              : `${name} ×${count}`,
        });
      } else {
        for (let k = i; k <= j; k++) {
          runs.push({ key: keyOf(k), command: tools[k]! });
        }
      }
      i = j + 1;
    }
    return runs;
  }

  // Whether a later call in the same stretch of assistant work (this message
  // and the ones after it, up to the user's next message) succeeded. A
  // failure the assistant recovered from then reads as retried, not as an
  // error waiting on the reader.
  private isRetriedLater = (tool: MessageTool) => {
    let tools = this.message.tools ?? [];
    let laterHere = tools.slice(tools.indexOf(tool) + 1);
    if (laterHere.some((t) => t.status === 'applied')) {
      return true;
    }
    let messages = this.args.roomResource.messages;
    for (let i = this.args.index + 1; i < messages.length; i++) {
      let next = messages[i]!;
      if (next.author.userId !== aiBotUserId) {
        return false;
      }
      if (next.tools?.some((t) => t.status === 'applied')) {
        return true;
      }
    }
    return false;
  };

  // A message carrying only bot-executed tool indicators — no prose,
  // reasoning, or attachments — stacks flush against a neighboring message of
  // the same kind, so a burst of readRealmFile calls reads as one list.
  private get isBotToolsOnlyMessage() {
    return (
      !!this.message.tools?.length &&
      this.message.tools.every(
        (tool) => tool.isBotExecuted && !tool.awaitsApproval,
      ) &&
      !this.message.htmlParts?.length &&
      !this.message.reasoningContent &&
      !this.message.attachedFiles?.length &&
      !this.message.attachedCardsAsFiles?.length &&
      !this.message.attachedCardIds?.length
    );
  }

  // A part of a turn that only shows the work (its thinking, its calls) and
  // says nothing to the reader: consecutive work parts stack as one list
  private get isWorkPart() {
    return (
      this.isFromAssistant &&
      !this.message.htmlParts?.length &&
      !this.message.attachedFiles?.length &&
      !this.message.attachedCardsAsFiles?.length &&
      !this.message.attachedCardIds?.length &&
      (!!this.message.tools?.length || !!this.message.reasoningContent)
    );
  }

  // A quick succession of messages from one author reads as a single run of
  // conversation, so only the first message in the run gets an avatar and
  // timestamp header.
  // the same person's messages back to back, in one run: the bubble sits
  // closer to the one above
  private get continuesOwnRun() {
    let previousMessage = this.args.roomResource.messages[this.args.index - 1];
    return Boolean(
      previousMessage &&
      previousMessage.author.userId === this.message.author.userId &&
      this.message.created.getTime() - previousMessage.created.getTime() <
        MESSAGE_GROUPING_WINDOW_MS,
    );
  }

  private get isGroupedWithPreviousMessage() {
    let messages = this.args.roomResource.messages;
    let previousMessage = messages[this.args.index - 1];
    if (!previousMessage) {
      return false;
    }
    let gap =
      this.message.created.getTime() - previousMessage.created.getTime();
    if (previousMessage.author.userId === this.message.author.userId) {
      return gap < MESSAGE_GROUPING_WINDOW_MS;
    }
    // A turn and its answer, in one sitting, share one header: the
    // assistant's reply follows the bubble without one of its own. A
    // person's message, though, always carries theirs.
    if (
      gap >= CONVERSATION_PAUSE_MS ||
      this.message.created.toDateString() !==
        previousMessage.created.toDateString()
    ) {
      return false;
    }
    if (this.isFromAssistant) {
      return true;
    }
    // a person's message after the assistant's reply always says who wrote
    // it: their avatar and name over the bubble
    return false;
  }

  // The user's previous message shared exactly these cards and files, so
  // its chips already say what this one is about.
  private get repeatsContext() {
    if (this.isFromAssistant) {
      return false;
    }
    let ids = (message: { attachedCardIds?: string[] | null }) =>
      [...(message.attachedCardIds ?? [])].sort().join(' ');
    let files = (message: { attachedFiles?: { sourceUrl?: string }[] }) =>
      (message.attachedFiles ?? [])
        .map((file) => file.sourceUrl ?? '')
        .sort()
        .join(' ');
    let messages = this.args.roomResource.messages;
    for (let i = this.args.index - 1; i >= 0; i--) {
      let earlier = messages[i]!;
      if (earlier.author.userId === this.message.author.userId) {
        let same =
          ids(earlier) === ids(this.message) &&
          files(earlier as any) === files(this.message as any);
        return same && Boolean(ids(this.message) || files(this.message as any));
      }
    }
    return false;
  }

  // The host posted this for the reader: a background run finished and its
  // result went to the assistant. It reads as a line in the thread, never
  // as something the reader typed.
  private get deliveryNote() {
    return !this.isFromAssistant &&
      isRunDelivery(this.message.clientGeneratedId)
      ? 'Background run finished · result posted for the assistant'
      : undefined;
  }

  // Folded, a turn's message with no prose of its own has nothing left to
  // show: it takes no line. The turn's first one stays, for the summary.
  private get foldedAway() {
    return (
      this.rowsFolded &&
      !this.args.turnFold?.isFirst &&
      !this.message.body?.trim() &&
      !this.errorMessage
    );
  }

  private get rowsFolded() {
    let fold = this.args.turnFold;
    return Boolean(fold && !fold.expanded);
  }

  private get hideMeta() {
    return (
      this.message.isCodePatchCorrectness || this.isGroupedWithPreviousMessage
    );
  }

  <template>
    {{! We Intentionally wait until message resources are loaded (i.e. have a value) before rendering the message.
      This is because if the message resources render asynchronously after the message is already rendered (e.g. card pills),
      it is problematic to ensure the last message sticks to the bottom of the screen.
      In AiAssistantMessage, there is a ScrollIntoView modifier that will scroll the last message into view (i.e. scroll to the bottom) when it renders.
      If we let things in the message render asynchronously, the height of the message will change after that and the scroll position will move up a bit (i.e. not stick to the bottom).
    }}
    {{#if this.attachedCardCollection.isLoaded}}
      <AiAssistantMessage
        id='message-container-{{@index}}'
        @messageHTML={{this.message.bodyHTML}}
        @messageHTMLParts={{this.message.htmlParts}}
        @messageBody={{this.message.body}}
        @isCanceled={{this.message.isCanceled}}
        @reasoningContent={{this.message.reasoningContent}}
        @monacoSDK={{@monacoSDK}}
        @datetime={{this.message.created}}
        @roomId={{this.message.roomId}}
        @eventId={{this.message.eventId}}
        @index={{@index}}
        @isMostRecentMessage={{@isMostRecentMessage}}
        @registerScroller={{@registerScroller}}
        @unregisterScroller={{@unregisterScroller}}
        @isFromAssistant={{this.isFromAssistant}}
        {{! @glint-ignore }}
        @profileAvatar={{component
          Avatar
          isReady=true
          userId=this.message.author.userId
          displayName=this.message.author.displayName
        }}
        @collectionResource={{this.attachedCardCollection}}
        @files={{this.message.attachedFiles}}
        @attachedCardsAsFiles={{this.message.attachedCardsAsFiles}}
        @errorMessage={{this.errorMessage}}
        @reloadBillingData={{this.message.reloadBillingData}}
        @isDebugMessage={{this.message.isDebugMessage}}
        @isStreaming={{@isStreaming}}
        @inLatestTurn={{@inLatestTurn}}
        @retryAction={{@retryAction}}
        @waitAction={{if this.streamingTimeout this.waitLonger}}
        @isPending={{@isPending}}
        @hideMeta={{this.hideMeta}}
        @authorName={{this.message.author.name}}
        @isSelf={{this.isSelf}}
        @continuesRun={{this.continuesOwnRun}}
        @repeatsContext={{this.repeatsContext}}
        @isCodePatchCorrectness={{this.message.isCodePatchCorrectness}}
        @commands={{this.message.tools}}
        @usage={{this.message.usage}}
        @compaction={{this.message.compaction}}
        @deliveryNote={{this.deliveryNote}}
        @reasoningFolded={{this.rowsFolded}}
        @turnHead={{@turnHead}}
        @reasoningMode={{@reasoningMode}}
        hidden={{this.foldedAway}}
        @answerFooter={{@answerFooter}}
        data-test-boxel-message-from={{this.message.author.name}}
        class={{cn
          bot-tools-only=this.isBotToolsOnlyMessage
          work-part=this.isWorkPart
        }}
        data-test-boxel-message-instance-id={{this.message.instanceId}}
        ...attributes
      >
        {{#if @turnFold.isFirst}}
          {{! The settled turn's tool rows, folded to what they did. The rows
              stay mounted while folded: a background run inside the turn
              keeps reporting, and can still post its result. }}
          <CollapsedTurn
            class='turn-fold'
            @summary={{@turnFold.summary}}
            @expanded={{@turnFold.expanded}}
            @onExpand={{@turnFold.toggle}}
            @variant='row'
            data-test-turn-fold={{@turnFold.key}}
          />
        {{/if}}
        {{#each this.toolRuns key='key' as |run|}}
          {{#if run.group}}
            {{! three or more finished calls to one tool, as Pret UI's
                ToolGroup: one receipt line that opens onto every call }}
            <ToolGroup
              hidden={{this.rowsFolded}}
              @tools={{run.parts}}
              @merge='none'
              @pending={{run.pending}}
              @summary={{run.summary}}
              data-test-tool-run-group={{run.count}}
            >
              <:tool as |entry|>
                {{#let (this.toolInRun run entry.id) as |command|}}
                  {{#if command}}
                    <RoomMessageTool
                      @messageTool={{command}}
                      @roomResource={{@roomResource}}
                      @runCommand={{fn this.run command}}
                      @declineCommand={{fn this.decline command}}
                      @roomId={{@roomId}}
                      @isPending={{@isPending}}
                      @isCompact={{this.isCompactTool command}}
                      @monacoSDK={{@monacoSDK}}
                      @isError={{bool this.errorMessage}}
                      @isStreaming={{@isStreaming}}
                    />
                  {{/if}}
                {{/let}}
              </:tool>
            </ToolGroup>
          {{else}}
            {{#let run.command as |command|}}
              <RoomMessageTool
                hidden={{this.rowsFolded}}
                @messageTool={{command}}
                @roomResource={{@roomResource}}
                @runCommand={{fn this.run command}}
                @declineCommand={{fn this.decline command}}
                @roomId={{@roomId}}
                @isPending={{@isPending}}
                @isCompact={{this.isCompactTool command}}
                @monacoSDK={{@monacoSDK}}
                @isError={{bool this.errorMessage}}
                @isStreaming={{@isStreaming}}
                @isSuperseded={{this.isRetriedLater command}}
                @foldCount={{@foldCount}}
              />
            {{/let}}
          {{/if}}
        {{/each}}
      </AiAssistantMessage>
    {{/if}}
  </template>

  @service declare toolService: ToolService;
  @service declare matrixService: MatrixService;

  knownErrorMessagePrefixes: { [errorMessagePrefix: string]: string }[] = [
    {
      'MatrixError: [413] event too large':
        'Response from the AI assistant was too large to process',
    },
  ];

  @cached
  private get errorMessage() {
    if (this.message.errorMessage) {
      let humanFriendlyErrorMessage = null;
      for (let errorMessagePrefix of this.knownErrorMessagePrefixes) {
        let key = Object.keys(errorMessagePrefix)[0];
        if (this.message.errorMessage.startsWith(key)) {
          humanFriendlyErrorMessage = errorMessagePrefix[key];
        }
      }
      return humanFriendlyErrorMessage || this.message.errorMessage;
    }
    if (this.streamingTimeout) {
      return `This message has been processing for a long time (more than ${STREAMING_TIMEOUT_MINUTES} minutes), possibly due to a delay in response time, or due to a system error.`; // Will show a "Wait longer" and "Retry" button
    }
    return undefined;
  }
}
