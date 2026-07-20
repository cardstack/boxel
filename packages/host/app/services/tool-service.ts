import { getOwner, setOwner } from '@ember/owner';
import type Owner from '@ember/owner';

import { debounce, schedule } from '@ember/runloop';
import Service, { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';

import Ajv from 'ajv';

import { task, timeout, all } from 'ember-concurrency';

import { TrackedSet } from 'tracked-built-ins';
import { v4 as uuidv4 } from 'uuid';

import type { Command, ToolContext } from '@cardstack/runtime-common';
import {
  Deferred,
  ToolContextStamp,
  delay,
  getClass,
  identifyCard,
  rri,
  type PatchData,
} from '@cardstack/runtime-common';

import { AI_BOT_EXECUTOR } from '@cardstack/runtime-common/commands';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';
import { getToolRequests } from '@cardstack/runtime-common/matrix-constants';

import type MatrixService from '@cardstack/host/services/matrix-service';
import type Realm from '@cardstack/host/services/realm';
import CheckCorrectnessTool from '@cardstack/host/tools/check-correctness';
import PatchCodeTool from '@cardstack/host/tools/patch-code';

import LimitedSet from '../lib/limited-set';
import {
  CHECK_CORRECTNESS_COMMAND_NAME,
  isAutoExecutableTool,
} from '../lib/tool-auto-execute';

import type LoaderService from './loader-service';
import type MessageService from './message-service';
import type OperatorModeStateService from './operator-mode-state-service';
import type RealmServerService from './realm-server';
import type SessionService from './session';
import type StoreService from './store';
import type { CodeData } from '../lib/formatted-message/utils';
import type MessageCodePatchResult from '../lib/matrix-classes/message-code-patch-result';
import type MessageTool from '../lib/matrix-classes/message-tool';
import type { RoomResource } from '../resources/room';
import type { CardDef } from '@cardstack/base/card-api';
import type { CodePatchStatus } from '@cardstack/base/matrix-event';
import type { IEvent } from 'matrix-js-sdk';

const DELAY_FOR_APPLYING_UI = isTesting() ? 50 : 500;
// How long drainToolProcessingQueue and drainCodePatchProcessingQueue wait
// for a room resource that's still processing before giving up on the event.
// In tests we shorten this so the stuck-timeout invalidation path can be
// exercised in a single test without holding a real test open for a minute.
const STUCK_PROCESSING_TIMEOUT_MS = isTesting() ? 1000 : 60_000;
// How many times drainToolProcessingQueue requeues an event whose finalized
// content the room resource hasn't folded into its Message yet, before
// giving up and validating whatever state is there (guaranteeing a terminal
// result either way). Requeues are ~100ms apart (the drain debounce), so
// this allows well over the normal sub-second catch-up.
const MAX_TOOL_FINALIZATION_RETRIES = isTesting() ? 10 : 100;

type GenericCommand = Command<
  typeof CardDef | undefined,
  typeof CardDef | undefined
>;

const toolProcessingWaiter = buildWaiter('tool-service:command-processing');

export default class ToolService extends Service {
  @service declare private loaderService: LoaderService;
  @service declare private matrixService: MatrixService;
  @service declare private messageService: MessageService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private realm: Realm;
  @service declare private realmServer: RealmServerService;
  @service declare private session: SessionService;
  @service declare private store: StoreService;
  currentlyExecutingToolRequestIds = new TrackedSet<string>();
  executedToolRequestIds = new TrackedSet<string>();
  // Requests the auto-execution flow has resolved 'invalid'. An invalid
  // result is terminal for auto-execution: without this record, a later
  // drain pass can re-validate the same request against updated room state,
  // execute it, and post a contradictory 'applied' result — and the model,
  // having already seen 'invalid', re-issues the call, so the command runs
  // twice. Local (not derived from room events) because the result event
  // round-trip is slower than consecutive drain passes. The user's manual
  // "Try Anyway" path doesn't consult this — it goes straight to `run`.
  invalidatedToolRequestIds = new TrackedSet<string>();
  acceptingAllRoomIds = new TrackedSet<string>();
  private aiAssistantClientRequestIdsByRoom = new Map<
    string,
    LimitedSet<string>
  >();
  private aiAssistantInvalidations = new Map<
    string,
    {
      clientRequestId: string;
      roomId: string;
      targetHref: string;
      deferred: Deferred<void>;
    }
  >();
  private aiAssistantInvalidationWaiters = new Map<
    string,
    { unsubscribe: () => void; timeoutId: ReturnType<typeof setTimeout> }
  >();
  private toolProcessingEventQueue: string[] = [];
  // How many times each queued event has been requeued waiting for the room
  // resource to fold the event's finalized content into its Message.
  private toolFinalizationRetries = new Map<string, number>();
  private codePatchProcessingEventQueue: string[] = [];
  private flushToolProcessingQueue: Promise<void> | undefined;
  private flushCodePatchProcessingQueue: Promise<void> | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    this.currentlyExecutingToolRequestIds.clear();
    this.executedToolRequestIds.clear();
    this.invalidatedToolRequestIds.clear();
    this.acceptingAllRoomIds.clear();
    this.aiAssistantClientRequestIdsByRoom.clear();
    for (let invalidation of this.aiAssistantInvalidations.values()) {
      invalidation.deferred.fulfill();
    }
    this.aiAssistantInvalidations.clear();
    for (let key of this.aiAssistantInvalidationWaiters.keys()) {
      this.cleanupInvalidationWaiter(key);
    }
    this.toolProcessingEventQueue = [];
    this.toolFinalizationRetries.clear();
    this.codePatchProcessingEventQueue = [];
    this.flushToolProcessingQueue = undefined;
    this.flushCodePatchProcessingQueue = undefined;
  }

  registerAiAssistantClientRequestId(action: string, roomId: string): string {
    let encodedRoom = encodeURIComponent(roomId);
    let clientRequestId = `bot-patch:${encodedRoom}:${action}:${uuidv4()}`;

    let roomSet = this.aiAssistantClientRequestIdsByRoom.get(roomId!);
    if (!roomSet) {
      roomSet = new LimitedSet<string>(250);
      this.aiAssistantClientRequestIdsByRoom.set(roomId!, roomSet);
    }
    roomSet.add(clientRequestId);

    return clientRequestId;
  }

  trackAiAssistantCardRequest({
    action,
    roomId,
    fileUrl,
  }: {
    action: string;
    roomId: string;
    fileUrl: string;
  }): string | undefined {
    if (!action || !roomId || !fileUrl) {
      return;
    }
    let clientRequestId = this.registerAiAssistantClientRequestId(
      action,
      roomId,
    );
    // We only track invalidations for card instances and card definitions
    if (!fileUrl.endsWith('.gts') && !fileUrl.endsWith('.json')) {
      return clientRequestId;
    }
    let normalizedTarget = fileUrl.endsWith('.json')
      ? fileUrl.replace(/\.json$/, '')
      : fileUrl;
    let key = `${roomId}::${normalizedTarget}`;

    let realmURL: string | undefined;
    try {
      realmURL = this.realm.realmOf(rri(fileUrl)) ?? undefined;
    } catch (_e) {
      return clientRequestId;
    }
    if (!realmURL) {
      return clientRequestId;
    }

    let deferred = new Deferred<void>();
    this.aiAssistantInvalidations.get(key)?.deferred.fulfill();
    this.cleanupInvalidationWaiter(key);
    this.aiAssistantInvalidations.set(key, {
      clientRequestId,
      roomId,
      targetHref: normalizedTarget,
      deferred,
    });

    let unsubscribe = this.messageService.subscribe(realmURL, (event) => {
      if (
        !(
          event &&
          event.eventName === 'index' &&
          event.indexType === 'incremental' &&
          event.clientRequestId === clientRequestId
        )
      ) {
        return;
      }
      this.cleanupInvalidationWaiter(key);
      let current = this.aiAssistantInvalidations.get(key);
      current?.deferred.fulfill();
    });
    let timeoutId = setTimeout(
      () => {
        this.cleanupInvalidationWaiter(key);
        let current = this.aiAssistantInvalidations.get(key);
        current?.deferred.fulfill();
        this.aiAssistantInvalidations.delete(key);
      },
      5 * 60 * 1000,
    );
    this.aiAssistantInvalidationWaiters.set(key, {
      unsubscribe,
      timeoutId,
    });
    return clientRequestId;
  }

  private cleanupInvalidationWaiter(key: string) {
    let waiter = this.aiAssistantInvalidationWaiters.get(key);
    if (!waiter) {
      return;
    }
    waiter.unsubscribe();
    clearTimeout(waiter.timeoutId);
    this.aiAssistantInvalidationWaiters.delete(key);
  }

  async waitForInvalidationAfterAIAssistantRequest(
    roomId: string,
    targetHref: string,
    timeoutMs?: number,
  ): Promise<void> {
    if (!roomId || !targetHref) {
      return;
    }
    let normalizedTarget = targetHref.endsWith('.json')
      ? targetHref.replace(/\.json$/, '')
      : targetHref;
    let key = `${roomId}::${normalizedTarget}`;
    let existing = this.aiAssistantInvalidations.get(key);
    if (!existing) {
      return;
    }

    let waitPromise: Promise<void> = existing.deferred.promise;
    if (timeoutMs) {
      waitPromise = Promise.race([
        waitPromise,
        delay(timeoutMs).then(() => {}),
      ]);
    }
    await waitPromise;
    this.aiAssistantInvalidations.delete(key);
  }

  public queueEventForToolProcessing(event: Partial<IEvent>) {
    let eventId = event.event_id;
    if (event.content?.['m.relates_to']?.rel_type === 'm.replace') {
      eventId = event.content?.['m.relates_to']!.event_id;
    }
    if (!eventId) {
      throw new Error(
        'No event id found for event with commands, this should not happen',
      );
    }
    let roomId = event.room_id;
    if (!roomId) {
      throw new Error(
        'No room id found for event with commands, this should not happen',
      );
    }
    let compoundKey = `${roomId}|${eventId}`;
    if (this.toolProcessingEventQueue.includes(compoundKey)) {
      return;
    }

    this.toolProcessingEventQueue.push(compoundKey);

    debounce(this, this.drainToolProcessingQueue, 100);
  }

  public queueEventForCodePatchProcessing(event: Partial<IEvent>) {
    let eventId = event.event_id;
    if (event.content?.['m.relates_to']?.rel_type === 'm.replace') {
      eventId = event.content?.['m.relates_to']!.event_id;
    }
    if (!eventId) {
      throw new Error(
        'No event id found for event with code patches, this should not happen',
      );
    }
    let roomId = event.room_id;
    if (!roomId) {
      throw new Error(
        'No room id found for event with code patches, this should not happen',
      );
    }
    let compoundKey = `${roomId}|${eventId}`;
    if (this.codePatchProcessingEventQueue.includes(compoundKey)) {
      return;
    }

    this.codePatchProcessingEventQueue.push(compoundKey);

    debounce(this, this.drainCodePatchProcessingQueue, 100);
  }

  private async drainToolProcessingQueue() {
    let waiterToken = toolProcessingWaiter.beginAsync();
    try {
      await this.flushToolProcessingQueue;

      let finishedProcessingTools: () => void;
      this.flushToolProcessingQueue = new Promise(
        (res) => (finishedProcessingTools = res),
      );

      let toolSpecs = [...this.toolProcessingEventQueue];
      this.toolProcessingEventQueue = [];

      while (toolSpecs.length > 0) {
        let [roomId, eventId] = toolSpecs.shift()!.split('|');

        let roomResource = this.matrixService.roomResources.get(roomId!);
        if (!roomResource) {
          throw new Error(
            `Room resource not found for room id ${roomId}, this should not happen`,
          );
        }
        let timeout = Date.now() + STUCK_PROCESSING_TIMEOUT_MS; // reset the timer to avoid a long wait if the room resource is processing
        let currentRoomProcessingTimestamp =
          roomResource.processingLastStartedAt;
        while (
          roomResource.isProcessing &&
          currentRoomProcessingTimestamp ===
            roomResource.processingLastStartedAt &&
          Date.now() < timeout
        ) {
          // wait for the room resource to finish processing
          await delay(100);
        }
        if (
          roomResource.isProcessing &&
          currentRoomProcessingTimestamp ===
            roomResource.processingLastStartedAt
        ) {
          // Room processing is wedged. The synthetic 'applying' state in
          // room-message-tool.gts shows the spinner the moment an
          // auto-executable command lands and only clears when we dispatch
          // a terminal commandResult ('applied' or 'invalid'). If we just
          // logged and continued, the spinner would hang indefinitely with
          // no manual Run fallback. Mark each auto-executable command on
          // this message invalid so the UI falls through to the
          // invalidToolCallState "Try Anyway" branch; manual-approval
          // commands are left in 'ready' so the action bar's Run button
          // remains the user's fallback.
          console.error(
            `Room resource for room ${roomId} seems to be stuck processing, invalidating auto-executable commands on event ${eventId}`,
          );
          await this.invalidateAutoExecutableToolsForStuckProcessing(
            roomResource,
            roomId!,
            eventId!,
          );
          continue;
        }

        let message = roomResource.messages.find((m) => m.eventId === eventId);
        // Events are only queued once their content is finalized
        // (isStreamingFinished), but the room resource folds that content
        // into its Message asynchronously — at drain time the Message may
        // not exist yet, or may still hold a streaming snapshot whose tool
        // arguments are partial or unparsed. Validating that snapshot posts
        // a spurious 'invalid' result for a request that is actually fine
        // (CS-12103). Requeue until the Message reports the finalized state;
        // bounded so a message that never catches up still falls through
        // and resolves with a real (terminal) validation result.
        if (
          !message ||
          (!message.isStreamingOfEventFinished && !message.isCanceled)
        ) {
          let compoundKey = `${roomId}|${eventId}`;
          let retries = this.toolFinalizationRetries.get(compoundKey) ?? 0;
          if (retries < MAX_TOOL_FINALIZATION_RETRIES) {
            this.toolFinalizationRetries.set(compoundKey, retries + 1);
            if (!this.toolProcessingEventQueue.includes(compoundKey)) {
              this.toolProcessingEventQueue.push(compoundKey);
            }
            debounce(this, this.drainToolProcessingQueue, 100);
            continue;
          }
          this.toolFinalizationRetries.delete(compoundKey);
          if (!message) {
            // Nothing addressable to validate or invalidate.
            console.error(
              `Tool processing gave up waiting for message ${eventId} in room ${roomId} to appear in the room resource`,
            );
            continue;
          }
        } else {
          this.toolFinalizationRetries.delete(`${roomId}|${eventId}`);
        }
        if (message.agentId !== this.matrixService.agentId) {
          // This command was sent by another agent, so we will not auto-execute it
          continue;
        }

        // Collect all ready commands for this message
        let readyTools: any[] = [];
        for (let messageTool of message.tools) {
          // ai-bot ran this one itself (e.g. readRealmFile). The host neither
          // validates nor runs it — it has no command class to resolve, and the
          // bot posts its own result. Must come before validate(), which would
          // otherwise mark it "No command found".
          if (messageTool.executedBy === AI_BOT_EXECUTOR) {
            continue;
          }
          if (this.currentlyExecutingToolRequestIds.has(messageTool.id!)) {
            continue;
          }
          if (this.executedToolRequestIds.has(messageTool.id!)) {
            continue;
          }
          // The status check below covers this too, but only once the
          // invalid result event has round-tripped into the room resource;
          // this local record closes the window in between.
          if (this.invalidatedToolRequestIds.has(messageTool.id!)) {
            continue;
          }
          if (
            messageTool.status === 'applied' ||
            messageTool.status === 'invalid'
          ) {
            continue;
          }
          if (!messageTool.name) {
            continue;
          }

          let isValid = await this.validate(messageTool);
          if (!isValid) {
            continue;
          }

          let activeModeAtMessageTime = roomResource.getActiveLLMModeForMessage(
            message.eventId,
          );

          // The outer `message.agentId !== this.matrixService.agentId`
          // gate above already short-circuited the not-our-agent case, so
          // every command reaching this point is owned by the current
          // agent.
          if (
            isAutoExecutableTool(messageTool, activeModeAtMessageTime, true)
          ) {
            readyTools.push(messageTool);
          }
        }

        // Execute ready commands, tracking accept-all state if multiple commands
        if (readyTools.length > 0) {
          // This is an "accept all" operation - multiple commands ready for execution
          this.acceptingAllRoomIds.add(roomId!);
          try {
            for (let command of readyTools) {
              this.run.perform(command);
            }
          } finally {
            this.acceptingAllRoomIds.delete(roomId!);
          }
        }
      }
      finishedProcessingTools!();
    } finally {
      toolProcessingWaiter.endAsync(waiterToken);
    }
  }

  private async invalidateAutoExecutableToolsForStuckProcessing(
    roomResource: RoomResource,
    roomId: string,
    eventId: string,
  ) {
    let message = roomResource.messages.find((m) => m.eventId === eventId);
    if (!message) {
      return;
    }
    if (message.agentId !== this.matrixService.agentId) {
      return;
    }
    let activeModeAtMessageTime = roomResource.getActiveLLMModeForMessage(
      message.eventId,
    );
    for (let messageTool of message.tools) {
      // ai-bot ran this one itself (e.g. readRealmFile): not the host's to run,
      // so not the host's to invalidate when processing wedges.
      if (messageTool.executedBy === AI_BOT_EXECUTOR) {
        continue;
      }
      let commandRequestId = messageTool.toolRequest.id;
      // Without a tool call id we can't address a command result event, so
      // there's nothing to invalidate.
      if (!commandRequestId) {
        continue;
      }
      if (this.currentlyExecutingToolRequestIds.has(commandRequestId)) {
        continue;
      }
      if (this.executedToolRequestIds.has(commandRequestId)) {
        continue;
      }
      if (this.invalidatedToolRequestIds.has(commandRequestId)) {
        continue;
      }
      if (
        messageTool.status === 'applied' ||
        messageTool.status === 'invalid'
      ) {
        continue;
      }
      if (!messageTool.name) {
        continue;
      }
      // The outer agentId gate already verified ownership, so this command
      // is owned by the current agent.
      if (!isAutoExecutableTool(messageTool, activeModeAtMessageTime, true)) {
        // Manual-approval commands stay 'ready' — the action bar's Run
        // button is still the user's fallback for those.
        continue;
      }
      // Terminal for auto-execution: a later drain pass must not execute a
      // request the model has been told was not started.
      this.invalidatedToolRequestIds.add(commandRequestId);
      let invokedToolFromEventId =
        this.getCurrentEventIdForCommandRequest(roomId, commandRequestId) ??
        messageTool.eventId;
      await this.matrixService.sendToolResultEvent({
        roomId,
        invokedToolFromEventId,
        toolCallId: commandRequestId,
        status: 'invalid',
        failureReason: `Room processing did not finish within ${Math.round(
          STUCK_PROCESSING_TIMEOUT_MS / 1000,
        )}s; command was not started`,
        context: await this.operatorModeStateService.getSummaryForAIBot(),
      });
    }
  }

  private async drainCodePatchProcessingQueue() {
    let waiterToken = toolProcessingWaiter.beginAsync();
    try {
      await this.flushCodePatchProcessingQueue;

      let finishedProcessingCodePatches: () => void;
      this.flushCodePatchProcessingQueue = new Promise(
        (res) => (finishedProcessingCodePatches = res),
      );

      let codePatchSpecs = [...this.codePatchProcessingEventQueue];
      this.codePatchProcessingEventQueue = [];

      while (codePatchSpecs.length > 0) {
        let [roomId, eventId] = codePatchSpecs.shift()!.split('|');

        let roomResource = this.matrixService.roomResources.get(roomId!);
        if (!roomResource) {
          throw new Error(
            `Room resource not found for room id ${roomId}, this should not happen`,
          );
        }
        let timeout = Date.now() + STUCK_PROCESSING_TIMEOUT_MS; // reset the timer to avoid a long wait if the room resource is processing
        let currentRoomProcessingTimestamp =
          roomResource.processingLastStartedAt;
        while (
          roomResource.isProcessing &&
          currentRoomProcessingTimestamp ===
            roomResource.processingLastStartedAt &&
          Date.now() < timeout
        ) {
          // wait for the room resource to finish processing
          await delay(100);
        }
        if (
          roomResource.isProcessing &&
          currentRoomProcessingTimestamp ===
            roomResource.processingLastStartedAt
        ) {
          // room seems to be stuck processing, so we will log and skip this event
          console.error(
            `Room resource for room ${roomId} seems to be stuck processing, skipping code patch event ${eventId}`,
          );
          continue;
        }
        let message = roomResource.messages.find((m) => m.eventId === eventId);
        if (!message) {
          // The event was queued for auto-apply but its message isn't in the
          // room timeline yet — room processing lagged or dropped it. The event
          // is consumed here and never retried, so a patch that should
          // auto-apply silently won't. Log enough to recognize that race.
          if (isTesting()) {
            console.log(
              `[code-patch-autoapply] event ${eventId} queued but no matching message in room ${roomId}; isProcessing=${roomResource.isProcessing}, messageCount=${roomResource.messages.length}`,
            );
          }
          continue;
        }
        if (message.agentId !== this.matrixService.agentId) {
          // This code patch was sent by another agent, so we will not auto-execute it
          continue;
        }

        // Get the LLM mode that was active when this message was created
        let activeModeAtMessageTime = roomResource.getActiveLLMModeForMessage(
          message.eventId,
        );
        // Only auto-apply if in 'act' mode
        if (activeModeAtMessageTime !== 'act') {
          let llmModeEvents = roomResource.llmModeEvents;
          if (
            isTesting() &&
            llmModeEvents.some((e) => (e as any).content?.mode === 'act')
          ) {
            // The room has used 'act' mode, so a non-'act' resolution here is
            // worth recording: it pins the message against every mode
            // transition — the data needed to explain an auto-apply that
            // didn't fire.
            console.log(
              `[code-patch-autoapply] event ${eventId} resolved to LLM mode "${activeModeAtMessageTime}" at message timestamp ${message.created.getTime()}; mode transitions: ${JSON.stringify(
                llmModeEvents.map((e) => ({
                  ts: e.origin_server_ts,
                  mode: (e as any).content?.mode,
                })),
              )}`,
            );
          }
          continue;
        }

        // Auto-apply all ready code patches from this message
        if (message.htmlParts) {
          let readyCodePatches = this.getReadyCodePatches(message.htmlParts);
          let uniqueFiles = new Set(
            readyCodePatches.map((patch) => patch.fileUrl),
          );

          if (readyCodePatches.length > 0 || uniqueFiles.size > 0) {
            // This is an "accept all" operation - multiple patches OR patches across multiple files
            this.acceptingAllRoomIds.add(roomId!);
            try {
              await this.executeReadyCodePatches(roomId!, message.htmlParts);
            } finally {
              this.acceptingAllRoomIds.delete(roomId!);
            }
          }
        }
      }
      finishedProcessingCodePatches!();
    } finally {
      toolProcessingWaiter.endAsync(waiterToken);
    }
  }

  // Pre-rename spelling of `toolContext`: realm content constructs tools with
  // `getService('tool-service').commandContext` (and via the command-service
  // registration alias). Stays until no deployed content references it.
  get commandContext(): ToolContext {
    return this.toolContext;
  }

  get toolContext(): ToolContext {
    let result = {
      [ToolContextStamp]: true,
    };
    setOwner(result, getOwner(this)!);

    return result;
  }

  // CS-11045: Find the bot message in current room state that currently owns
  // the given commandRequestId. Walks events newest-first so the latest event
  // wins (handles the streaming → m.replace shape: the original streaming
  // event and later replace events both carry the toolRequests array; the
  // latest replace is the one ai-bot's /messages view agrees on).
  private getCurrentEventIdForCommandRequest(
    roomId: string | undefined,
    commandRequestId: string | undefined,
  ): string | undefined {
    if (!roomId || !commandRequestId) {
      return undefined;
    }
    let roomResource = this.matrixService.roomResources.get(roomId);
    if (!roomResource) {
      return undefined;
    }
    let events = roomResource.events;
    for (let i = events.length - 1; i >= 0; i--) {
      let e = events[i] as any;
      if (e?.type !== 'm.room.message') {
        continue;
      }
      let requests = getToolRequests(e.content);
      if (
        Array.isArray(requests) &&
        requests.some((r: any) => r?.id === commandRequestId)
      ) {
        return e.event_id;
      }
    }
    return undefined;
  }

  //TODO: Convert to non-EC async method after fixing CS-6987
  run = task(async (command: MessageTool) => {
    // ai-bot ran this one itself (e.g. readRealmFile): nothing for the host to
    // run. Guards the manual "Try Anyway" path as well as any auto-execution.
    if (command.executedBy === AI_BOT_EXECUTOR) {
      return;
    }
    let { arguments: payload, id: commandRequestId } = command;
    // CS-11045: Source the bot-message event_id from current room state at
    // execute time rather than the snapshot taken when the MessageTool was
    // constructed. The snapshot is the streaming/original event_id; once a
    // later m.replace event in room.events owns the toolRequest, that
    // event's id is the canonical link the rest of the system (including
    // ai-bot's view of /messages) will agree on. Fall back to the snapshot if
    // no matching event is found in current room state.
    let eventId =
      this.getCurrentEventIdForCommandRequest(
        command.message.roomId,
        commandRequestId,
      ) ?? command.eventId;
    let resultCard: CardDef | undefined;
    // There may be some race conditions where the command is already being executed when this task starts
    if (
      this.currentlyExecutingToolRequestIds.has(commandRequestId!) ||
      this.executedToolRequestIds.has(commandRequestId!)
    ) {
      return; // already executing this command
    }
    try {
      this.matrixService.failedToolState.delete(commandRequestId!);
      this.currentlyExecutingToolRequestIds.add(commandRequestId!);

      let toolToRun;

      // If we don't find it in the one-offs, start searching for
      // one in the skills we can construct
      let toolCodeRef = command.codeRef;
      if (toolCodeRef) {
        let ToolConstructor = (await getClass(
          toolCodeRef,
          this.loaderService.loader,
        )) as { new (context: ToolContext): Command<any, any> };
        toolToRun = new ToolConstructor(this.toolContext);
      }

      if (!toolToRun && command.name === CHECK_CORRECTNESS_COMMAND_NAME) {
        toolToRun = new CheckCorrectnessTool(this.toolContext);
      }

      if (toolToRun) {
        let typedInput = await this.instantiateToolInput(
          toolToRun,
          payload?.attributes,
          payload?.relationships,
        );

        [resultCard] = await all([
          await toolToRun.execute(typedInput as any),
          await timeout(DELAY_FOR_APPLYING_UI), // leave a beat for the "applying" state of the UI to be shown
        ]);
      } else if (command.name === 'patchCardInstance') {
        if (!hasPatchData(payload)) {
          throw new Error(
            "Patch command can't run because it doesn't have all the fields in arguments returned by open ai",
          );
        }
        let cardId = payload.attributes.cardId;

        let clientRequestId = this.trackAiAssistantCardRequest({
          action: 'patch-instance',
          roomId: command.message.roomId,
          fileUrl: `${cardId}.json`,
        });

        await this.store.patch(
          cardId,
          {
            attributes: payload?.attributes?.patch?.attributes,
            relationships: payload?.attributes?.patch?.relationships,
          },
          { doNotWaitForPersist: true, clientRequestId },
        );
      } else {
        // Unrecognized tool. This can happen if a programmatically-provided
        // tool is no longer available due to a browser refresh.
        throw new Error(
          `Unrecognized tool: ${command.name}. This tool may have been associated with a previous browser session.`,
        );
      }
      this.executedToolRequestIds.add(commandRequestId!);
      await this.matrixService.updateSkillsAndToolsIfNeeded(
        command.message.roomId,
      );
      let userContextForAiBot =
        await this.operatorModeStateService.getSummaryForAIBot();

      await this.matrixService.sendToolResultEvent({
        roomId: command.message.roomId,
        invokedToolFromEventId: eventId,
        toolCallId: commandRequestId!,
        status: 'applied',
        resultCard,
        context: userContextForAiBot,
      });
    } catch (e) {
      let error =
        typeof e === 'string'
          ? new Error(e)
          : e instanceof Error
            ? e
            : new Error('Tool call failed.');
      console.error(error);
      await timeout(DELAY_FOR_APPLYING_UI); // leave a beat for the "applying" state of the UI to be shown
      this.matrixService.failedToolState.set(commandRequestId!, error);
    } finally {
      this.currentlyExecutingToolRequestIds.delete(commandRequestId!);
    }
  });

  async validate(command: MessageTool): Promise<boolean> {
    let error: string | undefined;
    // ai-bot ran this one itself (e.g. readRealmFile): the host has no command
    // class to resolve, and never runs it, so there is nothing to validate.
    if (command.executedBy === AI_BOT_EXECUTOR) {
      return false;
    }
    if (!command.name) {
      console.warn(
        `Command with id ${command.id} has no name, skipping validation`,
      );
      return false;
    }

    if (command.name === 'patchCardInstance') {
      // special case for patchCardInstance command
      return true;
    }

    let toolCodeRef = command.codeRef;
    let toolInstance: GenericCommand | undefined;

    if (command.name === CHECK_CORRECTNESS_COMMAND_NAME) {
      toolInstance = new CheckCorrectnessTool(this.toolContext);
    } else if (!toolCodeRef) {
      error = `No command for the name "${command.name}" was found`;
    } else {
      let ToolConstructor = (await getClass(
        toolCodeRef,
        this.loaderService.loader,
      )) as { new (context: ToolContext): Command<any, any> };
      if (!ToolConstructor) {
        error = `No command for the name "${command.name}" was found`;
      } else {
        toolInstance = new ToolConstructor(this.toolContext);
      }
    }

    if (toolInstance && !error) {
      let loader = (
        getOwner(this.toolContext)!.lookup(
          'service:loader-service',
        ) as LoaderService
      ).loader;
      let mappings = await basicMappings(loader);
      let jsonSchema = {
        type: 'object',
        properties: {
          description: {
            type: 'string',
          },
          ...(await toolInstance.getInputJsonSchema(
            this.matrixService.cardAPI,
            mappings,
          )),
        },
        required: ['attributes', 'description'],
        additionalProperties: false,
      };
      const ajv = new Ajv();
      const valid = ajv.validate(jsonSchema, command.arguments);
      if (!valid) {
        error = `Command "${command.name}" validation failed: ${ajv.errorsText()}`;
      }
    }
    if (error) {
      // An invalid result is terminal for auto-execution: record it before
      // publishing so no concurrent drain pass re-validates and executes
      // this request after the model has been told it failed. (The user can
      // still run it manually — "Try Anyway" bypasses the drain.)
      if (command.toolRequest.id) {
        this.invalidatedToolRequestIds.add(command.toolRequest.id);
      }
      // CS-11045: Same canonical-event-id resolution as the run task — emit
      // the invalid commandResult linked to the bot-message event currently
      // owning the toolRequest in room state, so ai-bot's /messages view
      // and the host's own m.replace-aware bookkeeping agree on the linkage.
      let invokedToolFromEventId =
        this.getCurrentEventIdForCommandRequest(
          command.message.roomId,
          command.toolRequest.id,
        ) ?? command.eventId;
      await this.matrixService.sendToolResultEvent({
        roomId: command.message.roomId,
        invokedToolFromEventId,
        toolCallId: command.toolRequest.id!,
        status: 'invalid',
        failureReason: error,
        context: await this.operatorModeStateService.getSummaryForAIBot(),
      });
      return false;
    }

    return true;
  }

  // Construct a new instance of the input type with the
  // The input is undefined if the command has no input type
  private async instantiateToolInput(
    command: GenericCommand,
    attributes: Record<string, any> | undefined,
    relationships: Record<string, any> | undefined,
  ) {
    // Get the input type and validate/construct the payload
    let typedInput;
    let InputType = await command.getInputType();
    if (InputType) {
      let adoptsFrom = identifyCard(InputType);
      if (adoptsFrom) {
        let inputDoc = {
          type: 'card',
          data: {
            meta: {
              adoptsFrom,
            },
            attributes: attributes ?? {},
            relationships: relationships ?? {},
          },
        };
        typedInput = await this.store.add(inputDoc, { doNotPersist: true });
      } else {
        // identifyCard can fail in some circumstances where the input type is not exported
        // in that case, we'll fall back to this less reliable method of constructing the input type
        typedInput = new InputType({ ...attributes, ...relationships });
      }
    } else {
      typedInput = undefined;
    }
    return typedInput;
  }

  patchCode = async (
    roomId: string,
    fileUrl: string | null,
    codeDataItems: {
      searchReplaceBlock?: string | null;
      eventId: string;
      codeBlockIndex: number;
    }[],
  ) => {
    if (!fileUrl) {
      throw new Error('File URL is required to patch code');
    }
    for (const codeData of codeDataItems) {
      this.currentlyExecutingToolRequestIds.add(
        `${codeData.eventId}:${codeData.codeBlockIndex}`,
      );
    }
    // Give Glimmer one render turn to reflect the "applying" state before we
    // start mutating files and emitting result events.
    await new Promise<void>((resolve) => schedule('afterRender', resolve));
    let finalFileIdentifier: string | undefined;

    try {
      let patchCodeCommand = new PatchCodeTool(this.toolContext);

      let patchCodeResult = await patchCodeCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: codeDataItems.map(
          (codeData) => codeData.searchReplaceBlock!,
        ),
        roomId,
      });
      finalFileIdentifier = patchCodeResult.finalFileIdentifier;

      for (let i = 0; i < codeDataItems.length; i++) {
        const codeData = codeDataItems[i];
        const patchResult = patchCodeResult.results[i];
        if (patchResult.status === 'applied') {
          this.executedToolRequestIds.add(
            `${codeData.eventId}:${codeData.codeBlockIndex}`,
          );
        } else if (isTesting() && this.acceptingAllRoomIds.has(roomId)) {
          // During an auto-apply / accept-all run a non-'applied' result means
          // the patch never reaches the "applied" UI state a caller may be
          // waiting on. Record why (e.g. a search block that no longer matches
          // because a prior chained patch hadn't landed yet).
          console.log(
            `[code-patch-autoapply] patch ${codeData.eventId}:${codeData.codeBlockIndex} on ${fileUrl} did not apply (status=${patchResult.status}${
              patchResult.failureReason
                ? `, reason=${patchResult.failureReason}`
                : ''
            })`,
          );
        }
      }

      await this.matrixService.updateSkillsAndToolsIfNeeded(roomId);
      let fileDef = this.matrixService.fileAPI.createFileDef({
        sourceUrl: finalFileIdentifier ?? fileUrl,
        name: fileUrl.split('/').pop(),
      });

      let context = await this.operatorModeStateService.getSummaryForAIBot();

      let resultSends: Promise<unknown>[] = [];
      for (let i = 0; i < codeDataItems.length; i++) {
        const codeData = codeDataItems[i];
        const result = patchCodeResult.results[i];
        resultSends.push(
          this.matrixService.sendCodePatchResultEvent(
            roomId,
            codeData.eventId,
            codeData.codeBlockIndex,
            result.status as CodePatchStatus,
            [],
            [fileDef],
            context,
            patchCodeResult.lintIssues,
            result.failureReason,
          ),
        );
      }
      await Promise.all(resultSends);
    } finally {
      // remove the code blocks from the currently executing command request ids
      for (const codeData of codeDataItems) {
        this.currentlyExecutingToolRequestIds.delete(
          `${codeData.eventId}:${codeData.codeBlockIndex}`,
        );
      }
    }
  };

  getReadyCodePatches = (
    htmlParts: Array<{ codeData: CodeData | null }>,
  ): CodeData[] => {
    let result: CodeData[] = [];
    for (let i = 0; i < htmlParts.length; i++) {
      let htmlPart = htmlParts[i];
      let codeData = htmlPart.codeData;
      if (!codeData || !codeData.searchReplaceBlock) continue;
      let status = this.getCodePatchStatus(codeData);
      if (status && status === 'ready') {
        result.push(codeData);
      }
    }
    return result;
  };

  executeReadyCodePatches = async (
    roomId: string,
    htmlParts: Array<{ codeData: CodeData | null }>,
  ) => {
    let readyCodePatches = this.getReadyCodePatches(htmlParts);

    // Group code patches by fileUrl and apply them
    let grouped: Record<string, CodeData[]> = {};
    for (let codeData of readyCodePatches) {
      if (!codeData.fileUrl) continue;
      if (!grouped[codeData.fileUrl]) grouped[codeData.fileUrl] = [];
      grouped[codeData.fileUrl].push(codeData);
    }

    for (let [fileUrl, codeDataItems] of Object.entries(grouped)) {
      let patchItems = codeDataItems.map((codeData) => ({
        searchReplaceBlock: codeData.searchReplaceBlock,
        eventId: codeData.eventId,
        codeBlockIndex: codeData.codeBlockIndex,
      }));
      await this.patchCode(roomId, fileUrl, patchItems);
    }
  };

  private isCodeBlockApplying(codeData: {
    eventId: string;
    codeBlockIndex: number;
  }) {
    return this.currentlyExecutingToolRequestIds.has(
      `${codeData.eventId}:${codeData.codeBlockIndex}`,
    );
  }

  private isCodeBlockRecentlyApplied(codeBlock: {
    eventId: string;
    codeBlockIndex: number;
  }) {
    return this.executedToolRequestIds.has(
      `${codeBlock.eventId}:${codeBlock.codeBlockIndex}`,
    );
  }

  getCodePatchStatus = (codeData: {
    roomId: string;
    eventId: string;
    codeBlockIndex: number;
  }): CodePatchStatus | 'applying' | 'ready' => {
    if (this.isCodeBlockApplying(codeData)) {
      return 'applying';
    }
    if (this.isCodeBlockRecentlyApplied(codeData)) {
      return 'applied';
    }
    return this.getCodePatchResult(codeData)?.status ?? 'ready';
  };

  getCodePatchResult = (codeData: {
    roomId: string;
    eventId: string;
    codeBlockIndex: number;
  }): MessageCodePatchResult | undefined => {
    let roomResource = this.matrixService.roomResources.get(codeData.roomId);
    if (!roomResource) {
      return undefined;
    }
    let message = roomResource.messages.find(
      (m) => m.eventId === codeData.eventId,
    );
    return message?.codePatchResults?.find(
      (c) => c.index === codeData.codeBlockIndex,
    );
  };

  isPerformingAcceptAllForRoom(roomId: string): boolean {
    return this.acceptingAllRoomIds.has(roomId);
  }
}

type PatchPayload = { attributes: { cardId: string; patch: PatchData } };

function hasPatchData(payload: any): payload is PatchPayload {
  return (
    payload.attributes?.cardId &&
    (payload.attributes?.patch?.attributes ||
      payload.attributes?.patch?.relationships)
  );
}

declare module '@ember/service' {
  interface Registry {
    'tool-service': ToolService;
  }
}
