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
// An automation that needs media calls the AI vendor through a `callApi`
// operation with the author's own key, which the vendor bills directly and
// which the run's `callApi` caps bound instead.

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
  // The other rates the model lists (OpenRouter's `pricing.overrides`), each
  // charged in place of the rates above when its conditions hold: a prompt of
  // at least `minPromptTokens` tokens, or a time of day or week.
  tiers?: AIModelPriceTier[];
}

type AIModelRates = Pick<
  AIModelPrice,
  'promptUsdPerToken' | 'completionUsdPerToken' | 'requestUsd'
>;

// One of a model's other listed rates. A rate the tier doesn't list is the
// model's base rate.
export interface AIModelPriceTier {
  // The fewest prompt tokens the tier charges at, or null when the tier's
  // conditions don't depend on the prompt's length.
  minPromptTokens: number | null;
  promptUsdPerToken: number;
  completionUsdPerToken: number;
  requestUsd: number;
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

// Input tokens added for a request with `tools`, for the tool-use system
// prompt a provider adds outside the body. Anthropic's is about 350 to 500
// tokens; the allowance leaves room above the largest.
export const TOOL_PROMPT_ALLOWANCE_TOKENS = 1000;

// Reads a model's price from an indexed `OpenRouterModel` card's attributes.
// OpenRouter lists prices as decimal strings in USD per token, and per
// request for `request`. The prompt and completion prices are required; a
// missing request price is 0, since most models list none. Each of the
// card's `pricing.overrides` is read as a tier, and a rate a tier doesn't
// list is the base rate. Returns undefined when the card names no model or
// a price, the base's or a tier's, isn't a number 0 or more (a variable
// price is listed as `-1`), since a request can't be bounded at a price that
// can't be read.
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
  let tiers: AIModelPriceTier[] = [];
  let overrides = Array.isArray(pricing.overrides) ? pricing.overrides : [];
  for (let override of overrides.map(record)) {
    let tierPrompt = isAbsent(override.prompt)
      ? promptUsdPerToken
      : price(override.prompt);
    let tierCompletion = isAbsent(override.completion)
      ? completionUsdPerToken
      : price(override.completion);
    let tierRequest = isAbsent(override.request)
      ? requestUsd
      : price(override.request);
    if (
      tierPrompt === undefined ||
      tierCompletion === undefined ||
      tierRequest === undefined
    ) {
      return undefined;
    }
    tiers.push({
      minPromptTokens: tokenLimit(override.minPromptTokens),
      promptUsdPerToken: tierPrompt,
      completionUsdPerToken: tierCompletion,
      requestUsd: tierRequest,
    });
  }
  return {
    modelId: attributes.modelId,
    promptUsdPerToken,
    completionUsdPerToken,
    requestUsd,
    contextLength:
      tokenLimit(attributes.contextLength) ??
      tokenLimit(record(attributes.topProvider).contextLength),
    tiers,
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
//   template adds per message. A request with `tools` also gets
//   `TOOL_PROMPT_ALLOWANCE_TOKENS`: providers wrap tool definitions in a
//   tool-use system prompt of a few hundred tokens that isn't in the body.
// - **Output**: the request's `max_completion_tokens` or `max_tokens`, plus
//   its `reasoning.max_tokens` when it sets one, no more than the model's
//   context window. A request that sets no limit is priced at the context
//   window. The limit a provider lists isn't used: OpenRouter can route a
//   request to another provider with a higher one.
// - **Per request**: the model's request price.
// - **Rates**: the highest of the model's base rates and each tier the
//   request can reach. A tier with a `minPromptTokens` is reachable when the
//   input bound is at least that many tokens. A tier set by the time of day
//   or week is always reachable, since a request can be sent, or a batch's
//   requests worked through, at any time.
//
// Output is priced at the completion rate, so a request asking for audio or
// image output, which bills at other rates, is refused.
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
  let unpriced = unpricedInput(request) ?? unpricedOutput(request);
  if (unpriced) {
    return refuse(
      'unpriced-input',
      `Boxel sends an automation's AI requests as text only, so Boxel can't send a request with ${unpriced}. ` +
        'To send or receive images, audio or files, call the AI vendor through an outside service with the author’s own API key. ' +
        'The AI vendor then bills the key’s owner directly.',
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

  let inputTokens =
    new TextEncoder().encode(body).length +
    (Array.isArray(request.tools) && request.tools.length > 0
      ? TOOL_PROMPT_ALLOWANCE_TOKENS
      : 0);
  let reachable: AIModelRates[] = [
    price,
    ...(price.tiers ?? []).filter(
      (tier) =>
        tier.minPromptTokens === null || inputTokens >= tier.minPromptTokens,
    ),
  ];
  let usd = Math.max(
    ...reachable.map(
      (rates) =>
        inputTokens * rates.promptUsdPerToken +
        outputTokens * rates.completionUsdPerToken +
        rates.requestUsd,
    ),
  );
  return {
    ok: true,
    ceiling: { credits: usd * CREDITS_PER_USD, inputTokens, outputTokens },
  };
}

// What, if anything, the request asks for that bills outside text output.
function unpricedOutput(request: Record<string, unknown>): string | undefined {
  if (
    request.audio !== undefined ||
    (Array.isArray(request.modalities) &&
      request.modalities.some((modality) => modality !== 'text'))
  ) {
    return 'audio or image output';
  }
  return undefined;
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
