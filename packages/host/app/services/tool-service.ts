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
import {
  basicMappings,
  TOOL_CALL_DESCRIPTION_SCHEMA,
} from '@cardstack/runtime-common/helpers/ai';
import { getToolRequests } from '@cardstack/runtime-common/matrix-constants';

import ENV from '@cardstack/host/config/environment';
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
// How many times drainToolProcessingQueue requeues a message's tools while
// that same message still has code patches pending auto-apply. Tools
// routinely target the very cards those patches create (a show-card for the
// instance a patch writes), so running them concurrently races the realm
// write/index. Requeues are ~100ms apart; on exhaustion the tools run
// anyway and the execute timeout below is the backstop.
const MAX_TOOL_PATCH_WAIT_RETRIES = isTesting() ? 20 : 600;
// How many times drainToolProcessingQueue requeues a message's tools while
// the index invalidations tracked for its patched files are still pending.
// Applied patches mean the write landed, not that the index has caught up —
// a tool loading a just-created card would still miss it. Requeues are
// ~100ms apart, so the production budget approximates the card render
// timeout; on exhaustion the tools run anyway and the execute timeout is
// the backstop.
const MAX_TOOL_INDEX_WAIT_RETRIES = isTesting() ? 20 : 300;
// Upper bound on a single tool execution. A tool awaiting a card that never
// becomes loadable would otherwise hang forever, and the result event —
// which is what un-sticks both the UI spinner and the waiting ai-bot — is
// only sent once execute settles.
const TOOL_EXECUTE_TIMEOUT_MS = isTesting() ? 3_000 : 120_000;

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
      // Whether the index event arrived. Deferred has no synchronous
      // inspection, and the tool drain must be able to ask "has this
      // landed?" without awaiting — see hasPendingPatchInvalidations.
      settled: boolean;
    }
  >();
  private aiAssistantInvalidationWaiters = new Map<
    string,
    { unsubscribe: () => void; timeoutId: ReturnType<typeof setTimeout> }
  >();
  // Where a code patch actually landed when the requested file already
  // existed and patch-code collision-renamed it: requested key -> final URL.
  // The invalidation tracker keys on the final URL, so waits that arrive
  // with the requested URL resolve through this map.
  private patchedFileRedirects = new Map<string, string>();
  private toolProcessingEventQueue: string[] = [];
  // How many times each queued event has been requeued waiting for the room
  // resource to fold the event's finalized content into its Message.
  private toolFinalizationRetries = new Map<string, number>();
  // How many times each queued event's tools have been requeued waiting for
  // that message's own code patches to finish auto-applying.
  private toolPatchWaitRetries = new Map<string, number>();
  // How many times each queued event's tools have been requeued waiting for
  // the index invalidations tracked for that message's patched files.
  private toolIndexWaitRetries = new Map<string, number>();
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
    this.patchedFileRedirects.clear();
    this.toolProcessingEventQueue = [];
    this.toolFinalizationRetries.clear();
    this.toolPatchWaitRetries.clear();
    this.toolIndexWaitRetries.clear();
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
      settled: false,
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
      if (current) {
        current.settled = true;
        current.deferred.fulfill();
      }
    });
    let timeoutId = setTimeout(
      () => {
        this.cleanupInvalidationWaiter(key);
        let current = this.aiAssistantInvalidations.get(key);
        if (current) {
          current.settled = true;
          current.deferred.fulfill();
        }
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
    let redirectedTarget = this.patchedFileRedirects.get(key);
    if (redirectedTarget) {
      key = this.invalidationKey(roomId, redirectedTarget);
    }
    let existing = this.aiAssistantInvalidations.get(key);
    if (!existing) {
      return;
    }

    let invalidated = existing.deferred.promise.then(() => true);
    let settled = timeoutMs
      ? await Promise.race([invalidated, delay(timeoutMs).then(() => false)])
      : await invalidated;
    // Only a real invalidation consumes the entry. On timeout the deferred is
    // still live, and a later caller (e.g. checkCorrectness after the drain's
    // bounded wait) must still be able to wait on it.
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

        // A message can carry both code patches and tool requests, and the
        // tools routinely target the very cards those patches create (a
        // show-card for the instance a patch writes). Running them while the
        // patches are still applying races the realm write/index, so when
        // this message still has patches the host is going to auto-apply
        // ('act' mode), requeue the tools until those patches settle.
        // Bounded: on exhaustion the tools run anyway and the execute
        // timeout is the backstop.
        if (
          roomResource.getActiveLLMModeForMessage(message.eventId) === 'act' &&
          this.messageHasUnsettledCodePatches(message)
        ) {
          let compoundKey = `${roomId}|${eventId}`;
          let retries = this.toolPatchWaitRetries.get(compoundKey) ?? 0;
          if (retries < MAX_TOOL_PATCH_WAIT_RETRIES) {
            this.toolPatchWaitRetries.set(compoundKey, retries + 1);
            if (!this.toolProcessingEventQueue.includes(compoundKey)) {
              this.toolProcessingEventQueue.push(compoundKey);
            }
            debounce(this, this.drainToolProcessingQueue, 100);
            continue;
          }
          console.error(
            `Tools on event ${eventId} in room ${roomId} ran before its code patches settled (waited ${MAX_TOOL_PATCH_WAIT_RETRIES} rounds)`,
          );
        }
        this.toolPatchWaitRetries.delete(`${roomId}|${eventId}`);

        // Applied patches mean the write landed, not that the index has
        // caught up — a tool loading a just-created card would still miss
        // it. Requeue until the tracked index invalidations of this
        // message's patched files settle, the same milestone
        // checkCorrectness waits on. The check is synchronous and the wait
        // happens through requeues because this loop drains every room's
        // tools — awaiting here would park unrelated rooms behind one slow
        // index event. A no-op when nothing was tracked (e.g. the patches
        // were applied by another session). Bounded: on exhaustion the
        // tools run anyway with the execute timeout as the backstop, and
        // the still-pending entry is deliberately left in place so a later
        // checkCorrectness can wait on it.
        let patchedFileUrls = this.patchedFileUrls(message);
        if (
          patchedFileUrls.length > 0 &&
          this.messageHasUnresolvedTools(message) &&
          this.hasPendingPatchInvalidations(roomId!, patchedFileUrls)
        ) {
          let compoundKey = `${roomId}|${eventId}`;
          let retries = this.toolIndexWaitRetries.get(compoundKey) ?? 0;
          if (retries < MAX_TOOL_INDEX_WAIT_RETRIES) {
            this.toolIndexWaitRetries.set(compoundKey, retries + 1);
            if (!this.toolProcessingEventQueue.includes(compoundKey)) {
              this.toolProcessingEventQueue.push(compoundKey);
            }
            debounce(this, this.drainToolProcessingQueue, 100);
            continue;
          }
          console.error(
            `Tools on event ${eventId} in room ${roomId} ran before the index invalidations of its patched files settled (waited ${MAX_TOOL_INDEX_WAIT_RETRIES} rounds)`,
          );
        }
        this.toolIndexWaitRetries.delete(`${roomId}|${eventId}`);

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
            messageTool.status === 'failed'
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
          let isValid = false;
          try {
            isValid = await this.validate(messageTool);
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
        messageTool.status === 'failed'
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
        // Resolve through the continuation chain: a long answer arrives as
        // several events, and only the head of the chain carries the joined
        // body every patch was parsed from.
        let message = roomResource.messageForEventId(eventId);
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
      const valid = ajv.validate(jsonSchema, command.arguments);
      if (!valid) {
        error = `Command "${command.name}" validation failed: ${ajv.errorsText()}`;
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
      let requestedKey = this.invalidationKey(roomId, fileUrl);
      if (finalFileIdentifier && finalFileIdentifier !== fileUrl) {
        // The invalidation tracker keys on where the write actually landed;
        // waits keyed on the requested URL resolve through this redirect.
        this.patchedFileRedirects.set(requestedKey, finalFileIdentifier);
      } else {
        // The write landed at the requested URL, so a redirect left by an
        // earlier collision-rename of this file no longer describes it —
        // leaving it in place would point this file's index waits at an
        // entry that was already consumed.
        this.patchedFileRedirects.delete(requestedKey);
      }

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

  // Whether any of these files' tracked index invalidations is still
  // outstanding. Synchronous so the tool drain can requeue instead of
  // awaiting — the drain serves every room, and blocking it on one
  // message's index event would stall unrelated rooms.
  private hasPendingPatchInvalidations(
    roomId: string,
    fileUrls: string[],
  ): boolean {
    return fileUrls.some((fileUrl) => {
      let key = this.invalidationKey(roomId, fileUrl);
      let redirectedTarget = this.patchedFileRedirects.get(key);
      if (redirectedTarget) {
        key = this.invalidationKey(roomId, redirectedTarget);
      }
      let entry = this.aiAssistantInvalidations.get(key);
      return !!entry && !entry.settled;
    });
  }

  // The distinct file URLs this message's code patches target.
  private patchedFileUrls(message: {
    htmlParts?: Array<{ codeData: CodeData | null }> | null;
  }): string[] {
    let urls = new Set<string>();
    for (let part of message.htmlParts ?? []) {
      let codeData = part.codeData;
      if (codeData?.searchReplaceBlock && codeData.fileUrl) {
        urls.add(codeData.fileUrl);
      }
    }
    return [...urls];
  }

  // Whether any tool on the message could still be run by a drain pass —
  // the same synchronous guards the ready-tool collection applies. When
  // nothing is runnable (e.g. a requeued pass whose tools all resolved),
  // waiting on index invalidations first would be pure latency.
  private messageHasUnresolvedTools(message: {
    tools: MessageTool[];
  }): boolean {
    return message.tools.some((messageTool) => {
      if (messageTool.executedBy === AI_BOT_EXECUTOR) {
        return false;
      }
      if (!messageTool.name || !messageTool.id) {
        return false;
      }
      if (
        this.currentlyExecutingToolRequestIds.has(messageTool.id) ||
        this.executedToolRequestIds.has(messageTool.id) ||
        this.claimedToolRequestIds.has(messageTool.id)
      ) {
        return false;
      }
      return (
        messageTool.status !== 'applied' &&
        messageTool.status !== 'invalid' &&
        messageTool.status !== 'failed'
      );
    });
  }

  // True while any code patch in the message has not reached a terminal
  // state ('applied' or 'failed') — i.e. it is still 'ready' (queued for
  // auto-apply) or 'applying'.
  private messageHasUnsettledCodePatches(message: {
    htmlParts?: Array<{ codeData: CodeData | null }> | null;
  }): boolean {
    if (!message.htmlParts) {
      return false;
    }
    return message.htmlParts.some((part) => {
      let codeData = part.codeData;
      // A block with no resolvable file URL is never applied
      // (executeReadyCodePatches skips it), so its status stays 'ready'
      // forever — counting it here would stall the message's tools for the
      // whole retry budget with nothing to wait for.
      if (!codeData?.searchReplaceBlock || !codeData.fileUrl) {
        return false;
      }
      let status = this.getCodePatchStatus(codeData);
      return status === 'ready' || status === 'applying';
    });
  }

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
