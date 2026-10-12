import type OpenAI from 'openai';
import type { MatrixClient } from 'matrix-js-sdk';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import type {
  MatrixEvent as DiscreteMatrixEvent,
  Tool,
} from '@cardstack/base/matrix-event';
import { logger } from '@cardstack/runtime-common';
import { APP_BOXEL_COMPACTION_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import {
  COMPACTION_SUMMARY_INSTRUCTION,
  COMPACTION_SUMMARY_VERSION,
  findCompactionCut,
  getLatestCompaction,
  getPromptParts,
  type CompactionEventContent,
  type PromptParts,
} from '@cardstack/runtime-common/ai';
import { buildChatCompletionRequest } from './chat-completion-request.ts';

let log = logger('ai-bot:compaction');

// Each provider words this error differently. OpenRouter passes the
// upstream message through, so match the known wordings.
const CONTEXT_LENGTH_EXCEEDED_PATTERNS = [
  // OpenAI, OpenRouter: "This endpoint's maximum context length is 200000
  // tokens. However, you requested about 230000 tokens ..."
  /maximum context length/i,
  // OpenAI error code
  /context_length_exceeded/i,
  // Anthropic: "prompt is too long: 210000 tokens > 200000 maximum"
  /prompt is too long/i,
  // OpenAI Responses, xAI: "Your input exceeds the context window of this
  // model"
  /exceeds? the context window/i,
  // Google: "The input token count (1100000) exceeds the maximum number of
  // tokens allowed (1048576)"
  /input token count .* exceeds the maximum/i,
  // Mistral, DeepSeek and others: "Prompt contains 140000 tokens and 0
  // draft tokens, too large for model with 131072 maximum context length"
  /too large for model/i,
];

export function isContextLengthExceededError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  let { status, message, code } = error as {
    status?: number;
    message?: unknown;
    code?: unknown;
  };
  // A rate limit ("too many tokens per minute") is not a full context.
  if (status === 429) {
    return false;
  }
  let body = (
    error as {
      error?: { message?: unknown; metadata?: { raw?: unknown } };
    }
  ).error;
  // OpenRouter reports an upstream rejection as "Provider returned error"
  // and carries the provider's own message in `metadata.raw`.
  let text = [message, code, body?.message, body?.metadata?.raw]
    .filter((part) => typeof part === 'string')
    .join('\n');
  return CONTEXT_LENGTH_EXCEEDED_PATTERNS.some((pattern) => pattern.test(text));
}

// The summary request is the request of the last turn the provider accepted,
// with the instruction in place of the trailing context message. Model,
// provider routing, tools, tool choice (unless it forces a tool, see below)
// and reasoning stay the same: any change there invalidates the cached
// prefix, and the summary call is cheap only because it reads that prefix
// from the cache.
export function buildCompactionRequest(
  promptParts: PromptParts,
  senderMatrixUserId?: string,
  botTools: Tool[] = [],
): ChatCompletionCreateParamsNonStreaming {
  if (!promptParts.messages || promptParts.messages.length < 2) {
    throw new Error('There is no history to summarize');
  }
  let messages = [
    ...promptParts.messages.slice(0, -1),
    { role: 'user' as const, content: COMPACTION_SUMMARY_INSTRUCTION },
  ];
  let { stream_options: _streamOptions, ...request } =
    buildChatCompletionRequest(
      { ...promptParts, messages },
      senderMatrixUserId,
      botTools,
    );
  // A turn can force a tool call (a tool choice other than `auto`). The
  // summary must be prose, so it never inherits that; this costs the cached
  // messages, but only for a turn that forced a tool.
  if (request.tool_choice !== undefined && request.tool_choice !== 'auto') {
    request.tool_choice = 'none';
  }
  return {
    ...request,
    stream: false,
  } as ChatCompletionCreateParamsNonStreaming;
}

// The summary, or undefined when the response is not a complete,
// summary-only answer. A cut-off or tool-calling response must never replace
// history.
export function summaryFromCompletion(
  completion: ChatCompletion,
): string | undefined {
  let choice = completion.choices?.[0];
  if (!choice || choice.finish_reason !== 'stop') {
    return undefined;
  }
  if (choice.message.tool_calls?.length) {
    return undefined;
  }
  let summary = choice.message.content?.trim();
  return summary ? summary : undefined;
}

export type CompactionResult =
  | { compacted: true; eventList: DiscreteMatrixEvent[] }
  // `nothingToCompact`: no earlier history exists that a summary can
  // replace, so the prompt is too long by itself.
  | { compacted: false; nothingToCompact: boolean; reason: string };

// Summarizes the room history up to the last answer the provider accepted,
// posts the summary as a compaction event, and returns the event list with
// that event appended, ready to build the next prompt from. The host shows
// the compaction's progress on `responseEventId`, the answer it delays.
export async function compactRoomHistory(opts: {
  openai: OpenAI;
  client: MatrixClient;
  roomId: string;
  aiBotUserId: string;
  eventList: DiscreteMatrixEvent[];
  history: DiscreteMatrixEvent[];
  senderMatrixUserId: string;
  botTools: Tool[];
  responseEventId?: string;
  // Cancels the summary request.
  signal?: AbortSignal;
  recordCost: (
    costInUsd: number | undefined,
    generationId: string | undefined,
  ) => Promise<void>;
}): Promise<CompactionResult> {
  let { client, roomId, aiBotUserId, eventList, history } = opts;
  let cut = findCompactionCut(
    history,
    aiBotUserId,
    getLatestCompaction(eventList, aiBotUserId),
  );
  let anchorIndex = cut
    ? eventList.findIndex((event) => event.event_id === cut.anchorEventId)
    : -1;
  if (!cut || anchorIndex === -1) {
    return {
      compacted: false,
      nothingToCompact: true,
      reason: 'there is no earlier history that a summary can replace',
    };
  }

  let sendCompactionEvent = async (
    content: Omit<CompactionEventContent, 'responseEventId'>,
  ) => {
    let fullContent: CompactionEventContent = {
      ...content,
      ...(opts.responseEventId
        ? { responseEventId: opts.responseEventId }
        : {}),
    };
    let { event_id } = await client.sendEvent(
      roomId,
      APP_BOXEL_COMPACTION_EVENT_TYPE as any,
      fullContent as any,
    );
    return { event_id, content: fullContent };
  };

  await sendCompactionEvent({ status: 'running' });
  let summary: string | undefined;
  let reason: string | undefined;
  try {
    ({ summary, reason } = await summarize({
      ...opts,
      acceptedEventList: acceptedTurnEvents(
        eventList,
        anchorIndex,
        aiBotUserId,
      ),
    }));
  } catch (error) {
    await sendCompactionEvent({ status: 'failed' }).catch((sendError) =>
      log.error('Could not send the failed compaction event', sendError),
    );
    throw error;
  }
  if (!summary) {
    await sendCompactionEvent({ status: 'failed' });
    return { compacted: false, nothingToCompact: false, reason: reason! };
  }
  let { event_id, content } = await sendCompactionEvent({
    status: 'done',
    upToEventId: cut.upToEventId,
    summary,
    summaryVersion: COMPACTION_SUMMARY_VERSION,
  });
  return {
    compacted: true,
    eventList: [
      ...eventList,
      {
        type: APP_BOXEL_COMPACTION_EVENT_TYPE,
        sender: aiBotUserId,
        content,
        event_id,
        origin_server_ts: Date.now(),
        room_id: roomId,
      } as unknown as DiscreteMatrixEvent,
    ],
  };
}

// The events the accepted turn built its prompt from: everything before its
// answer, plus a compaction that turn ran itself. That compaction is posted
// after the answer's placeholder, so it sits after the answer in the room,
// yet the prompt the provider accepted already used its summary.
function acceptedTurnEvents(
  eventList: DiscreteMatrixEvent[],
  anchorIndex: number,
  aiBotUserId: string,
): DiscreteMatrixEvent[] {
  let anchorEventId = eventList[anchorIndex].event_id;
  let ownCompactions = eventList.slice(anchorIndex + 1).filter((event) => {
    let { type, sender, content } = event as {
      type: string;
      sender?: string;
      content?: Partial<CompactionEventContent>;
    };
    return (
      type === APP_BOXEL_COMPACTION_EVENT_TYPE &&
      sender === aiBotUserId &&
      content?.responseEventId === anchorEventId
    );
  });
  return [...eventList.slice(0, anchorIndex), ...ownCompactions];
}

// Sends the summary request built from the events of the last accepted turn.
async function summarize(opts: {
  openai: OpenAI;
  client: MatrixClient;
  roomId: string;
  aiBotUserId: string;
  acceptedEventList: DiscreteMatrixEvent[];
  senderMatrixUserId: string;
  botTools: Tool[];
  signal?: AbortSignal;
  recordCost: (
    costInUsd: number | undefined,
    generationId: string | undefined,
  ) => Promise<void>;
}): Promise<{ summary?: string; reason?: string }> {
  let acceptedPromptParts = await getPromptParts(
    opts.acceptedEventList,
    opts.aiBotUserId,
    opts.client,
  );
  if (!acceptedPromptParts.shouldRespond || !acceptedPromptParts.messages) {
    return { reason: 'the last accepted prompt could not be rebuilt' };
  }
  let request = buildCompactionRequest(
    acceptedPromptParts,
    opts.senderMatrixUserId,
    opts.botTools,
  );
  let completion = await opts.openai.chat.completions.create(request, {
    signal: opts.signal,
  });
  await opts.recordCost(
    (completion.usage as { cost?: number } | undefined)?.cost,
    completion.id,
  );
  log.info(
    `Compaction summary for room ${opts.roomId}: usage %j`,
    completion.usage,
  );
  let summary = summaryFromCompletion(completion);
  if (!summary) {
    return {
      reason: `the summary response was incomplete (finish reason: ${completion.choices?.[0]?.finish_reason})`,
    };
  }
  return { summary };
}
