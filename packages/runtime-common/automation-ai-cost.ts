// The most one AI request can cost, worked out before it is sent, so a run's
// AI spending cap can refuse it (ADR 029 §1.5): its input and its
// output-token limit, at the model's listed price. AI carries no margin
// (ADR 029 §1.1), so a request's credits are its listed price in USD at
// `CREDITS_PER_USD`.
//
// Only what can be bounded from the request body is priced: text input and
// output tokens, and the model's per-request price. A request carrying
// anything else that bills (web search, which bills per search and adds its
// results to the prompt; images, files, audio or video, which bill in tokens
// or units the body's bytes don't bound) is refused rather than priced low.

import { CREDITS_PER_USD } from './constants.ts';

// A model's listed price, as OpenRouter lists it and the `OpenRouterModel`
// card stores it. Every price is in USD.
export interface AIModelPrice {
  modelId: string;
  promptUsdPerToken: number;
  completionUsdPerToken: number;
  // Charged once per request.
  requestUsd: number;
  // The model's context window: the most tokens it reads and writes in all,
  // whichever provider serves it.
  contextLength: number | null;
}

// The most an AI request can cost, and the quantities it was priced at.
export interface AIRequestCostCeiling {
  credits: number;
  inputTokens: number;
  outputTokens: number;
}

export type AIRequestCostRefusal =
  // The body isn't a JSON object with a `messages` list.
  | 'invalid-request'
  // The body names a model other than the one priced, or lets OpenRouter
  // fall back to other models.
  | 'model-mismatch'
  // The request carries input that bills in a way its bytes don't bound.
  | 'unpriced-input'
  // Neither the request nor the model's context window limits its output.
  | 'unbounded-output';

export type AIRequestCostCeilingResult =
  | { ok: true; ceiling: AIRequestCostCeiling }
  | { ok: false; reason: AIRequestCostRefusal; message: string };

// Reads a model's price from an indexed `OpenRouterModel` card's attributes.
// OpenRouter lists prices as decimal strings in USD per token, and per
// request for `request`. The prompt and completion prices are required; a
// missing request price is 0, since most models list none. Returns
// undefined when the card names no model or a price isn't a number 0 or more
// (a variable price is listed as `-1`), since a request can't be bounded at a
// price that can't be read.
export function readOpenRouterModelPrice(
  attributes: Record<string, unknown> | undefined,
): AIModelPrice | undefined {
  if (!attributes || typeof attributes.modelId !== 'string') {
    return undefined;
  }
  let pricing = record(attributes.pricing);
  let promptUsdPerToken = price(pricing.prompt);
  let completionUsdPerToken = price(pricing.completion);
  let requestUsd = isAbsent(pricing.request) ? 0 : price(pricing.request);
  if (
    promptUsdPerToken === undefined ||
    completionUsdPerToken === undefined ||
    requestUsd === undefined
  ) {
    return undefined;
  }
  return {
    modelId: attributes.modelId,
    promptUsdPerToken,
    completionUsdPerToken,
    requestUsd,
    contextLength:
      tokenLimit(attributes.contextLength) ??
      tokenLimit(record(attributes.topProvider).contextLength),
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
// - **Output**: the request's `max_completion_tokens` or `max_tokens`, plus
//   its `reasoning.max_tokens` when it sets one, no more than the model's
//   context window. A request that sets no limit is priced at the context
//   window. The limit a provider lists isn't used: OpenRouter can route a
//   request to another provider with a higher one.
// - **Per request**: the model's request price.
export function aiRequestCostCeiling(
  body: string,
  price: AIModelPrice,
): AIRequestCostCeilingResult {
  let request: Record<string, unknown>;
  try {
    let parsed = JSON.parse(body);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Array.isArray(parsed.messages)
    ) {
      throw new Error('not a chat request');
    }
    request = parsed;
  } catch {
    return refuse(
      'invalid-request',
      'An AI request body must be a JSON object with a messages list',
    );
  }

  if (request.model !== price.modelId || request.models !== undefined) {
    return refuse(
      'model-mismatch',
      `An AI request priced at ${price.modelId} must name that model alone`,
    );
  }
  let unpriced = unpricedInput(request);
  if (unpriced) {
    return refuse(
      'unpriced-input',
      `An automation's AI request can't use ${unpriced}, since its cost can't be bounded before it is sent`,
    );
  }

  let requested =
    tokenLimit(request.max_completion_tokens) ?? tokenLimit(request.max_tokens);
  let reasoning = tokenLimit(record(request.reasoning).max_tokens) ?? 0;
  let { contextLength } = price;
  let outputTokens =
    requested === null
      ? contextLength
      : contextLength === null
        ? requested + reasoning
        : Math.min(requested + reasoning, contextLength);
  if (outputTokens === null) {
    return refuse(
      'unbounded-output',
      `An AI request to ${price.modelId} must set max_tokens: the model lists no context window, so its cost has no bound`,
    );
  }

  let inputTokens = new TextEncoder().encode(body).length;
  let usd =
    inputTokens * price.promptUsdPerToken +
    outputTokens * price.completionUsdPerToken +
    price.requestUsd;
  return {
    ok: true,
    ceiling: { credits: usd * CREDITS_PER_USD, inputTokens, outputTokens },
  };
}

// What, if anything, the request carries that bills outside its text tokens.
function unpricedInput(request: Record<string, unknown>): string | undefined {
  if (
    (typeof request.model === 'string' && request.model.endsWith(':online')) ||
    request.web_search_options !== undefined ||
    (Array.isArray(request.plugins) && request.plugins.length > 0)
  ) {
    return 'web search or other plugins';
  }
  for (let message of request.messages as unknown[]) {
    let content = record(message).content;
    if (Array.isArray(content)) {
      for (let part of content) {
        let type = record(part).type;
        if (type !== 'text') {
          return `${typeof type === 'string' ? type : 'non-text'} input`;
        }
      }
    } else if (typeof content !== 'string' && content != null) {
      return 'non-text input';
    }
  }
  return undefined;
}

function refuse(
  reason: AIRequestCostRefusal,
  message: string,
): AIRequestCostCeilingResult {
  return { ok: false, reason, message };
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function price(value: unknown): number | undefined {
  if (isAbsent(value)) {
    return undefined;
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
