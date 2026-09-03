import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import type { PromptParts } from '@cardstack/runtime-common/ai';
import type { Tool } from '@cardstack/base/matrix-event';
import { buildChatCompletionRequest } from '../lib/chat-completion-request.ts';

function promptParts(overrides: Partial<PromptParts> = {}): PromptParts {
  return {
    shouldRespond: true,
    tools: [],
    messages: [{ role: 'user', content: 'build a simple wedding planner app' }],
    model: 'anthropic/claude-sonnet-5',
    history: [],
    toolChoice: 'auto',
    toolsSupported: true,
    reasoningEffort: undefined,
    pendingCodePatchCorrectnessChecks: [],
    ...overrides,
  } as PromptParts;
}

module('chat completion request', () => {
  test('sends no reasoning effort when the room has none', () => {
    let request = buildChatCompletionRequest(promptParts());
    assert.false('reasoning_effort' in request);
  });

  test("forwards the room's reasoning effort", () => {
    let request = buildChatCompletionRequest(
      promptParts({ reasoningEffort: 'low' }),
    );
    assert.strictEqual(request.reasoning_effort, 'low');
  });

  test('forwards an explicit null reasoning effort as-is', () => {
    let request = buildChatCompletionRequest(
      promptParts({ reasoningEffort: null }),
    );
    assert.strictEqual(request.reasoning_effort, null);
  });

  test('requires a model', () => {
    assert.throws(
      () => buildChatCompletionRequest(promptParts({ model: undefined })),
      /Model is required/,
    );
  });

  test('biases anthropic models to the anthropic provider and requests usage', () => {
    let request = buildChatCompletionRequest(promptParts()) as Record<
      string,
      unknown
    >;
    assert.deepEqual(request.provider, {
      order: ['anthropic'],
      allow_fallbacks: true,
    });
    assert.deepEqual(request.usage, { include: true });
    assert.deepEqual(request.stream_options, { include_usage: true });

    let other = buildChatCompletionRequest(
      promptParts({ model: 'openai/gpt-5.5' }),
    ) as Record<string, unknown>;
    assert.strictEqual(other.provider, undefined);
  });

  test('omits tools unless the model supports them and stamps the sender as user', () => {
    let tool: Tool = {
      type: 'function',
      function: {
        name: 'doThing',
        description: 'Does the thing',
        parameters: { type: 'object', properties: {} },
      },
    };
    let withTools = buildChatCompletionRequest(
      promptParts({ tools: [tool], toolChoice: 'auto' }),
      '@user:localhost',
    );
    assert.deepEqual(withTools.tools, [tool]);
    assert.strictEqual(withTools.tool_choice, 'auto');
    assert.strictEqual(withTools.user, '@user:localhost');

    let unsupported = buildChatCompletionRequest(
      promptParts({ tools: [tool], toolsSupported: false }),
    );
    assert.strictEqual(unsupported.tools, undefined);
    assert.strictEqual(unsupported.user, undefined);
  });

  test('offers the readRealmFile tool only when the caller allows it', () => {
    let offered = buildChatCompletionRequest(promptParts(), undefined, true);
    assert.deepEqual(
      offered.tools?.map(
        (t) => (t as { function: { name: string } }).function.name,
      ),
      ['readRealmFile'],
    );

    let notOffered = buildChatCompletionRequest(
      promptParts(),
      undefined,
      false,
    );
    assert.strictEqual(notOffered.tools, undefined);
  });
});
