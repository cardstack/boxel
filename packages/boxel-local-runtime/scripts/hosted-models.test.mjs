import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { startHostedModels } from '../src/hosted-models.ts';
import { modelBackendFromEnv } from '../../ai-bot/lib/model-backend.ts';

const localUserId = '@local:default.boxel.localhost';
const accounts = [
  {
    id: 'staging-account',
    displayName: 'Staging account',
    matrixUserId: '@owner:stack.cards',
    environment: 'staging',
  },
  {
    id: 'production-account',
    displayName: 'Production account',
    matrixUserId: '@owner:boxel.ai',
    environment: 'production',
  },
];
async function fixture(
  t,
  fetchImpl = async () => Response.json({ choices: [] }),
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'boxel-hosted-models-'));
  const authorized = [];
  const service = await startHostedModels({
    directory,
    port: 0,
    accounts: () => accounts,
    localUsers: () => [{ id: localUserId, name: 'Local user' }],
    authorize: async (profileId, environment) => {
      authorized.push({ profileId, environment });
      return {
        token: 'fixture-billing-token',
        userId: accounts.find((account) => account.id === profileId)
          .matrixUserId,
      };
    },
    fetchImpl,
  });
  t.after(async () => {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  });
  const base = new URL(service.url).origin;
  const configure = (environment, profileId, provider = 'boxel') =>
    fetch(`${base}/configuration`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, environment, localUserId, profileId }),
    });
  const complete = (body = {}, headers = {}) =>
    fetch(`${service.url}chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${service.secret}`,
        ...headers,
      },
      body: JSON.stringify({
        model: 'fixture/model',
        user: localUserId,
        messages: [{ role: 'user', content: 'hello' }],
        ...body,
      }),
    });
  return { directory, service, base, configure, complete, authorized };
}
test('defaults to Boxel credits and never silently bills an unrelated saved profile', async (t) => {
  const value = await fixture(t);
  assert.equal(value.service.provider, 'boxel');
  const response = await value.complete();
  assert.equal(response.status, 403);
  assert.equal(value.authorized.length, 0);
  const text = await response.text();
  assert.match(text, /billing account/);
  assert.ok(!text.includes(value.service.secret));
});
test('uses the selected environment and payer, streams responses, and keeps each environment binding', async (t) => {
  const calls = [];
  const value = await fixture(t, async (url, init) => {
    calls.push({
      url: String(url),
      authorization: new Headers(init.headers).get('authorization'),
      body: JSON.parse(init.body),
      redirect: init.redirect,
    });
    return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  assert.equal(
    (await value.configure('staging', 'staging-account')).status,
    200,
  );
  const response = await value.complete({ stream: true });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /DONE/);
  assert.equal(
    calls[0].url,
    'https://realms-staging.stack.cards/_openrouter/chat/completions',
  );
  assert.equal(calls[0].authorization, 'Bearer fixture-billing-token');
  assert.equal(calls[0].body.user, '@owner:stack.cards');
  assert.equal(calls[0].redirect, 'error');
  assert.equal(value.authorized[0].profileId, 'staging-account');
  await value.configure('production', 'production-account');
  const preferences = JSON.parse(
    await readFile(
      path.join(value.directory, 'model-preferences.json'),
      'utf8',
    ),
  );
  assert.equal(
    preferences.billingProfiles.staging[localUserId],
    'staging-account',
  );
  assert.equal(
    preferences.billingProfiles.production[localUserId],
    'production-account',
  );
  assert.ok(!JSON.stringify(preferences).includes('fixture-billing-token'));
});
test('rejects browser configuration requests, invalid payers and unauthenticated inference', async (t) => {
  const value = await fixture(t);
  assert.equal(
    (
      await fetch(`${value.base}/configuration`, {
        headers: { origin: 'https://untrusted.example' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await value.configure('production', 'staging-account')).status,
    422,
  );
  assert.equal(
    (await value.complete({}, { authorization: 'Bearer wrong' })).status,
    403,
  );
  assert.equal(value.authorized.length, 0);
});
test('local mode requires a restart and never falls through to paid cloud inference', async (t) => {
  const value = await fixture(t);
  const response = await value.configure('staging', 'staging-account', 'local');
  assert.equal((await response.json()).restartRequired, true);
  assert.equal((await value.complete()).status, 409);
  assert.equal(value.authorized.length, 0);
});
test('scrubs credential-bearing failures instead of reflecting them to the client', async (t) => {
  const value = await fixture(t, async () => {
    throw new Error('Bearer fixture-billing-token');
  });
  await value.configure('staging', 'staging-account');
  const response = await value.complete();
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('fixture-billing-token'));
});

test('aborts authentication when the inference client disconnects', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'boxel-model-cancel-'));
  let observed;
  const began = new Promise((resolve) => (observed = resolve));
  let wasAborted = false;
  const service = await startHostedModels({
    directory,
    port: 0,
    accounts: () => accounts,
    localUsers: () => [],
    authorize: async (_profile, _environment, signal) => {
      observed();
      return await new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            wasAborted = true;
            reject(new Error('aborted'));
          },
          { once: true },
        ),
      );
    },
  });
  t.after(async () => {
    await service.stop();
    await rm(directory, { recursive: true, force: true });
  });
  await fetch(`${new URL(service.url).origin}/configuration`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      provider: 'boxel',
      environment: 'staging',
      localUserId,
      profileId: 'staging-account',
    }),
  });
  const controller = new AbortController();
  const request = fetch(`${service.url}chat/completions`, {
    method: 'POST',
    signal: controller.signal,
    headers: { authorization: `Bearer ${service.secret}` },
    body: JSON.stringify({
      user: localUserId,
      model: 'fixture/model',
      messages: [],
    }),
  });
  await began;
  controller.abort();
  await assert.rejects(request);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(wasAborted, true);
});

test('hosted backend delegates billing and model selection to the authenticated Boxel gateway', async (t) => {
  const value = await fixture(t, async () =>
    Response.json({
      id: 'fixture',
      object: 'chat.completion',
      choices: [
        {
          message: { role: 'assistant', content: 'OK' },
          finish_reason: 'stop',
          index: 0,
        },
      ],
    }),
  );
  await value.configure('staging', 'staging-account');
  const backend = await modelBackendFromEnv({
    AI_MODEL_PROVIDER: 'boxel',
    AI_MODEL_BASE_URL: value.service.url,
    AI_MODEL_API_KEY: value.service.secret,
  });
  assert.equal(backend.billing, 'hosted-credits');
  assert.equal(backend.modelIds, null);
  const result = await backend.client.chat.completions.create({
    model: 'fixture/model',
    user: localUserId,
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(result.choices[0].message.content, 'OK');
  await assert.rejects(
    modelBackendFromEnv({
      AI_MODEL_PROVIDER: 'boxel',
      AI_MODEL_BASE_URL: 'https://remote.example/v1',
      AI_MODEL_API_KEY: 'fixture',
    }),
    /loopback/,
  );
});
