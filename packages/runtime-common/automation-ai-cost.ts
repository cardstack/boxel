// The most one AI request can cost, worked out before it is sent, so a run's
// AI spending cap can refuse it (ADR 029 §1.5): its input and its
// output-token limit, at the model's listed price. AI carries no margin
// (ADR 029 §1.1), so a request's credits are its listed price in USD at
// `CREDITS_PER_USD`.

import { CREDITS_PER_USD } from './constants.ts';

// A model's listed price, as OpenRouter lists it and the `OpenRouterModel`
// card stores it. Every price is in USD.
export interface AIModelPrice {
  modelId: string;
  promptUsdPerToken: number;
  completionUsdPerToken: number;
  // Charged once per request.
  requestUsd: number;
  // Charged per image in the input.
  imageUsd: number;
  // Charged once per request that searches the web.
  webSearchUsd: number;
  // The most tokens the model returns for one request, when OpenRouter lists
  // it, and the most it reads and writes in all.
  maxCompletionTokens: number | null;
  contextLength: number | null;
}

// The most an AI request can cost, and the quantities it was priced at.
export interface AIRequestCostCeiling {
  credits: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  webSearch: boolean;
}

export type AIRequestCostCeilingResult =
  | { ok: true; ceiling: AIRequestCostCeiling }
  | {
      ok: false;
      // `unbounded-output`: neither the request nor the model's listing
      // limits the tokens it can return, so nothing bounds its cost.
      // `invalid-request`: the body isn't a JSON object.
      reason: 'unbounded-output' | 'invalid-request';
      message: string;
    };

// Reads a model's price from an indexed `OpenRouterModel` card's attributes.
// OpenRouter lists prices as decimal strings in USD per token (per request,
// image or search for the others); a missing one costs nothing. Returns
// undefined when the card names no model or a price isn't a number 0 or
// more, since a request can't be bounded at a price that can't be read.
export function readOpenRouterModelPrice(
  attributes: Record<string, unknown> | undefined,
): AIModelPrice | undefined {
  if (!attributes || typeof attributes.modelId !== 'string') {
    return undefined;
  }
  let pricing = record(attributes.pricing);
  let topProvider = record(attributes.topProvider);
  let prices = {
    promptUsdPerToken: price(pricing.prompt),
    completionUsdPerToken: price(pricing.completion),
    requestUsd: price(pricing.request),
    imageUsd: price(pricing.image),
    webSearchUsd: price(pricing.webSearch),
  };
  if (Object.values(prices).some((p) => p === undefined)) {
    return undefined;
  }
  return {
    modelId: attributes.modelId,
    ...(prices as Omit<
      AIModelPrice,
      'modelId' | 'maxCompletionTokens' | 'contextLength'
    >),
    maxCompletionTokens: tokenLimit(topProvider.maxCompletionTokens),
    contextLength:
      tokenLimit(topProvider.contextLength) ??
      tokenLimit(attributes.contextLength),
  };
}

// The most a chat completion request can cost at `price`.
//
// - **Input**: one token per byte of the request body, UTF-8 encoded. Every
//   tokenizer OpenRouter's models use encodes text as tokens of at least one
//   byte each, so a text can't take more tokens than it has bytes. The body
//   holds the messages, tool definitions and every other input, so it holds
//   more bytes than they do. The JSON around each message (its braces,
//   quotes and `"role"` key) is more bytes than the few tokens a chat
//   template adds per message.
// - **Images**: each `image_url` part at the model's per-image price, on top
//   of its bytes.
// - **Output**: the request's `max_completion_tokens` or `max_tokens`, no
//   more than the model's own limit. A request that sets neither can return
//   as many as the model's limit, or its context length when OpenRouter
//   lists no limit. With none of those, the output is unbounded and the
//   request can't be priced.
// - **Per request**: the model's request price, and its web search price when
//   the request asks for a search (the `web` plugin, or a model id ending in
//   `:online`).
export function aiRequestCostCeiling(
  body: string,
  price: AIModelPrice,
): AIRequestCostCeilingResult {
  let request: Record<string, unknown>;
  try {
    let parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    request = parsed;
  } catch {
    return {
      ok: false,
      reason: 'invalid-request',
      message: 'An AI request body must be a JSON object',
    };
  }

  let modelLimit = price.maxCompletionTokens ?? price.contextLength;
  let requested =
    tokenLimit(request.max_completion_tokens) ?? tokenLimit(request.max_tokens);
  let outputTokens =
    requested !== null && modelLimit !== null
      ? Math.min(requested, modelLimit)
      : (requested ?? modelLimit);
  if (outputTokens === null) {
    return {
      ok: false,
      reason: 'unbounded-output',
      message: `An AI request to ${price.modelId} must set max_tokens: the model lists no output limit, so its cost has no bound`,
    };
  }

  let inputTokens = new TextEncoder().encode(body).length;
  let images = countImages(request.messages);
  let webSearch =
    (typeof request.model === 'string' && request.model.endsWith(':online')) ||
    (Array.isArray(request.plugins) &&
      request.plugins.some((plugin) => record(plugin).id === 'web'));

  let usd =
    inputTokens * price.promptUsdPerToken +
    outputTokens * price.completionUsdPerToken +
    images * price.imageUsd +
    price.requestUsd +
    (webSearch ? price.webSearchUsd : 0);
  return {
    ok: true,
    ceiling: {
      credits: usd * CREDITS_PER_USD,
      inputTokens,
      outputTokens,
      images,
      webSearch,
    },
  };
}

function countImages(messages: unknown): number {
  if (!Array.isArray(messages)) {
    return 0;
  }
  let images = 0;
  for (let message of messages) {
    let content = record(message).content;
    if (Array.isArray(content)) {
      images += content.filter(
        (part) => record(part).type === 'image_url',
      ).length;
    }
  }
  return images;
}

function price(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  let n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function tokenLimit(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
