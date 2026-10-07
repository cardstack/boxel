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
  type CompactionContent,
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
  let nestedMessage = (error as { error?: { message?: unknown } }).error
    ?.message;
  let text = [message, code, nestedMessage]
    .filter((part) => typeof part === 'string')
    .join('\n');
  return CONTEXT_LENGTH_EXCEEDED_PATTERNS.some((pattern) => pattern.test(text));
}

// The summary request is the request of the last turn the provider accepted,
// with the instruction in place of the trailing context message. Model,
// provider routing, tools, tool choice and reasoning stay the same: any
// change there invalidates the cached prefix, and the summary call is cheap
// only because it reads that prefix from the cache.
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
  | { compacted: false; reason: string };

// Summarizes the room history up to the last answer the provider accepted,
// posts the summary as a compaction event, and returns the event list with
// that event appended, ready to build the next prompt from.
export async function compactRoomHistory(opts: {
  openai: OpenAI;
  client: MatrixClient;
  roomId: string;
  aiBotUserId: string;
  eventList: DiscreteMatrixEvent[];
  history: DiscreteMatrixEvent[];
  senderMatrixUserId: string;
  botTools: Tool[];
  recordCost: (
    costInUsd: number | undefined,
    generationId: string | undefined,
  ) => Promise<void>;
}): Promise<CompactionResult> {
  let { openai, client, roomId, aiBotUserId, eventList, history } = opts;
  let cut = findCompactionCut(
    history,
    aiBotUserId,
    getLatestCompaction(eventList, aiBotUserId),
  );
  if (!cut) {
    return {
      compacted: false,
      reason: 'there is no earlier history that a summary can replace',
    };
  }
  let anchorIndex = eventList.findIndex(
    (event) => event.event_id === cut.anchorEventId,
  );
  if (anchorIndex === -1) {
    return {
      compacted: false,
      reason: 'the last answer is not in the room events',
    };
  }
  // The events of the last accepted turn: everything before its answer.
  let acceptedPromptParts = await getPromptParts(
    eventList.slice(0, anchorIndex),
    aiBotUserId,
    client,
  );
  if (!acceptedPromptParts.shouldRespond || !acceptedPromptParts.messages) {
    return {
      compacted: false,
      reason: 'the last accepted prompt could not be rebuilt',
    };
  }
  let request = buildCompactionRequest(
    acceptedPromptParts,
    opts.senderMatrixUserId,
    opts.botTools,
  );
  let completion = await openai.chat.completions.create(request);
  await opts.recordCost(
    (completion.usage as { cost?: number } | undefined)?.cost,
    completion.id,
  );
  log.info(`Compaction summary for room ${roomId}: usage %j`, completion.usage);
  let summary = summaryFromCompletion(completion);
  if (!summary) {
    return {
      compacted: false,
      reason: `the summary response was incomplete (finish reason: ${completion.choices?.[0]?.finish_reason})`,
    };
  }
  let content: CompactionContent = {
    upToEventId: cut.upToEventId,
    summary,
    summaryVersion: COMPACTION_SUMMARY_VERSION,
  };
  let { event_id } = await client.sendEvent(
    roomId,
    APP_BOXEL_COMPACTION_EVENT_TYPE as any,
    content as any,
  );
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
