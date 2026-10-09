import { getOwner, setOwner } from '@ember/owner';
import type Owner from '@ember/owner';

import { debounce } from '@ember/runloop';
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
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { STOPPED_TOOL_CALL_REASON } from '@cardstack/runtime-common/ai/stop';
import { AI_BOT_EXECUTOR } from '@cardstack/runtime-common/commands';
import {
  basicMappings,
  TOOL_CALL_DESCRIPTION_SCHEMA,
} from '@cardstack/runtime-common/helpers/ai';
import { getToolRequests } from '@cardstack/runtime-common/matrix-constants';

import ENV from '@cardstack/host/config/environment';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type Realm from '@cardstack/host/services/realm';
import CheckCorrectnessTool from '@cardstack/host/tools/check-correctness';

import HostBaseTool from '../lib/host-base-tool';
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
import type MessageTool from '../lib/matrix-classes/message-tool';
import type { RoomResource } from '../resources/room';
import type { CardDef } from '@cardstack/base/card-api';
import type { FileDef } from '@cardstack/base/file-api';
import type { IEvent } from 'matrix-js-sdk';

const DELAY_FOR_APPLYING_UI = isTesting() ? 50 : 500;
// How long drainToolProcessingQueue waits
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
// Upper bound on a single tool execution. A tool awaiting a card that never
// becomes loadable would otherwise hang forever, and the result event —
// which is what un-sticks both the UI spinner and the waiting ai-bot — is
// only sent once execute settles.
const TOOL_EXECUTE_TIMEOUT_MS = isTesting() ? 3_000 : 120_000;
// Upper bound on validating one tool request in the drain. Validation loads
// the tool's module and input schema; a load that never settles would hold
// the drain pass, and with it every later drain pass in the tab.
const VALIDATE_TIMEOUT_MS = isTesting() ? 3_000 : 60_000;
// When a validation is still running after this long, log the step it is on
// and what the loader and store are waiting for.
const VALIDATE_WATCHDOG_MS = isTesting() ? 1_000 : 20_000;

// Promise.race with a cleared timer: the losing execute keeps running (we
// cannot cancel it), but the run task settles and reports. That means a
// timed-out execute may still commit its side effects later, and the Retry
// the failure UI offers can then double-apply — idempotent for a re-write
// of the same attributes, a genuine duplicate for a tool that creates
// something. Real cancellation needs an abort signal threaded through
// Command.execute.
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not complete within ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timedOut]);
  } finally {
    clearTimeout(timer!);
  }
}

// Every tool module the host provides is registered under this specifier.
const HOST_TOOL_MODULE_PREFIX = '@cardstack/boxel-host/';

type GenericCommand = Command<
  typeof CardDef | undefined,
  typeof CardDef | undefined
>;

const toolProcessingWaiter = buildWaiter('tool-service:command-processing');

// Converts, where the schema asks for an object, an array or a number, a
// string value that parses to one. Nothing else changes.
function coerceToSchema(
  value: unknown,
  schema: any,
): { value: unknown; changed: boolean } {
  if (!schema || typeof schema !== 'object') {
    return { value, changed: false };
  }
  let type = schema.type;
  if (typeof value === 'string') {
    if (type === 'object' || type === 'array') {
      try {
        let parsed = JSON.parse(value);
        let fits =
          type === 'array'
            ? Array.isArray(parsed)
            : parsed && typeof parsed === 'object' && !Array.isArray(parsed);
        if (fits) {
          return { value: coerceToSchema(parsed, schema).value, changed: true };
        }
      } catch {
        // not JSON; leave it for validation to report
      }
    } else if (
      (type === 'number' || type === 'integer') &&
      value.trim() !== '' &&
      !Number.isNaN(Number(value))
    ) {
      return { value: Number(value), changed: true };
    }
    return { value, changed: false };
  }
  if (Array.isArray(value) && schema.items) {
    let changed = false;
    let items = value.map((item) => {
      let result = coerceToSchema(item, schema.items);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? items : value, changed };
  }
  if (value && typeof value === 'object' && schema.properties) {
    let changed = false;
    let out: Record<string, unknown> = {
      ...(value as Record<string, unknown>),
    };
    for (let [key, propertySchema] of Object.entries(schema.properties)) {
      if (key in out) {
        let result = coerceToSchema(out[key], propertySchema);
        if (result.changed) {
          out[key] = result.value;
          changed = true;
        }
      }
    }
    return { value: changed ? out : value, changed };
  }
  return { value, changed: false };
}

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
  // Requests the auto-execution flow has claimed for resolution. Drain
  // passes can overlap, and the records above are written only after
  // validation's slow awaits — so two overlapping passes could resolve
  // the same request twice (a stale-snapshot 'invalid' alongside an
  // 'applied', after which the model re-issues the call). A claim is a
  // synchronous check-and-set before validation's first await: exactly
  // one pass carries a request to its terminal result. Claims are never
  // released; the manual "Try Anyway" path bypasses them.
  claimedToolRequestIds = new Set<string>();
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
  private flushToolProcessingQueue: Promise<void> | undefined;

  constructor(owner: Owner) {
    super(owner);
    this.session.register(this);
  }

  resetState() {
    this.currentlyExecutingToolRequestIds.clear();
    this.executedToolRequestIds.clear();
    this.claimedToolRequestIds.clear();
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
    this.flushToolProcessingQueue = undefined;
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
    let key = this.invalidationKey(roomId, fileUrl);

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
          // A pass shared with other writers is announced once, under one of
          // their ids, with this one listed among its coalesced writes.
          (event.clientRequestId === clientRequestId ||
            event.coalescedWrites?.some(
              (write) => write.clientRequestId === clientRequestId,
            ))
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

  private invalidationKey(roomId: string, targetHref: string): string {
    let normalizedTarget = targetHref.endsWith('.json')
      ? targetHref.replace(/\.json$/, '')
      : targetHref;
    return `${roomId}::${normalizedTarget}`;
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
    let key = this.invalidationKey(roomId, targetHref);
    let existing = this.aiAssistantInvalidations.get(key);
    if (!existing) {
      return;
    }

    let invalidated = existing.deferred.promise.then(() => true);
    let settled = timeoutMs
      ? await Promise.race([invalidated, delay(timeoutMs).then(() => false)])
      : await invalidated;
    // Only a real invalidation consumes the entry. On timeout the deferred is
    // still live, and a later caller must still be able to wait on it.
    if (settled) {
      this.aiAssistantInvalidations.delete(key);
    }
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

  private async drainToolProcessingQueue() {
    let waiterToken = toolProcessingWaiter.beginAsync();
    let finishedProcessingTools: (() => void) | undefined;
    try {
      await this.flushToolProcessingQueue;

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

        // Resolve through the continuation chain: an answer long enough to
        // be split arrives as several events, its tool requests can ride any
        // of them, and only the head of the chain is exposed in
        // roomResource.messages (a plain messages.find on a continuation's
        // event id never matches, so its tools were dropped without ever
        // getting a terminal result — a spinner that never clears).
        // Message.tools on the head chases the chain, so the head carries
        // every request downstream code needs.
        let message = roomResource.messageForEventId(eventId!);
        // Events are only queued once their content is finalized
        // (isStreamingFinished), but the room resource folds that content
        // into its Message asynchronously — at drain time the Message may
        // not exist yet, or may still hold a streaming snapshot whose tool
        // arguments are partial or unparsed. Validating that snapshot posts
        // a spurious 'invalid' result for a request that is actually fine
        // (CS-12103). Requeue until the Message reports the finalized state
        // — chain-aware, so a head whose continuation is still streaming
        // keeps waiting; bounded so a message that never catches up still
        // falls through and resolves with a real (terminal) validation
        // result.
        if (
          !message ||
          (message.isStreamingFinished !== true && !message.isCanceled)
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
          // 'failed' is terminal for auto-execution too: the model has been
          // told the call failed, so re-running it unattended (e.g. on a
          // reload that replays room history) would produce a second,
          // contradictory result. The Retry affordance is the user's path.
          if (
            messageTool.status === 'applied' ||
            messageTool.status === 'invalid' ||
            messageTool.status === 'failed' ||
            messageTool.status === 'canceled'
          ) {
            continue;
          }
          if (!messageTool.name) {
            continue;
          }
          // Claim before validate's first await — the guards above are
          // checked here but recorded only after validation resolves, so
          // without this synchronous check-and-set an overlapping drain
          // pass could also carry this request to a terminal result.
          if (messageTool.id) {
            if (this.claimedToolRequestIds.has(messageTool.id)) {
              continue;
            }
            this.claimedToolRequestIds.add(messageTool.id);
          }

          // validate() loads the tool's module and input schema over the
          // loader; against a realm that is busy (e.g. indexing files this
          // same message just created) that can throw. Without this catch a
          // single throw killed the whole drain pass silently: the request
          // stayed claimed forever, its spinner never cleared, and the bot
          // waited forever. Report it as a failed result instead.
          //
          // The same holds for a validate() that never settles, and there the
          // cost is larger: every later drain pass awaits this one, so every
          // tool in the tab stops. Bound it like execute, and log what it is
          // waiting on if it is slow, so the stuck step can be named.
          let isValid = false;
          let watchdog = setTimeout(
            () => this.logSlowValidation(messageTool),
            VALIDATE_WATCHDOG_MS,
          );
          try {
            isValid = await withTimeout(
              this.validate(messageTool),
              VALIDATE_TIMEOUT_MS,
              `Validating tool "${messageTool.name}"`,
            );
          } catch (e) {
            let error = e instanceof Error ? e : new Error(String(e));
            console.error(
              `Tool processing failed for "${messageTool.name}" (${messageTool.id}):`,
              e,
            );
            try {
              await this.matrixService.sendToolResultEvent({
                roomId: roomId!,
                invokedToolFromEventId:
                  this.getCurrentEventIdForCommandRequest(
                    roomId!,
                    messageTool.id,
                  ) ?? messageTool.eventId,
                toolCallId: messageTool.id!,
                status: 'failed',
                failureReason: error.message,
                context:
                  await this.operatorModeStateService.getSummaryForAIBot(),
              });
            } catch (sendError) {
              console.error(
                'could not send failed tool result event to the room',
                sendError,
              );
              // The room never got a terminal result, so nothing else will
              // clear this tool's spinner — the local failed state at least
              // restores the Retry affordance in this tab.
              if (messageTool.id) {
                this.matrixService.failedToolState.set(messageTool.id, error);
              }
            }
            continue;
          } finally {
            clearTimeout(watchdog);
            if (messageTool.id) {
              this.validationSteps.delete(messageTool.id);
            }
          }
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
            // Read after validation, which can take a while: the user may
            // have stopped the loop meanwhile, and a tool that has not
            // started must not start after a stop.
            if (roomResource.stoppedMessageEventId === message.eventId) {
              await this.sendCanceledToolResult(roomId!, messageTool);
              continue;
            }
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
    } catch (e) {
      console.error('A tool processing pass failed', e);
    } finally {
      // Every pass awaits the one before it, so a pass that throws must
      // still release the next: otherwise no tool in the tab runs again, and
      // each one that arrives shows its spinner forever.
      finishedProcessingTools?.();
      toolProcessingWaiter.endAsync(waiterToken);
    }
  }

  // Answers a tool the user's stop kept from running, so the call still has
  // an outcome in the room and the model reads on the next turn why it
  // never ran.
  private async sendCanceledToolResult(
    roomId: string,
    messageTool: MessageTool,
  ) {
    try {
      await this.matrixService.sendToolResultEvent({
        roomId,
        invokedToolFromEventId:
          this.getCurrentEventIdForCommandRequest(roomId, messageTool.id) ??
          messageTool.eventId,
        toolCallId: messageTool.id!,
        status: 'canceled',
        failureReason: STOPPED_TOOL_CALL_REASON,
        context: await this.operatorModeStateService.getSummaryForAIBot(),
      });
    } catch (e) {
      console.error('could not send canceled tool result event to the room', e);
    }
  }

  private async invalidateAutoExecutableToolsForStuckProcessing(
    roomResource: RoomResource,
    roomId: string,
    eventId: string,
  ) {
    // Chain-aware for the same reason as the drain's lookup: the queued
    // event may be a continuation, and only the head is in messages.
    let message = roomResource.messageForEventId(eventId);
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
      // A drain pass that already claimed this request is carrying it to
      // its own terminal result; don't also resolve it invalid here.
      if (this.claimedToolRequestIds.has(commandRequestId)) {
        continue;
      }
      if (
        messageTool.status === 'applied' ||
        messageTool.status === 'invalid' ||
        messageTool.status === 'failed' ||
        messageTool.status === 'canceled'
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
      this.claimedToolRequestIds.add(commandRequestId);
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

  // Answers a call ai-bot holds for the user's approval (see
  // MessageTool.awaitsApproval). Approving sends an 'approved' result, which
  // releases the call: ai-bot runs it and publishes its real result.
  // Declining sends an 'invalid' result saying so, which settles the call;
  // the model reads the reason on its next turn. A call already answered is
  // left alone.
  // The held calls this client has answered. A call stops awaiting approval
  // the moment it is answered, before the answer's event comes back, so a
  // second click can't send a second answer; a send that fails offers the
  // choice again.
  answeredApprovalIds = new TrackedSet<string>();

  answerApproval = task(
    async (command: MessageTool, answer: 'approve' | 'decline') => {
      let callId = command.toolRequest.id;
      if (!command.awaitsApproval || !callId) {
        return;
      }
      this.answeredApprovalIds.add(callId);
      try {
        await this.sendApprovalAnswer(command, callId, answer);
      } catch (e) {
        // The answer never reached the room: offer the choice again.
        this.answeredApprovalIds.delete(callId);
        console.error(
          `could not send the answer to held tool call ${callId}`,
          e,
        );
      }
    },
  );

  private async sendApprovalAnswer(
    command: MessageTool,
    callId: string,
    answer: 'approve' | 'decline',
  ) {
    let invokedToolFromEventId =
      this.getCurrentEventIdForCommandRequest(
        command.message.roomId,
        command.toolRequest.id,
      ) ?? command.eventId;
    await this.matrixService.sendToolResultEvent({
      roomId: command.message.roomId,
      invokedToolFromEventId,
      toolCallId: callId,
      ...(answer === 'approve'
        ? { status: 'approved' as const }
        : {
            status: 'invalid' as const,
            failureReason: `The user declined this call (${
              command.description ?? command.name ?? 'a tool call'
            }). Do not request it again unless the user asks you to.`,
          }),
      context: await this.operatorModeStateService.getSummaryForAIBot(),
    });
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
    let toolToRun: Command<any, any> | undefined;
    // Distinguishes "the tool never ran" from "the tool ran, the aftermath
    // failed" — the catch below must not tell the room a committed write
    // failed.
    let didExecute = false;
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

      // The timeout brackets everything between claiming the request and
      // having a result in hand: module resolution and input construction
      // hang the same way a slow execute does (e.g. a loader or store.add
      // blocked on a card that never becomes loadable), and the result event
      // that un-sticks the UI and the waiting ai-bot is only sent once this
      // settles.
      let performTool = async (): Promise<CardDef | undefined> => {
        // A manual run can start before the tool's command is resolved, or
        // after it resolved to no command while its declaring skill was still
        // loading.
        await command.resolve({ retryUnresolved: true });
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
          return (await toolToRun.execute(typedInput as any)) as
            | CardDef
            | undefined;
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
          return undefined;
        } else {
          // Unrecognized tool. This can happen if a programmatically-provided
          // tool is no longer available due to a browser refresh.
          throw new Error(
            `Unrecognized tool: ${command.name}. This tool may have been associated with a previous browser session.`,
          );
        }
      };

      // checkCorrectness legitimately waits out one index-invalidation
      // window and then does prerender/refresh work that can take
      // comparably long, so it gets that much headroom on top of the
      // standard bound.
      let executeTimeoutMs =
        command.name === CHECK_CORRECTNESS_COMMAND_NAME
          ? TOOL_EXECUTE_TIMEOUT_MS + 2 * ENV.cardRenderTimeout
          : TOOL_EXECUTE_TIMEOUT_MS;

      [resultCard] = await all([
        withTimeout(performTool(), executeTimeoutMs, `Tool "${command.name}"`),
        timeout(DELAY_FOR_APPLYING_UI), // leave a beat for the "applying" state of the UI to be shown
      ]);
      didExecute = true;
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
        attachedFiles: this.attachedFilesForToolResult(
          command.codeRef,
          toolToRun,
          resultCard,
        ),
        context: userContextForAiBot,
      });
    } catch (e) {
      // The timeout's raw setTimeout can reject after the owner is torn down
      // (e.g. a test that ends with a tool in flight); the services this
      // branch touches are gone by then.
      if (this.isDestroying || this.isDestroyed) {
        return;
      }
      let error =
        typeof e === 'string'
          ? new Error(e)
          : e instanceof Error
            ? e
            : new Error('Tool call failed.');
      console.error(error);
      await timeout(DELAY_FOR_APPLYING_UI); // leave a beat for the "applying" state of the UI to be shown
      if (didExecute) {
        // The tool's side effects landed; only post-execution bookkeeping
        // (skill refresh, context collection, or sending the result event)
        // failed. Publishing 'failed' would tell the model to re-issue a
        // call whose effect already exists — and the Retry it offers would
        // be inert, since the request is recorded as executed. Best-effort
        // send the truthful terminal result instead.
        try {
          await this.matrixService.sendToolResultEvent({
            roomId: command.message.roomId,
            invokedToolFromEventId: eventId,
            toolCallId: commandRequestId!,
            status: 'applied',
            resultCard,
            attachedFiles: this.attachedFilesForToolResult(
              command.codeRef,
              toolToRun,
              resultCard,
            ),
          });
        } catch (sendError) {
          console.error(
            'could not send applied tool result event after a post-execution failure',
            sendError,
          );
          this.matrixService.failedToolState.set(commandRequestId!, error);
        }
        return;
      }
      this.matrixService.failedToolState.set(commandRequestId!, error);
      // Report the failure to the room: the result event is what clears the
      // UI spinner in other sessions and lets ai-bot react to the failure
      // instead of waiting forever. The local failedToolState above still
      // drives this tab's immediate Retry affordance.
      try {
        await this.matrixService.sendToolResultEvent({
          roomId: command.message.roomId,
          invokedToolFromEventId: eventId,
          toolCallId: commandRequestId!,
          status: 'failed',
          failureReason: error.message,
          context: await this.operatorModeStateService.getSummaryForAIBot(),
        });
      } catch (sendError) {
        console.error(
          'could not send failed tool result event to the room',
          sendError,
        );
      }
    } finally {
      this.currentlyExecutingToolRequestIds.delete(commandRequestId!);
    }
  });

  // The files a tool result attaches for the model, as the tool that ran
  // declares them. Only a tool the host itself provides is asked, so a command
  // loaded from a realm cannot attach files this way. (A command can still
  // attach a file through `FileForAttachmentCard`, which is handled
  // separately.)
  private attachedFilesForToolResult(
    codeRef: ResolvedCodeRef | undefined,
    tool: Command<any, any> | undefined,
    resultCard: CardDef | undefined,
  ): FileDef[] {
    if (
      !resultCard ||
      !(tool instanceof HostBaseTool) ||
      !codeRef?.module.startsWith(HOST_TOOL_MODULE_PREFIX)
    ) {
      return [];
    }
    return tool
      .resultAttachments(resultCard)
      .map((file) => this.matrixService.fileAPI.createFileDef(file));
  }

  // Which step each in-flight validation is on, for the slow-validation log.
  private validationSteps = new Map<string, string>();

  private markValidationStep(command: MessageTool, step: string) {
    if (command.id) {
      this.validationSteps.set(command.id, step);
    }
  }

  private logSlowValidation(command: MessageTool) {
    let step = command.id ? this.validationSteps.get(command.id) : undefined;
    let moduleImports = this.loaderService.loader.inFlightModuleImports;
    let queryLoads = this.store.queryLoadsInFlight();
    console.warn(
      `Tool "${command.name}" (${command.id}) is still validating after ${VALIDATE_WATCHDOG_MS}ms, at step: ${
        step ?? 'before the first load'
      }. Loader imports in flight: ${JSON.stringify(
        moduleImports,
      )}. Store query loads in flight: ${JSON.stringify(queryLoads)}`,
    );
  }

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

    if (command.argumentsError) {
      error = `The arguments of this "${command.name}" call were not valid JSON (${command.argumentsError}), so the call was not run. Send the call again with complete, valid JSON arguments.`;
    } else if (command.name === 'patchCardInstance') {
      // special case for patchCardInstance command
      return true;
    }

    // The message's tool list is complete as soon as its event is applied, but
    // each tool's command is resolved separately (it loads the declaring
    // skill), so wait for the resolution of the request's current name here —
    // inside validation's own timeout. A name that resolved to no command is
    // tried again: the skill declaring it may have loaded since.
    if (!error && command.name !== CHECK_CORRECTNESS_COMMAND_NAME) {
      this.markValidationStep(command, `resolve tool ${command.name}`);
      try {
        await command.resolve({ retryUnresolved: true });
      } catch (e) {
        error = `The tool for this "${command.name}" call could not be prepared (${
          e instanceof Error ? e.message : String(e)
        }), so the call was not run.`;
      }
    }

    let toolCodeRef = command.codeRef;
    let toolInstance: GenericCommand | undefined;

    if (error) {
      // Already invalid; there is no tool to resolve.
    } else if (command.name === CHECK_CORRECTNESS_COMMAND_NAME) {
      toolInstance = new CheckCorrectnessTool(this.toolContext);
    } else if (!toolCodeRef) {
      error = `No command for the name "${command.name}" was found`;
    } else {
      this.markValidationStep(
        command,
        `load tool module ${toolCodeRef.module}`,
      );
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
      this.markValidationStep(command, 'load basic field mappings');
      let mappings = await basicMappings(loader);
      this.markValidationStep(command, 'build input JSON schema');
      // `description` is the UI label only (see TOOL_CALL_DESCRIPTION_SCHEMA),
      // so it is not required here even though the tool definition given to
      // the model lists it as required.
      let jsonSchema = {
        type: 'object',
        properties: {
          description: TOOL_CALL_DESCRIPTION_SCHEMA,
          ...(await toolInstance.getInputJsonSchema(
            this.matrixService.cardAPI,
            mappings,
          )),
        },
        required: ['attributes'],
        additionalProperties: false,
      };
      const ajv = new Ajv();
      let valid = ajv.validate(jsonSchema, command.arguments);
      if (!valid) {
        error = `Command "${command.name}" validation failed: ${ajv.errorsText()}`;
        // A model sometimes sends an object argument as its JSON text, or a
        // number as a string. Run the call if converting those makes it valid.
        let coerced = coerceToSchema(command.arguments, jsonSchema);
        if (coerced.changed && ajv.validate(jsonSchema, coerced.value)) {
          command.setCoercedArguments(coerced.value);
          error = undefined;
        }
      }
    }
    if (error) {
      // The caller claimed this request before validating, so this invalid
      // result is already terminal for auto-execution. (The user can still
      // run it manually — "Try Anyway" bypasses the drain.)
      //
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
        typedInput = await this.store.addWithoutPersisting(inputDoc);
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
