import QUnit from 'qunit';
const { module, test } = QUnit;
import sinon from 'sinon';
import type { Test, SuperTest } from 'supertest';
import supertest from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
const { copySync, ensureDirSync } = fsExtra;
import {
  createAutomationRun,
  getAIBatch,
  getAutomationRun,
  insertPermissions,
  ri,
  rri,
  startAutomationRunAttempt,
  finishAutomationRun,
  VirtualNetwork,
  type AutomationRun,
} from '@cardstack/runtime-common';
import { switchOnAutomation } from '@cardstack/runtime-common/automations';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  getUserByMatrixUserId,
  sumUpCreditsLedger,
} from '@cardstack/billing/billing-queries';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  fixtureDir,
  insertPlan,
  insertProxyEndpoints,
  insertUser,
  realmSecretSeed,
  runTestRealmServer,
  setupDB,
  setupSecretsKeyring,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import {
  checkPricingAtStartup,
  currentPricing,
  type PricingReporter,
} from '../lib/pricing.ts';
import { mintRunToken } from '../lib/run-token.ts';
import { OPENROUTER_MODELS_REALM } from '../lib/ai-batch-estimate.ts';

const SERVER_URL = 'http://127.0.0.1:4445/';
const MODELS_REALM_URL = `${SERVER_URL}openrouter/`;
const REALM_URL = `${SERVER_URL}payroll/`;
const REALM = ri(REALM_URL);
const AUTOMATION = rri(`${REALM_URL}Automation/nightly-sync`);
const OTHER_AUTOMATION = rri(`${REALM_URL}Automation/weekly-report`);
const PAYER = '@payer:localhost';

const MODEL = 'anthropic/claude-test';
// The model's listed price, and its batch listing at half of it, in USD per
// token, as OpenRouter lists them.
const PROMPT_USD = 0.000002;
const COMPLETION_USD = 0.00001;
const BATCH_PROMPT_USD = 0.000001;
const BATCH_COMPLETION_USD = 0.000005;

const SYSTEM_KEY = 'sk-or-v1-batches-3a7c91e0d2f4b685';

const silent: PricingReporter = {
  info() {},
  error() {},
  alert() {},
};

function pricingEnv(): Record<string, string> {
  return {
    PRICING_PRERENDER_USD_PER_VCPU_HOUR: '0.04048',
    PRICING_PRERENDER_USD_PER_MEMORY_GB_HOUR: '0.004445',
    PRICING_PRERENDER_TASK_VCPUS: '4',
    PRICING_PRERENDER_TASK_MEMORY_GB: '16',
    PRICING_PRERENDER_TASK_TABS: '8',
    PRICING_WORKER_USD_PER_VCPU_HOUR: '0.03238',
    PRICING_WORKER_USD_PER_MEMORY_GB_HOUR: '0.00356',
    PRICING_WORKER_TASK_VCPUS: '2',
    PRICING_WORKER_TASK_MEMORY_GB: '4',
    PRICING_WORKER_TASK_PROCESSES: '2',
    PRICING_USD_PER_DOWNLOADED_GB: '0.045',
    PRICING_USD_PER_FILE_STORAGE_GB_MONTH: '0.30',
    PRICING_USD_PER_DATABASE_STORAGE_GB_MONTH: '0.115',
    PRICING_MARGIN: '2',
    PRICING_MINIMUM_BALANCE_FLOOR_CREDITS: '1000',
  };
}

function declaration(
  automationId = AUTOMATION,
  batchedAI = true,
): AutomationDeclaration {
  return {
    url: automationId,
    realmURL: REALM_URL,
    script: rri(`${REALM_URL}scripts/nightly-sync.js`),
    triggers: [
      {
        kind: 'cron',
        label: 'daily',
        expression: '30 5 * * *',
        timeZone: 'America/Chicago',
      },
    ],
    operations: [],
    caps: {
      callApiCalls: 20,
      responseBytes: 1_000_000,
      resolveCalls: 5,
      aiCredits: 100,
      writes: 50,
      seconds: 300,
      dailyCredits: 100,
      monthlyCredits: 2_000,
    },
    params: {},
    batchedAI,
    batchDeadlineMinutes: 60,
  };
}

function chatBody(content: string) {
  return { messages: [{ role: 'user', content }], max_tokens: 100 };
}

// What one request costs at most at the given rates: its body's bytes as
// input tokens, and its 100-token output limit.
function requestCeilingUsd(
  body: Record<string, unknown>,
  promptUsd: number,
  completionUsd: number,
): number {
  let bytes = new TextEncoder().encode(
    JSON.stringify({ ...body, model: MODEL }),
  ).length;
  return bytes * promptUsd + 100 * completionUsd;
}

module(basename(import.meta.filename), function () {
  module('the batch path for OpenRouter batches', function (hooks) {
    let testRealmHttpServer: Server;
    let testRealm: any;
    let dbAdapter: any;
    let request: SuperTest<Test>;
    let virtualNetwork: VirtualNetwork = createVirtualNetwork();
    virtualNetwork.addRealmMapping(OPENROUTER_MODELS_REALM, MODELS_REALM_URL);

    // What the stubbed OpenRouter received, and what it answers next.
    let sent: { url: string; method: string; body: string; auth: string }[];
    let fetchStub: sinon.SinonStub;
    let submitAnswer: { status: number; body: unknown };
    let statusAnswer: { status: number; body: unknown };

    async function startRealmServer(
      dbAdapter: any,
      publisher: any,
      runner: any,
    ) {
      if (testRealm) {
        virtualNetwork.unmount(testRealm.handle);
      }
      let dir = dirSync();
      let testRealmDir = join(dir.name, 'realm_server_ai_batches', 'test');
      ensureDirSync(testRealmDir);
      copySync(fixtureDir('simple'), testRealmDir);
      ({ testRealm, testRealmHttpServer } = await runTestRealmServer({
        virtualNetwork,
        testRealmDir,
        realmsRootPath: join(dir.name, 'realm_server_ai_batches'),
        realmURL: new URL(`${SERVER_URL}test/`),
        dbAdapter,
        publisher,
        runner,
        matrixURL: new URL('http://localhost:8008'),
      }));
      request = supertest(testRealmHttpServer);
    }

    async function stopRealmServer() {
      AllowedProxyDestinations.reset();
      await closeServer(testRealmHttpServer);
    }

    let templateDatabase = setupTestDatabaseTemplate(hooks, {
      key: import.meta.filename,
      build: async ({ dbAdapter, publisher, runner }) => {
        await startRealmServer(dbAdapter, publisher, runner);
        return stopRealmServer;
      },
    });

    setupSecretsKeyring(hooks);

    let pricedBefore = currentPricing() !== undefined;
    hooks.before(function () {
      checkPricingAtStartup('ai-batches-test', pricingEnv(), silent);
    });
    hooks.after(function () {
      if (!pricedBefore) {
        // Leaves the process without prices again, as it started.
        checkPricingAtStartup('ai-batches-test', {}, silent);
      }
    });

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        await insertProxyEndpoints(dbAdapter, [
          {
            url: 'https://openrouter.ai/api/v1/batches',
            apiKey: SYSTEM_KEY,
            creditStrategy: 'no-credit',
            supportsStreaming: false,
          },
          {
            url: 'https://openrouter.ai/api/v1/',
            apiKey: 'sk-or-v1-chat-0b9d2e5f71c3a846',
            creditStrategy: 'openrouter',
            supportsStreaming: true,
          },
        ]);
        await startRealmServer(dbAdapter, publisher, runner);

        await insertUser(dbAdapter, PAYER, 'cus_payer', 'payer@example.com');
        await insertPlan(dbAdapter, 'Test Plan', 1000, 100, 'price_test');
        await insertPermissions(dbAdapter, new URL(REALM_URL), {
          [PAYER]: ['read', 'write', 'realm-owner'],
        });
        await insertModelListing(MODEL, PROMPT_USD, COMPLETION_USD);
        await insertModelListing(
          `${MODEL}:batch`,
          BATCH_PROMPT_USD,
          BATCH_COMPLETION_USD,
        );

        sent = [];
        submitAnswer = {
          status: 202,
          body: {
            id: 'batch_123',
            object: 'batch',
            endpoint: '/v1/chat/completions',
            model: MODEL,
            completion_window: '24h',
            status: 'validating',
            created_at: 1782097200,
            finalized_at: null,
            expires_at: 1782183600,
            request_counts: { total: 2, completed: 0, failed: 0 },
            usage: null,
            results: null,
            error: null,
          },
        };
        statusAnswer = {
          status: 200,
          body: {
            id: 'batch_123',
            object: 'batch',
            status: 'in_progress',
            expires_at: 1782183600,
            request_counts: { total: 2, completed: 1, failed: 0 },
            usage: null,
            results: null,
          },
        };
        fetchStub = sinon
          .stub(global, 'fetch')
          .callsFake(
            async (input: string | URL | Request, init?: RequestInit) => {
              let url = input instanceof Request ? input.url : input.toString();
              let method =
                init?.method ??
                (input instanceof Request ? input.method : 'GET');
              let headers = new Headers(
                init?.headers ??
                  (input instanceof Request ? input.headers : undefined),
              );
              let body =
                init?.body != null
                  ? String(init.body)
                  : input instanceof Request
                    ? await input.text()
                    : '';
              sent.push({
                url,
                method,
                body,
                auth: headers.get('authorization') ?? '',
              });
              let answer = method === 'POST' ? submitAnswer : statusAnswer;
              return new Response(JSON.stringify(answer.body), {
                status: answer.status,
                headers: { 'content-type': 'application/json' },
              });
            },
          );
      },
      afterEach: async () => {
        fetchStub.restore();
        await stopRealmServer();
      },
    });

    // An indexed OpenRouter model card, as the model sync writes it.
    async function insertModelListing(
      modelId: string,
      promptUsd: number,
      completionUsd: number,
    ) {
      let slug = modelId.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      let url = `${MODELS_REALM_URL}OpenRouterModel/${slug}.json`;
      await dbAdapter.execute(
        `INSERT INTO boxel_index (url, file_alias, type, generation, realm_url, pristine_doc)
         VALUES ($1, $2, 'instance', 1, $3, $4)`,
        {
          bind: [
            url,
            url.replace(/\.json$/, ''),
            MODELS_REALM_URL,
            JSON.stringify({
              type: 'card',
              attributes: {
                modelId,
                contextLength: 200_000,
                pricing: {
                  prompt: String(promptUsd),
                  completion: String(completionUsd),
                  request: null,
                },
              },
            }),
          ],
        },
      );
    }

    async function switchOn(automationId = AUTOMATION, batchedAI = true) {
      let result = await switchOnAutomation(
        dbAdapter,
        {
          automationId,
          realm: REALM,
          user: PAYER,
          declaration: declaration(automationId, batchedAI),
        },
        { matrixServerName: 'localhost', virtualNetwork: new VirtualNetwork() },
      );
      if (!result.ok) {
        throw new Error(`expected switch-on, got ${result.reason}`);
      }
    }

    // A run of the automation that an attempt has started, and its token.
    async function runningRun(
      automationId = AUTOMATION,
      slot = '2026-11-11T11:30:00.000Z',
    ): Promise<{ run: AutomationRun; token: string }> {
      let pending = await createAutomationRun(dbAdapter, {
        automationId,
        realm: REALM,
        trigger: 'daily',
        slot,
        actsAs: PAYER,
      });
      let started = await startAutomationRunAttempt(dbAdapter, pending.id, 1);
      if (started.kind !== 'run') {
        throw new Error(`expected the attempt to run, got ${started.kind}`);
      }
      let token = mintRunToken({
        realmSecretSeed,
        run: started.run,
        realmURL: REALM_URL,
        readRealms: [],
        realmServerURL: SERVER_URL,
        timeLimitSeconds: 600,
      });
      return { run: started.run, token };
    }

    function submit(token: string | undefined, body: unknown) {
      let req = request
        .post('/_ai-batches')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json');
      if (token) {
        req = req.set('Authorization', `Bearer ${token}`);
      }
      return req.send(body as object);
    }

    function twoRequests() {
      return {
        model: MODEL,
        deadlineSeconds: 3600,
        requests: [
          { customId: 'ticket-1', body: chatBody('Classify ticket one') },
          { customId: 'ticket-2', body: chatBody('Classify ticket two') },
        ],
      };
    }

    async function payerCredits(): Promise<number> {
      let user = await getUserByMatrixUserId(dbAdapter, PAYER);
      return await sumUpCreditsLedger(dbAdapter, { userId: user!.id });
    }

    test('a submit is sent with the system key, recorded for the settle job, and charges nothing', async function (assert) {
      await switchOn();
      let { run, token } = await runningRun();
      let creditsBefore = await payerCredits();
      let submittedAt = Date.now();

      let response = await submit(token, twoRequests());

      assert.strictEqual(
        response.status,
        202,
        'OpenRouter’s status is passed on',
      );
      assert.strictEqual(response.body.id, 'batch_123');

      assert.strictEqual(sent.length, 1, 'one call went to OpenRouter');
      let [call] = sent;
      assert.strictEqual(call.url, 'https://openrouter.ai/api/v1/batches');
      assert.strictEqual(call.method, 'POST');
      assert.strictEqual(call.auth, `Bearer ${SYSTEM_KEY}`);
      let body = JSON.parse(call.body);
      assert.deepEqual(
        Object.keys(body),
        ['endpoint', 'model', 'completion_window', 'requests'],
        'the requests come last, as OpenRouter requires',
      );
      assert.strictEqual(body.endpoint, '/v1/chat/completions');
      assert.strictEqual(body.completion_window, '24h');
      assert.deepEqual(body.requests, [
        {
          custom_id: 'ticket-1',
          body: { ...chatBody('Classify ticket one'), model: MODEL },
        },
        {
          custom_id: 'ticket-2',
          body: { ...chatBody('Classify ticket two'), model: MODEL },
        },
      ]);

      let batch = await getAIBatch(dbAdapter, 'batch_123');
      assert.ok(batch, 'the batch is recorded');
      assert.strictEqual(batch!.runId, run.id);
      assert.strictEqual(batch!.actsAs, PAYER, 'billed to the run’s identity');
      assert.strictEqual(batch!.realm, REALM);
      assert.strictEqual(batch!.automationId, AUTOMATION);
      assert.strictEqual(batch!.model, MODEL);
      assert.strictEqual(batch!.requestCount, 2);
      assert.strictEqual(batch!.state, 'validating');
      assert.strictEqual(
        batch!.expiresAt,
        new Date(1782183600 * 1000).toISOString(),
      );
      let deadline = Date.parse(batch!.deadline);
      assert.ok(
        deadline >= submittedAt + 3600 * 1000,
        'the deadline is the script’s wait from the submit, no earlier',
      );
      assert.ok(
        deadline <= Date.now() + 3600 * 1000,
        'the deadline is the script’s wait from the submit, no later',
      );
      let expected =
        requestCeilingUsd(
          chatBody('Classify ticket one'),
          BATCH_PROMPT_USD,
          BATCH_COMPLETION_USD,
        ) +
        requestCeilingUsd(
          chatBody('Classify ticket two'),
          BATCH_PROMPT_USD,
          BATCH_COMPLETION_USD,
        );
      assert.ok(
        Math.abs(batch!.estimatedUsd - expected) < 1e-12,
        `the estimate is each request's worst case at the batch price (${batch!.estimatedUsd} vs ${expected})`,
      );

      assert.strictEqual(
        await payerCredits(),
        creditsBefore,
        'nothing is charged at submit',
      );
      let [{ count }] = await dbAdapter.execute(
        `SELECT COUNT(*) AS count FROM credits_ledger WHERE batch_id = 'batch_123'`,
      );
      assert.strictEqual(Number(count), 0, 'no ledger entry names it');
    });

    test('a model with no batch listing is estimated at its listed price', async function (assert) {
      await dbAdapter.execute(
        `DELETE FROM boxel_index WHERE pristine_doc->'attributes'->>'modelId' = $1`,
        { bind: [`${MODEL}:batch`] },
      );
      await switchOn();
      let { token } = await runningRun();

      let response = await submit(token, {
        model: MODEL,
        deadlineSeconds: 3600,
        requests: [{ customId: 'one', body: chatBody('Hello') }],
      });

      assert.strictEqual(response.status, 202);
      let batch = await getAIBatch(dbAdapter, 'batch_123');
      let expected = requestCeilingUsd(
        chatBody('Hello'),
        PROMPT_USD,
        COMPLETION_USD,
      );
      assert.ok(
        Math.abs(batch!.estimatedUsd - expected) < 1e-12,
        `priced at the model's own listing (${batch!.estimatedUsd} vs ${expected})`,
      );
    });

    test('a batch whose cost has no bound is refused before anything is sent', async function (assert) {
      await switchOn();
      let { token } = await runningRun();

      let unknownModel = await submit(token, {
        model: 'nobody/unlisted-model',
        deadlineSeconds: 3600,
        requests: [{ customId: 'one', body: chatBody('Hello') }],
      });
      assert.strictEqual(unknownModel.status, 422);
      assert.ok(
        unknownModel.body.errors[0].includes('no listed price'),
        unknownModel.body.errors[0],
      );

      let media = await submit(token, {
        model: MODEL,
        deadlineSeconds: 3600,
        requests: [
          {
            customId: 'one',
            body: {
              ...chatBody('Describe this'),
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image_url',
                      image_url: { url: 'https://example.com/a.png' },
                    },
                  ],
                },
              ],
            },
          },
        ],
      });
      assert.strictEqual(media.status, 422);
      assert.ok(
        media.body.errors[0].startsWith('Request 1 of the batch'),
        media.body.errors[0],
      );

      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
      let [{ count }] = await dbAdapter.execute(
        'SELECT COUNT(*) AS count FROM ai_batches',
      );
      assert.strictEqual(Number(count), 0, 'nothing is recorded');
    });

    test('a call without a run token is refused', async function (assert) {
      await switchOn();

      let none = await submit(undefined, twoRequests());
      assert.strictEqual(none.status, 401);

      let session = createRealmServerJWT(
        { user: PAYER, sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );
      let interactive = await submit(session, twoRequests());
      assert.strictEqual(interactive.status, 403);
      assert.ok(
        interactive.body.errors[0].includes('only for automation runs'),
        interactive.body.errors[0],
      );

      let { run } = await runningRun();
      let forged = mintRunToken({
        realmSecretSeed: 'not the realm secret seed',
        run,
        realmURL: REALM_URL,
        readRealms: [],
        realmServerURL: SERVER_URL,
        timeLimitSeconds: 600,
      });
      let wrongKey = await submit(forged, twoRequests());
      assert.strictEqual(wrongKey.status, 401);

      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });

    test('a run of an automation that has not turned on batched AI is refused', async function (assert) {
      await switchOn(AUTOMATION, false);
      let { token } = await runningRun();

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 403);
      assert.ok(
        response.body.errors[0].includes("hasn't turned on batched AI"),
        response.body.errors[0],
      );
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });

    test('a run that has finished makes no batch calls', async function (assert) {
      await switchOn();
      let { run, token } = await runningRun();
      await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))?.state,
        'complete',
      );

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 403);
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });

    test('a deadline over 24 hours is refused', async function (assert) {
      await switchOn();
      let { token } = await runningRun();

      let response = await submit(token, {
        ...twoRequests(),
        deadlineSeconds: 24 * 60 * 60 + 1,
      });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });

    test('a batch OpenRouter refuses is not recorded', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      submitAnswer = {
        status: 402,
        body: {
          error: {
            message: 'The estimated batch cost exceeds the available balance.',
          },
        },
      };

      let response = await submit(token, twoRequests());

      assert.strictEqual(
        response.status,
        402,
        'OpenRouter’s refusal is passed on',
      );
      let [{ count }] = await dbAdapter.execute(
        'SELECT COUNT(*) AS count FROM ai_batches',
      );
      assert.strictEqual(Number(count), 0);
    });

    test('a status call returns OpenRouter’s state and records it', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await submit(token, twoRequests());
      // The follow-up run reads the batch its automation submitted.
      let followUp = await runningRun(AUTOMATION, 'batch_123');

      let response = await request
        .get('/_ai-batches/batch_123')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${followUp.token}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.status, 'in_progress');
      assert.deepEqual(response.body.request_counts, {
        total: 2,
        completed: 1,
        failed: 0,
      });
      let call = sent[sent.length - 1];
      assert.strictEqual(
        call.url,
        'https://openrouter.ai/api/v1/batches/batch_123',
      );
      assert.strictEqual(call.method, 'GET');
      assert.strictEqual(call.auth, `Bearer ${SYSTEM_KEY}`);
      assert.strictEqual(
        (await getAIBatch(dbAdapter, 'batch_123'))?.state,
        'in_progress',
      );
    });

    test('a final status is kept when an older read arrives after it', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await submit(token, twoRequests());
      statusAnswer = {
        status: 200,
        body: { id: 'batch_123', status: 'completed', expires_at: 1782183600 },
      };
      await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);
      statusAnswer = {
        status: 200,
        body: {
          id: 'batch_123',
          status: 'in_progress',
          expires_at: 1782183600,
        },
      };

      await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(
        (await getAIBatch(dbAdapter, 'batch_123'))?.state,
        'completed',
      );
    });

    test('a run reads only its own automation’s batches', async function (assert) {
      await switchOn();
      await switchOn(OTHER_AUTOMATION);
      let { token } = await runningRun();
      await submit(token, twoRequests());
      let other = await runningRun(OTHER_AUTOMATION);
      let callsBefore = sent.length;

      let response = await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${other.token}`);

      assert.strictEqual(response.status, 404);
      assert.strictEqual(
        sent.length,
        callsBefore,
        'nothing went to OpenRouter',
      );
    });

    test('_request-forward refuses OpenRouter batch URLs', async function (assert) {
      let session = createRealmServerJWT(
        { user: PAYER, sessionRoom: 'test-session-room' },
        realmSecretSeed,
      );
      for (let url of [
        'https://openrouter.ai/api/v1/batches',
        'https://openrouter.ai/api/v1/batches/batch_123',
      ]) {
        let response = await request
          .post('/_request-forward')
          .set('Accept', 'application/json')
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${session}`)
          .send({
            url,
            method: 'POST',
            requestBody: JSON.stringify(twoRequests()),
          });
        assert.strictEqual(response.status, 403, url);
      }
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });
  });
});
