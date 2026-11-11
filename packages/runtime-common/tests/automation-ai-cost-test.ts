import {
  aiRequestCostCeiling,
  readOpenRouterModelPrice,
  type AIModelPrice,
} from '../automation-ai-cost.ts';
import type { SharedTests } from '../helpers/index.ts';

// $3 per million input tokens and $15 per million output tokens.
const PRICE: AIModelPrice = {
  modelId: 'anthropic/claude-sonnet-4.6',
  promptUsdPerToken: 0.000003,
  completionUsdPerToken: 0.000015,
  requestUsd: 0,
  imageUsd: 0.0048,
  webSearchUsd: 0.02,
  maxCompletionTokens: 64_000,
  contextLength: 1_000_000,
};

function bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function ceilingOf(request: object, price: AIModelPrice = PRICE) {
  let body = JSON.stringify(request);
  let result = aiRequestCostCeiling(body, price);
  if (!result.ok) {
    throw new Error(`expected a ceiling, got ${result.reason}`);
  }
  return { body, ceiling: result.ceiling };
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
    let { body, ceiling } = ceilingOf({
      model: PRICE.modelId,
      max_tokens: 1000,
      messages: [{ role: 'user', content: 'Summarize this week’s cards' }],
    });
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
  },

  'max_completion_tokens wins over max_tokens, and the model limit caps both':
    async (assert) => {
      assert.strictEqual(
        ceilingOf({
          max_completion_tokens: 500,
          max_tokens: 2000,
          messages: [],
        }).ceiling.outputTokens,
        500,
      );
      assert.strictEqual(
        ceilingOf({ max_tokens: 200_000, messages: [] }).ceiling.outputTokens,
        64_000,
        'a request asking for more than the model returns is priced at the model limit',
      );
    },

  'a request without an output limit is priced at the model’s': async (
    assert,
  ) => {
    assert.strictEqual(
      ceilingOf({ messages: [] }).ceiling.outputTokens,
      64_000,
      'the listed output limit',
    );
    assert.strictEqual(
      ceilingOf({ messages: [] }, { ...PRICE, maxCompletionTokens: null })
        .ceiling.outputTokens,
      1_000_000,
      'the context length when no output limit is listed',
    );
  },

  'a request nothing bounds is refused': async (assert) => {
    let result = aiRequestCostCeiling(JSON.stringify({ messages: [] }), {
      ...PRICE,
      maxCompletionTokens: null,
      contextLength: null,
    });
    assert.false(result.ok);
    assert.strictEqual(
      result.ok ? undefined : result.reason,
      'unbounded-output',
    );
    let set = aiRequestCostCeiling(
      JSON.stringify({ max_tokens: 10, messages: [] }),
      { ...PRICE, maxCompletionTokens: null, contextLength: null },
    );
    assert.true(set.ok, 'the request’s own limit bounds it');
  },

  'a body that isn’t a JSON object is refused': async (assert) => {
    for (let body of ['not json', '[]', 'null']) {
      let result = aiRequestCostCeiling(body, PRICE);
      assert.strictEqual(
        result.ok ? undefined : result.reason,
        'invalid-request',
        body,
      );
    }
  },

  'images, the request price and web search add to the ceiling': async (
    assert,
  ) => {
    let request = {
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in these?' },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png' },
            },
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/b.png' },
            },
          ],
        },
      ],
    };
    let plain = ceilingOf(request, { ...PRICE, webSearchUsd: 0 });
    assert.strictEqual(plain.ceiling.images, 2);
    assert.false(plain.ceiling.webSearch);
    let base =
      (bytes(plain.body) * 0.000003 + 100 * 0.000015 + 2 * 0.0048) * 1000;
    close(assert, plain.ceiling.credits, base, 'each image at the image price');

    let withRequestPrice = ceilingOf(request, {
      ...PRICE,
      webSearchUsd: 0,
      requestUsd: 0.001,
    });
    close(
      assert,
      withRequestPrice.ceiling.credits,
      base + 1,
      'the per-request price',
    );

    let plugin = ceilingOf({ ...request, plugins: [{ id: 'web' }] });
    assert.true(plugin.ceiling.webSearch, 'the web plugin searches');
    let online = ceilingOf({ ...request, model: `${PRICE.modelId}:online` });
    assert.true(online.ceiling.webSearch, 'an :online model searches');
    close(
      assert,
      online.ceiling.credits,
      (bytes(online.body) * 0.000003 + 100 * 0.000015 + 2 * 0.0048 + 0.02) *
        1000,
      'a search adds the web search price',
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
        topProvider: { contextLength: 400000, maxCompletionTokens: 128000 },
      }),
      {
        modelId: 'openai/gpt-5-nano',
        promptUsdPerToken: 0.00000005,
        completionUsdPerToken: 0.0000004,
        requestUsd: 0,
        imageUsd: 0,
        webSearchUsd: 0.01,
        maxCompletionTokens: 128000,
        contextLength: 400000,
      },
    );
    assert.strictEqual(
      readOpenRouterModelPrice({
        modelId: 'openrouter/auto',
        pricing: { prompt: '-1', completion: '-1' },
      }),
      undefined,
      'a price that isn’t a number 0 or more can’t bound a request',
    );
    assert.strictEqual(
      readOpenRouterModelPrice({ pricing: { prompt: '0' } }),
      undefined,
      'a card without a model id',
    );
    assert.strictEqual(
      readOpenRouterModelPrice({ modelId: 'x/y', contextLength: 8192 })
        ?.contextLength,
      8192,
      'the card’s context length when the top provider lists none',
    );
  },
}) as SharedTests<{}>;

export default tests;
