import QUnit from 'qunit';
const { module, test, assert } = QUnit;

import type { PromptParts } from '@cardstack/runtime-common/ai';
import type { Tool } from '@cardstack/base/matrix-event';
import {
  buildChatCompletionRequest,
  type ChatCompletionRequest,
} from '../lib/chat-completion-request.ts';
import { readRealmFileTool } from '../lib/bot-tools/read-realm-file/read.ts';
import { readUrlTool } from '../lib/bot-tools/read-url/read.ts';

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
    ...overrides,
  };
}

let tool: Tool = {
  type: 'function',
  function: {
    name: 'doThing',
    description: 'Does the thing',
    parameters: { type: 'object', properties: {} },
  },
};

function toolNames(request: ChatCompletionRequest) {
  return request.tools?.map(
    (t) => (t as { function: { name: string } }).function.name,
  );
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
    let request = buildChatCompletionRequest(promptParts());
    assert.deepEqual(request.provider, {
      order: ['anthropic'],
      allow_fallbacks: true,
    });
    assert.deepEqual(request.usage, { include: true });
    assert.deepEqual(request.stream_options, { include_usage: true });

    let other = buildChatCompletionRequest(
      promptParts({ model: 'openai/gpt-5.5' }),
    );
    assert.false('provider' in other);
  });

  test('sends the room tools only when the model supports them', () => {
    let withTools = buildChatCompletionRequest(
      promptParts({ tools: [tool], toolChoice: 'auto' }),
    );
    assert.deepEqual(withTools.tools, [tool]);
    assert.strictEqual(withTools.tool_choice, 'auto');

    let unsupported = buildChatCompletionRequest(
      promptParts({ tools: [tool], toolsSupported: false }),
    );
    assert.false('tools' in unsupported);
    assert.false('tool_choice' in unsupported);
  });

  test('stamps the sender as user only when one is given', () => {
    let stamped = buildChatCompletionRequest(promptParts(), '@user:localhost');
    assert.strictEqual(stamped.user, '@user:localhost');

    let anonymous = buildChatCompletionRequest(promptParts());
    assert.false('user' in anonymous);
  });

  test('offers the bot tools it is given', () => {
    let offered = buildChatCompletionRequest(promptParts(), undefined, [
      readRealmFileTool,
      readUrlTool,
    ]);
    assert.deepEqual(toolNames(offered), ['readRealmFile', 'readUrl']);

    let notOffered = buildChatCompletionRequest(promptParts(), undefined, []);
    assert.false('tools' in notOffered);
  });

  test('appends the bot tools to the room tools', () => {
    let both = buildChatCompletionRequest(
      promptParts({ tools: [tool] }),
      undefined,
      [readUrlTool],
    );
    assert.deepEqual(toolNames(both), ['doThing', 'readUrl']);
    assert.strictEqual(both.tool_choice, 'auto');
  });

  test('withholds bot tools from models without tool support', () => {
    let unsupported = buildChatCompletionRequest(
      promptParts({ toolsSupported: false }),
      undefined,
      [readRealmFileTool],
    );
    assert.false('tools' in unsupported);
  });
});
