import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import QUnit from 'qunit';
import { modelBackendFromEnv } from '../lib/model-backend.ts';

const { module, test } = QUnit;

module('model backend configuration', (hooks) => {
  let server: Server;
  let baseURL: string;
  let completions: Record<string, unknown>[];
  let authorization: string | undefined;

  hooks.beforeEach(async () => {
    completions = [];
    authorization = undefined;
    server = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/models') {
        response.end(
          JSON.stringify({
            data: [{ id: 'local-small' }, { id: 'boxel-local' }],
          }),
        );
        return;
      }
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end('{}');
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      completions.push(JSON.parse(Buffer.concat(chunks).toString()));
      authorization = request.headers.authorization;
      response.end(
        JSON.stringify({
          id: 'local-completion',
          object: 'chat.completion',
          created: 1,
          model: 'boxel-local',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'local answer' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No model fixture listener');
    baseURL = `http://127.0.0.1:${address.port}/v1`;
  });
  hooks.afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  for (const phase of ['prefill', 'streaming']) {
    test(`aborting the SDK stream closes the local inference connection during ${phase}`, async (assert) => {
      assert.timeout(6000);
      let markStarted: () => void = () => {};
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      let closed: Promise<unknown> | undefined;
      server.removeAllListeners('request');
      server.on('request', (request, response) => {
        request.resume();
        request.on('end', () => {
          closed = once(response, 'close');
          if (phase === 'streaming') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.write(
              'data: ' +
                JSON.stringify({
                  id: 'cancel-test',
                  object: 'chat.completion.chunk',
                  created: 1,
                  model: 'boxel-local',
                  choices: [
                    {
                      index: 0,
                      delta: { role: 'assistant', content: 'started' },
                      finish_reason: null,
                    },
                  ],
                }) +
                '\n\n',
            );
          }
          markStarted();
        });
      });
      const backend = await modelBackendFromEnv({
        AI_MODEL_PROVIDER: 'local',
        AI_MODEL_BASE_URL: baseURL,
        AI_MODEL_IDS: '["boxel-local"]',
      });
      const runner = backend.client.chat.completions.stream({
        model: 'boxel-local',
        messages: [
          { role: 'user', content: 'Keep generating until cancelled' },
        ],
      });
      const firstChunk = new Promise<void>((resolve) =>
        runner.on('chunk', () => resolve()),
      );
      const completion = runner.finalChatCompletion();
      completion.catch(() => {});
      try {
        assert.true(
          await Promise.race([
            started.then(() => true),
            delay(2000, false, { ref: false }),
          ]),
          'the inference server received the request',
        );
        if (phase === 'streaming') {
          assert.true(
            await Promise.race([
              firstChunk.then(() => true),
              delay(2000, false, { ref: false }),
            ]),
            'the SDK consumed a provider chunk before cancellation',
          );
        }
        runner.abort();
        await assert.rejects(completion, /aborted/i);
        if (!closed)
          throw new Error('Inference connection was not established');
        assert.true(
          await Promise.race([
            closed.then(() => true),
            delay(2000, false, { ref: false }),
          ]),
          'cancellation closes the provider connection',
        );
      } finally {
        runner.abort();
      }
    });
  }

  test('discovers local models and never forwards the hosted key or OpenRouter extensions', async (assert) => {
    const backend = await modelBackendFromEnv({
      AI_MODEL_PROVIDER: 'local',
      AI_MODEL_BASE_URL: baseURL,
      AI_TITLE_MODEL: 'boxel-local',
      OPENROUTER_API_KEY: 'hosted-test-key-must-stay-hosted',
    });
    assert.strictEqual(backend.billing, 'unmetered');
    assert.strictEqual(backend.titleModel, 'boxel-local');
    assert.deepEqual(backend.modelIds, ['local-small', 'boxel-local']);
    const result = await backend.client.chat.completions.create({
      model: 'boxel-local',
      messages: [{ role: 'user', content: 'hello' }],
      tool_choice: 'auto',
      reasoning_effort: null,
      user: '@test:local',
      ...{ usage: { include: true }, provider: { order: ['anthropic'] } },
    });
    assert.strictEqual(result.choices[0].message.content, 'local answer');
    assert.strictEqual(authorization, undefined);
    assert.strictEqual(completions[0].model, 'boxel-local');
    assert.false('usage' in completions[0]);
    assert.false('provider' in completions[0]);
    assert.false('user' in completions[0]);
    assert.false('tool_choice' in completions[0]);
    assert.strictEqual(completions[0].reasoning_effort, 'none');
  });

  test('implements no-tools selection by omitting tool definitions', async (assert) => {
    const backend = await modelBackendFromEnv({
      AI_MODEL_PROVIDER: 'local',
      AI_MODEL_BASE_URL: baseURL,
      AI_MODEL_IDS: '["boxel-local"]',
    });
    await backend.client.chat.completions.create({
      model: 'boxel-local',
      messages: [{ role: 'user', content: 'hello' }],
      tool_choice: 'none',
      tools: [
        {
          type: 'function',
          function: { name: 'inspect_card', parameters: { type: 'object' } },
        },
      ],
    });
    assert.false('tools' in completions[0]);
    assert.false('tool_choice' in completions[0]);
  });

  test('rejects incomplete or contradictory local configuration before inference', async (assert) => {
    await assert.rejects(
      modelBackendFromEnv({ AI_MODEL_PROVIDER: 'local' }),
      /AI_MODEL_BASE_URL is required/,
    );
    await assert.rejects(
      modelBackendFromEnv({ AI_MODEL_PROVIDER: 'typo' }),
      /must be openrouter, boxel or local/,
    );
    await assert.rejects(
      modelBackendFromEnv({
        AI_MODEL_PROVIDER: 'local',
        AI_MODEL_BASE_URL: 'http://secret@localhost:11434/v1',
      }),
      /without credentials/,
    );
    await assert.rejects(
      modelBackendFromEnv({
        AI_MODEL_PROVIDER: 'local',
        AI_MODEL_BASE_URL: baseURL,
        AI_MODEL_IDS: '[]',
      }),
      /nonempty JSON array/,
    );
    await assert.rejects(
      modelBackendFromEnv({
        AI_MODEL_PROVIDER: 'local',
        AI_MODEL_BASE_URL: baseURL,
        AI_MODEL_IDS: '',
      }),
      /nonempty JSON array/,
    );
    await assert.rejects(
      modelBackendFromEnv({
        AI_MODEL_PROVIDER: 'local',
        AI_MODEL_BASE_URL: baseURL,
        AI_MODEL_API_KEY: '',
      }),
      /must be nonempty/,
    );
    await assert.rejects(
      modelBackendFromEnv({
        AI_MODEL_PROVIDER: 'local',
        AI_MODEL_BASE_URL: baseURL,
        AI_TITLE_MODEL: 'missing',
      }),
      /AI_TITLE_MODEL is not available/,
    );
    assert.strictEqual(completions.length, 0);
  });

  test('retains explicit hosted billing and the existing hosted title model', async (assert) => {
    const backend = await modelBackendFromEnv({
      OPENROUTER_API_KEY: 'test-key',
    });
    assert.strictEqual(backend.provider, 'openrouter');
    assert.strictEqual(backend.billing, 'credits');
    assert.strictEqual(backend.titleModel, 'gpt-4o');
    assert.strictEqual(backend.client.baseURL, 'https://openrouter.ai/api/v1');
    assert.strictEqual(backend.modelIds, null);
    await assert.rejects(
      modelBackendFromEnv({
        OPENROUTER_API_KEY: 'test-key',
        AI_MODEL_BASE_URL: baseURL,
      }),
      /require AI_MODEL_PROVIDER=local/,
    );
  });
});
