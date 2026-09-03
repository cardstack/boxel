import type { PromptParts } from '@cardstack/runtime-common/ai';
import { DEFAULT_FALLBACK_MODEL_ID } from '@cardstack/runtime-common/matrix-constants';
import type { ChatCompletionMessageParam } from 'openai/resources';
import type { ChatCompletionStreamParams } from 'openai/lib/ChatCompletionStream';
import { readRealmFileTool } from './read-realm-file.ts';

// Builds the OpenRouter chat-completion request for one turn from the
// room-derived prompt parts. Pure: no client, no network, so the exact wire
// shape is unit-testable.
export function buildChatCompletionRequest(
  prompt: PromptParts,
  senderMatrixUserId?: string,
  // Whether to offer the bot-fulfilled readRealmFile tool. The caller decides
  // (delegation configured + a single-human room); the bot never advertises
  // a tool it won't run.
  offerRealmFileRead = false,
): ChatCompletionStreamParams {
  if (!prompt.model) {
    throw new Error('Model is required');
  }
  let model = prompt.model ?? DEFAULT_FALLBACK_MODEL_ID;

  let request: ChatCompletionStreamParams = {
    model,
    messages: prompt.messages as ChatCompletionMessageParam[],
    // A streamed response reports no token counts unless asked. With this
    // the provider delivers a usage block at the end of the stream — on a
    // trailing chunk whose `choices` is empty or carries no finish_reason,
    // which is why the Responder's end-of-stream detection must never
    // un-set itself on a later chunk (see onChunk).
    stream_options: { include_usage: true },
  };
  // OpenRouter's usage accounting. On top of the OpenAI-shaped counts above
  // it adds `prompt_tokens_details.cached_tokens` (the prompt-cache split)
  // and an inline `cost` to the same trailing usage payload. The inline
  // cost also lets the chunk handler's preferred billing path run instead
  // of the slower generation-API fallback. Not in the OpenAI types, hence
  // the cast.
  (request as Record<string, unknown>).usage = { include: true };

  // Prompt caches live per provider, and the router is otherwise free to
  // spread a room's requests across providers — which turns a warm cache
  // prefix into a full-price miss mid-conversation. Bias Anthropic-model
  // requests to Anthropic itself, keeping fallbacks for availability.
  if (model.startsWith('anthropic/')) {
    (request as Record<string, unknown>).provider = {
      order: ['anthropic'],
      allow_fallbacks: true,
    };
  }

  // The reasoning effort is the room's choice, carried on the active-llm
  // event from the model's ModelConfiguration card. Models that think by
  // default get a bounded effort through that card; nothing is invented here,
  // so models that do not think by default keep thinking off.
  if (prompt.reasoningEffort !== undefined) {
    request.reasoning_effort = prompt.reasoningEffort;
  }

  if (
    prompt.toolsSupported === true &&
    prompt.tools &&
    prompt.tools.length > 0
  ) {
    request.tools = prompt.tools;
    request.tool_choice = prompt.toolChoice;
  }

  // Offer the bot-executed readRealmFile tool when the caller allows it, even
  // in rooms that carry no other tools.
  if (prompt.toolsSupported === true && offerRealmFileRead) {
    request.tools = [...(request.tools ?? []), readRealmFileTool];
  }

  if (senderMatrixUserId) {
    request.user = senderMatrixUserId;
  }

  return request;
}
