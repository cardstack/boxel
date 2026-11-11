import {
  aiRequestCostCeiling,
  readOpenRouterModelPrice,
  TOOL_PROMPT_ALLOWANCE_TOKENS,
  type AIModelPrice,
} from '../automation-ai-cost.ts';
import type { SharedTests } from '../helpers/index.ts';

// $3 per million input tokens and $15 per million output tokens.
const PRICE: AIModelPrice = {
  modelId: 'anthropic/claude-sonnet-4.6',
  promptUsdPerToken: 0.000003,
  completionUsdPerToken: 0.000015,
  requestUsd: 0,
  contextLength: 1_000_000,
};

const MESSAGES = [{ role: 'user', content: 'Summarize this week’s cards' }];

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function ceilingOf(request: object, price: AIModelPrice = PRICE) {
  let body = JSON.stringify({ model: price.modelId, ...request });
  let result = aiRequestCostCeiling(body, price);
  if (!result.ok) {
    throw new Error(`expected a ceiling, got ${result.reason}`);
  }
  return { body, ceiling: result.ceiling };
}

function refusalOf(request: object, price: AIModelPrice = PRICE) {
  let result = aiRequestCostCeiling(JSON.stringify(request), price);
  return result.ok ? 'priced' : result.reason;
}

function close(assert: Assert, actual: number, expected: number, msg: string) {
  assert.true(
    Math.abs(actual - expected) < 1e-9,
    `${msg}: expected ${expected}, got ${actual}`,
  );
}

const tests = Object.freeze({
  'prices the input at a token per byte and the output at its limit': async (
    assert,
  ) => {
    let { body, ceiling } = ceilingOf({ max_tokens: 1000, messages: MESSAGES });
    assert.strictEqual(
      ceiling.inputTokens,
      bytes(body),
      'input is UTF-8 bytes',
    );
    assert.true(
      ceiling.inputTokens > body.length,
      'a multi-byte character counts every byte',
    );
    assert.strictEqual(ceiling.outputTokens, 1000);
    close(
      assert,
      ceiling.credits,
      (bytes(body) * 0.000003 + 1000 * 0.000015) * 1000,
      'credits are the listed USD price at 1,000 credits to the dollar',
    );
    let withRequestPrice = ceilingOf(
      { max_tokens: 1000, messages: MESSAGES },
      { ...PRICE, requestUsd: 0.001 },
    );
    close(
      assert,
      withRequestPrice.ceiling.credits,
      ceiling.credits + 1,
      'the per-request price adds to it',
    );
  },

  'a request with tools counts the provider’s tool-use prompt as input': async (
    assert,
  ) => {
    let { body, ceiling } = ceilingOf({
      max_tokens: 1,
      tools: [
        {
          type: 'function',
          function: { name: 'count', parameters: { type: 'object' } },
        },
      ],
      messages: MESSAGES,
    });
    assert.strictEqual(
      ceiling.inputTokens,
      bytes(body) + TOOL_PROMPT_ALLOWANCE_TOKENS,
      'the body’s bytes plus the allowance',
    );
    assert.true(
      ceiling.inputTokens >= 500,
      'a small tool request covers a few-hundred-token tool-use prompt',
    );
    let plain = ceilingOf({ max_tokens: 1, tools: [], messages: MESSAGES });
    assert.strictEqual(
      plain.ceiling.inputTokens,
      bytes(plain.body),
      'an empty tools list adds nothing',
    );
  },

  'the request’s own output limit is priced, up to the context window': async (
    assert,
  ) => {
    assert.strictEqual(
      ceilingOf({
        max_completion_tokens: 500,
        max_tokens: 2000,
        messages: MESSAGES,
      }).ceiling.outputTokens,
      500,
      'max_completion_tokens wins over max_tokens',
    );
    assert.strictEqual(
      ceilingOf(
        { max_tokens: 128_000, messages: MESSAGES },
        { ...PRICE, contextLength: 200_000 },
      ).ceiling.outputTokens,
      128_000,
      'a limit within the context window is priced in full, whatever one provider lists',
    );
    assert.strictEqual(
      ceilingOf(
        { max_tokens: 500_000, messages: MESSAGES },
        { ...PRICE, contextLength: 200_000 },
      ).ceiling.outputTokens,
      200_000,
      'no request returns more than the context window',
    );
    assert.strictEqual(
      ceilingOf({
        max_tokens: 1000,
        reasoning: { max_tokens: 4000 },
        messages: MESSAGES,
      }).ceiling.outputTokens,
      5000,
      'a reasoning budget counts as output too',
    );
  },

  'a request without an output limit is priced at the context window': async (
    assert,
  ) => {
    assert.strictEqual(
      ceilingOf({ messages: MESSAGES }).ceiling.outputTokens,
      1_000_000,
    );
    assert.strictEqual(
      refusalOf(
        { model: PRICE.modelId, messages: MESSAGES },
        { ...PRICE, contextLength: null },
      ),
      'unbounded-output',
      'nothing bounds a request with no limit to a model with no listed window',
    );
    assert.strictEqual(
      refusalOf(
        { model: PRICE.modelId, max_tokens: 10, messages: MESSAGES },
        { ...PRICE, contextLength: null },
      ),
      'priced',
      'the request’s own limit bounds it',
    );
  },

  'a body that isn’t a chat request is refused': async (assert) => {
    for (let body of ['not json', '[]', 'null', '{"model":"x"}']) {
      let result = aiRequestCostCeiling(body, PRICE);
      assert.strictEqual(
        result.ok ? undefined : result.reason,
        'invalid-request',
        body,
      );
    }
  },

  'a request naming another model, or fallbacks, is refused': async (
    assert,
  ) => {
    assert.strictEqual(
      refusalOf({ model: 'openai/gpt-5', messages: MESSAGES }),
      'model-mismatch',
    );
    assert.strictEqual(
      refusalOf({ messages: MESSAGES }),
      'model-mismatch',
      'a request that names no model',
    );
    assert.strictEqual(
      refusalOf({
        model: PRICE.modelId,
        models: [PRICE.modelId, 'openai/gpt-5'],
        messages: MESSAGES,
      }),
      'model-mismatch',
      'fallback models could be billed at another price',
    );
  },

  'web search and non-text input are refused': async (assert) => {
    let base = { model: PRICE.modelId, max_tokens: 100 };
    assert.strictEqual(
      refusalOf({ ...base, plugins: [{ id: 'web' }], messages: MESSAGES }),
      'unpriced-input',
      'the web plugin',
    );
    assert.strictEqual(
      refusalOf({ ...base, web_search_options: {}, messages: MESSAGES }),
      'unpriced-input',
      'web search options',
    );
    assert.strictEqual(
      refusalOf(
        { ...base, model: `${PRICE.modelId}:online`, messages: MESSAGES },
        { ...PRICE, modelId: `${PRICE.modelId}:online` },
      ),
      'unpriced-input',
      'an :online model',
    );
    for (let part of [
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      { type: 'file', file: { filename: 'a.pdf', file_data: 'x' } },
      { type: 'input_audio', input_audio: { data: 'x', format: 'wav' } },
    ]) {
      assert.strictEqual(
        refusalOf({
          ...base,
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'What is this?' }, part],
            },
          ],
        }),
        'unpriced-input',
        part.type,
      );
    }
    assert.strictEqual(
      refusalOf({
        ...base,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Text parts' }] },
        ],
      }),
      'priced',
      'text parts are priced',
    );
  },

  'a request asking for audio or image output is refused': async (assert) => {
    let base = { model: PRICE.modelId, max_tokens: 4000, messages: MESSAGES };
    assert.strictEqual(
      refusalOf({
        ...base,
        modalities: ['text', 'audio'],
        audio: { voice: 'alloy', format: 'wav' },
      }),
      'unpriced-input',
      'audio output bills at an audio rate',
    );
    assert.strictEqual(
      refusalOf({ ...base, audio: { voice: 'alloy', format: 'wav' } }),
      'unpriced-input',
      'an audio key alone',
    );
    assert.strictEqual(
      refusalOf({ ...base, modalities: ['image', 'text'] }),
      'unpriced-input',
      'image output bills per image',
    );
    assert.strictEqual(
      refusalOf({ ...base, modalities: ['text'] }),
      'priced',
      'text output alone is priced',
    );
  },

  'reads a model’s price from its OpenRouterModel card': async (assert) => {
    assert.deepEqual(
      readOpenRouterModelPrice({
        modelId: 'openai/gpt-5-nano',
        contextLength: 400000,
        pricing: {
          prompt: '0.00000005',
          completion: '0.0000004',
          request: null,
          image: '0',
          webSearch: '0.01',
        },
        topProvider: { contextLength: 128000, maxCompletionTokens: 64000 },
      }),
      {
        modelId: 'openai/gpt-5-nano',
        promptUsdPerToken: 0.00000005,
        completionUsdPerToken: 0.0000004,
        requestUsd: 0,
        contextLength: 400000,
      },
      'the model’s own context window, not one provider’s',
    );
    assert.strictEqual(
      readOpenRouterModelPrice({
        modelId: 'x/y',
        pricing: { prompt: '0', completion: '0' },
        topProvider: { contextLength: 8192 },
      })?.contextLength,
      8192,
      'the top provider’s window when the card lists none of its own',
    );
    for (let [label, pricing] of [
      ['no pricing', undefined],
      ['no prompt price', { completion: '0.00001' }],
      ['no completion price', { prompt: '0.00001' }],
      ['a variable price', { prompt: '-1', completion: '-1' }],
    ] as const) {
      assert.strictEqual(
        readOpenRouterModelPrice({ modelId: 'x/y', pricing }),
        undefined,
        `${label} can’t bound a request`,
      );
    }
    assert.strictEqual(
      readOpenRouterModelPrice({ pricing: { prompt: '0', completion: '0' } }),
      undefined,
      'a card without a model id',
    );
  },
}) as SharedTests<{}>;

export default tests;
