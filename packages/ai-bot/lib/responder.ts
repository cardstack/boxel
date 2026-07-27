import { logger } from '@cardstack/runtime-common';
import {
  APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE,
  APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE,
  type AppBoxelResponseStreamContent,
} from '@cardstack/runtime-common/matrix-constants';
import { isToolOrCodePatchResult } from '@cardstack/runtime-common/ai';

import { errorReporter } from './sentry.ts';
import type { OpenAIError } from 'openai/error';
import { throttle } from 'lodash-es';
import type { ISendEventResponse } from 'matrix-js-sdk/lib/matrix.js';
import type { ChatCompletionMessageFunctionToolCall } from 'openai/resources/chat/completions';
import type { FunctionToolCall } from '@cardstack/runtime-common/helpers/ai';
import type OpenAI from 'openai';
import type { ChatCompletionSnapshot } from 'openai/lib/ChatCompletionStream';
import type { MatrixEvent as DiscreteMatrixEvent } from 'matrix-js-sdk';
import MatrixResponsePublisher, {
  toCommandRequest,
} from './matrix/response-publisher.ts';
import ResponseState from './response-state.ts';
import type { MatrixClient } from 'matrix-js-sdk';

let log = logger('ai-bot');

export class Responder {
  matrixResponsePublisher: MatrixResponsePublisher;
  private _lastSentTotal = 0;
  private _lastSentContentLen = 0;
  private _lastSentReasoningLen = 0;
  private _lastSentToolCallsJson: string | undefined;

  static eventMayTriggerResponse(event: DiscreteMatrixEvent) {
    // If it's a message, we should respond unless it's a card fragment
    if (event.getType() === 'm.room.message') {
      let content = event.getContent?.();
      if (content?.msgtype === APP_BOXEL_CODE_PATCH_CORRECTNESS_MSGTYPE) {
        return false;
      }
      return true;
    }

    // If it's a command result or a code patch result, we might respond
    if (isToolOrCodePatchResult(event)) {
      return true;
    }

    // If it's a different type
    return false;
  }

  static eventWillDefinitelyTriggerResponse(event: DiscreteMatrixEvent) {
    return (
      this.eventMayTriggerResponse(event) && !isToolOrCodePatchResult(event)
    );
  }

  private client: MatrixClient;
  private streamPreviewTarget: { userId: string; deviceId: string } | undefined;
  private _streamPreviewSequence = 0;

  // Per-turn telemetry, logged once per turn to compare streaming modes.
  // startedAt is the turn boundary as the Responder sees it (construction, i.e.
  // before prompt construction and the per-user cost-lock wait); streamStartedAt
  // marks the first chunk, so streamMs isolates the generation+streaming+finalize
  // window from that mode-independent pre-generation time. Room-event count lives
  // on the publisher; to-device previews and token usage are tallied here.
  private startedAt = Date.now();
  private streamStartedAt: number | undefined;
  private toDeviceEventsEmitted = 0;
  private promptTokens: number | undefined;
  private completionTokens: number | undefined;
  private telemetryLogged = false;

  constructor(
    client: MatrixClient,
    roomId: string,
    agentId: string,
    streamPreviewTarget?: { userId: string; deviceId: string },
  ) {
    this.client = client;
    this.streamPreviewTarget = streamPreviewTarget;
    this.matrixResponsePublisher = new MatrixResponsePublisher(
      client,
      roomId,
      agentId,
      this.responseState,
    );
  }

  messagePromises: Promise<
    ISendEventResponse | void | { errorMessage: string }
  >[] = [];

  responseState = new ResponseState();

  needsMessageSend = false;

  // The event id of the bot message this turn streamed into. ai-bot relates the
  // command-result events for its own readRealmFile calls back to it, so they
  // pair with the requests carried on that message.
  get responseEventId(): string | undefined {
    return this.matrixResponsePublisher.originalResponseEventId;
  }

  // to-device is the default: mid-turn previews stream over the ephemeral
  // to-device channel and only one consolidated room edit lands per turn,
  // keeping Synapse's room-event load flat. `room-edits` (the legacy per-edit
  // behavior) and `off` (no mid-turn previews at all) remain available as
  // explicit AI_BOT_STREAMING_MODE overrides.
  private get streamingMode(): 'room-edits' | 'off' | 'to-device' {
    const mode = process.env.AI_BOT_STREAMING_MODE;
    if (mode === 'off' || mode === 'room-edits') {
      return mode;
    }
    return 'to-device';
  }

  // Whether mid-turn state changes should trigger a throttled preview send.
  // In `off` mode we never send mid-turn events. In `to-device` mode without a
  // preview target (older client that didn't stamp its device id on the prompt)
  // we also skip mid-turn — the sensible fallback since we can't target a
  // preview at anyone in particular. The final consolidated room edit still
  // lands from `finalize`/`flush`.
  private get shouldStreamMidTurn(): boolean {
    const mode = this.streamingMode;
    if (mode === 'off') return false;
    if (mode === 'to-device' && !this.streamPreviewTarget) return false;
    return true;
  }

  async ensureThinkingMessageSent() {
    await this.matrixResponsePublisher.ensureThinkingMessageSent();
  }

  sendMessageEventWithThrottling = () => {
    if (this.needsMessageSend) {
      return; // already scheduled
    }
    this.needsMessageSend = true;
    this.sendMessageEventWithThrottlingInternal();
  };

  sendMessageEventWithThrottlingInternal: () => unknown = throttle(
    () => {
      this.needsMessageSend = false;
      // The final consolidated event always lands as a room edit — never a
      // to-device preview — because to-device is ephemeral and durable state
      // must be in the room. Intermediate previews in to-device mode go over
      // sendToDevice targeted at the originating device only.
      if (
        this.streamingMode === 'to-device' &&
        this.streamPreviewTarget &&
        !this.responseState.isStreamingFinished
      ) {
        this.sendToDevicePreview();
      } else {
        this.sendMessageEvent();
      }
    },
    Number(process.env.AI_BOT_STREAM_THROTTLE_MS ?? 250),
  );

  private sendToDevicePreview = async (): Promise<void> => {
    if (!this.streamPreviewTarget) return;
    const parentEventId = this.matrixResponsePublisher.originalResponseEventId;
    if (!parentEventId) {
      // Haven't sent the thinking placeholder yet — the client would have
      // nothing to attach the preview to.
      return;
    }
    const payload: AppBoxelResponseStreamContent = {
      roomId: this.matrixResponsePublisher.roomId,
      parentEventId,
      sequence: this._streamPreviewSequence++,
      body: this.responseState.latestContent ?? '',
      reasoning: this.responseState.latestReasoning ?? '',
      // Normalize to the same shape the room event carries (see
      // toCommandRequest) so a client reads toolRequests identically on both
      // channels; arguments come through as objects, empty until the streamed
      // JSON completes.
      toolRequests: (this.responseState.toolCalls ?? [])
        .filter(Boolean)
        .map((toolCall) =>
          toCommandRequest(toolCall as ChatCompletionMessageFunctionToolCall),
        ),
    };
    // matrix-js-sdk's sendToDevice takes a Map<userId, Map<deviceId, content>>
    // and iterates it internally — a plain nested object throws
    // `TypeError: contentMap is not iterable` at runtime.
    const contentMap = new Map([
      [
        this.streamPreviewTarget.userId,
        new Map([[this.streamPreviewTarget.deviceId, payload]]),
      ],
    ]);
    try {
      await this.client.sendToDevice(
        APP_BOXEL_RESPONSE_STREAM_EVENT_TYPE,
        contentMap,
      );
      this.toDeviceEventsEmitted++;
    } catch (e) {
      // Preview loss is non-fatal; the final room edit still lands. Log at
      // debug so a wedged homeserver doesn't spam sentry.
      log.debug('to-device response-stream preview send failed', e);
    }
  };

  sendMessageEvent = async () => {
    // Only send if the delta is meaningful, unless we are finalizing.
    const minDelta = Number(process.env.AI_BOT_STREAM_MIN_DELTA ?? 0);
    const latestContentLen = (this.responseState.latestContent || '').length;
    const reasoningText = this.responseState.latestReasoning || '';
    const latestReasoningLen = reasoningText.length;
    const toolCallsJson = JSON.stringify(this.responseState.toolCalls || []);
    const currentTotal = latestContentLen + latestReasoningLen;
    // Track last-sent size on the instance
    const lastSent = this._lastSentTotal;
    const contentDelta = latestContentLen - this._lastSentContentLen;
    const reasoningDelta = latestReasoningLen - this._lastSentReasoningLen;
    const toolCallsChanged = toolCallsJson !== this._lastSentToolCallsJson;

    const isFinal = this.responseState.isStreamingFinished;
    const isFirstContent = lastSent === 0 && currentTotal > 0;
    const shouldSend =
      isFinal ||
      isFirstContent ||
      reasoningDelta > 0 ||
      toolCallsChanged ||
      contentDelta >= minDelta;
    if (!shouldSend) {
      return;
    }

    const messagePromise = this.matrixResponsePublisher
      .sendMessage()
      .catch((e) => {
        return {
          errorMessage: e.message,
        };
      });
    // Update last-sent size only when we actually send
    this._lastSentTotal = currentTotal;
    this._lastSentContentLen = latestContentLen;
    this._lastSentReasoningLen = latestReasoningLen;
    this._lastSentToolCallsJson = toolCallsJson;
    this.messagePromises.push(messagePromise);
    await messagePromise;
  };

  async onChunk(
    chunk: OpenAI.Chat.Completions.ChatCompletionChunk,
    snapshot: ChatCompletionSnapshot,
  ) {
    // Mark the start of the streaming window on the first chunk so streamMs
    // measures generation+streaming+finalize, not the pre-generation wait.
    this.streamStartedAt ??= Date.now();

    // reasoning does not support snapshots, so we need to handle the delta
    const newReasoningContent = (
      chunk.choices?.[0]?.delta as { reasoning?: string }
    )?.reasoning;

    let toolCalls = snapshot.choices?.[0]?.message?.tool_calls?.filter((call) =>
      Boolean(call),
    );

    // When we're not sending mid-turn, `finalize()` owns the
    // `isStreamingFinished` transition — otherwise the flag would flip here,
    // the mid-turn send would be gated off, and `finalize()` would see no
    // transition and skip the final send too, leaving only the thinking
    // placeholder in the room.
    const isStreamingFinished =
      this.shouldStreamMidTurn && chunk.choices?.[0]?.finish_reason === 'stop';
    const responseStateChanged = this.responseState.update(
      newReasoningContent,
      snapshot.choices?.[0]?.message?.content,
      toolCalls,
      isStreamingFinished,
    );
    log.debug('onChunk', {
      reasoning: this.responseState.latestReasoning,
      content: this.responseState.latestContent,
      toolCalls: this.responseState.toolCalls,
      isStreamingFinished: this.responseState.isStreamingFinished,
      responseStateChanged,
    });
    if (responseStateChanged && this.shouldStreamMidTurn) {
      await this.sendMessageEventWithThrottling();
    }

    // This usage value is set *once* and *only once* at the end of the conversation
    // It will be null at all other times.
    if (chunk.usage) {
      this.promptTokens = chunk.usage.prompt_tokens;
      this.completionTokens = chunk.usage.completion_tokens;
      log.info(
        `Request used ${chunk.usage.prompt_tokens} prompt tokens and ${chunk.usage.completion_tokens} completion tokens`,
      );
    }

    return await Promise.all(this.messagePromises);
  }

  deserializeToolCall(
    toolCall: ChatCompletionMessageFunctionToolCall,
  ): FunctionToolCall {
    let { id, function: f } = toolCall;
    return {
      type: 'function',
      id,
      name: f.name,
      arguments: JSON.parse(f.arguments),
    };
  }

  async onError(
    error: OpenAIError | string,
    opts?: { reloadBillingData?: boolean },
  ) {
    if (this.responseState.isStreamingFinished) {
      return;
    }
    errorReporter.captureException(error, {
      extra: {
        roomId: this.matrixResponsePublisher.roomId,
        agentId: this.matrixResponsePublisher.agentId,
      },
    });
    let result = await this.matrixResponsePublisher.sendError(error, opts);
    // An errored turn still emits room events (the placeholder + this error
    // event, plus any mid-turn edits already sent), and several error paths in
    // main.ts end the turn here without ever calling finalize(). Log telemetry
    // so that room-event volume is not missing from the comparison; the guard
    // in logTurnTelemetry keeps it to a single line when finalize() also runs.
    this.logTurnTelemetry();
    return result;
  }

  async flush() {
    if (this.needsMessageSend) {
      (
        this.sendMessageEventWithThrottlingInternal as unknown as {
          cancel: () => void;
        }
      ).cancel();
      this.sendMessageEvent();
    }

    let results = await Promise.all(this.messagePromises);

    for (let result of results) {
      if (result && 'errorMessage' in result) {
        await this.onError(result.errorMessage);
      }
    }
  }
  isFinalized = false;
  async finalize(opts?: { isCanceled?: boolean }) {
    if (this.isFinalized) {
      return;
    }
    this.isFinalized = true;

    let isStreamingFinishedChanged =
      this.responseState.updateIsStreamingFinished(true, opts?.isCanceled);
    log.debug('finalize', {
      isStreamingFinishedChanged,
    });
    if (isStreamingFinishedChanged) {
      await this.sendMessageEventWithThrottling();
    }
    await this.flush();
    this.logTurnTelemetry();
  }

  // Per-turn measurements used to compare streaming modes. Exposed as a getter
  // so tests can assert the counts directly rather than parse the log line.
  // durationMs is whole-turn wall-clock (includes pre-generation queue/lock
  // wait); streamMs isolates the streaming window and is undefined for turns
  // that errored before the first chunk.
  get turnTelemetry() {
    return {
      mode: this.streamingMode,
      durationMs: Date.now() - this.startedAt,
      streamMs:
        this.streamStartedAt === undefined
          ? undefined
          : Date.now() - this.streamStartedAt,
      roomEvents: this.matrixResponsePublisher.roomEventsEmitted,
      toDeviceEvents: this.toDeviceEventsEmitted,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      canceled: this.responseState.isCanceled,
      roomId: this.matrixResponsePublisher.roomId,
      agentId: this.matrixResponsePublisher.agentId,
      responseEventId: this.responseEventId,
    };
  }

  // One structured, greppable line per turn so a scripted load run can compare
  // Matrix event volume and latency across streaming modes in Loki. Keep it
  // single-line key=value to stay consistent with the repo's other
  // request-timing channels (e.g. realm:requests `dur=`). Fires at most once
  // per turn — from finalize() on the normal/canceled paths, or from onError()
  // on the error paths that never finalize — so every turn that emitted room
  // events also emits exactly one line.
  private logTurnTelemetry() {
    if (this.telemetryLogged) {
      return;
    }
    this.telemetryLogged = true;
    let t = this.turnTelemetry;
    log.info(
      `[turn-telemetry] mode=${t.mode} durationMs=${t.durationMs} ` +
        `streamMs=${t.streamMs ?? ''} ` +
        `roomEvents=${t.roomEvents} toDeviceEvents=${t.toDeviceEvents} ` +
        `promptTokens=${t.promptTokens ?? ''} ` +
        `completionTokens=${t.completionTokens ?? ''} ` +
        `canceled=${t.canceled} roomId=${t.roomId} agentId=${t.agentId} ` +
        `responseEventId=${t.responseEventId ?? ''}`,
    );
  }
}
