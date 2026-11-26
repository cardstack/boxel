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
  dropFinishedAIBatchRequests,
  getAIBatch,
  getAIBatchRequests,
  getAutomationRun,
  insertPermissions,
  listAIBatchesForRun,
  recordAIBatch,
  ri,
  rri,
  startAutomationRunAttempt,
  finishAutomationRun,
  revokeUserSessions,
  VirtualNetwork,
  type AutomationRun,
} from '@cardstack/runtime-common';
import {
  pauseAutomation,
  resumeAutomation,
  switchOnAutomation,
} from '@cardstack/runtime-common/automations';
import { startResumedAIBatchFollowUps } from '@cardstack/runtime-common/ai-batch-follow-ups';
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
  setupProcessPricing,
} from './helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { mintRunToken } from '../lib/run-token.ts';
import { BATCHED_AI_RESERVE_FACTOR } from '../lib/automation-ai-spending.ts';
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

function declaration(
  automationId = AUTOMATION,
  batchedAI = true,
  aiCredits = 100,
  resolveCalls = 5,
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
      resolveCalls,
      aiCredits,
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
    let submitAnswer: { status: number; body: unknown } | 'network-error';
    let statusAnswer: { status: number; body: unknown };
    // `AI_BATCH_SUBMITS_ENABLED` as the test found it.
    let submitsEnabled: string | undefined;

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

    setupProcessPricing(hooks, 'ai-batches-test');

    setupDB(hooks, {
      templateDatabase,
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        submitsEnabled = process.env.AI_BATCH_SUBMITS_ENABLED;
        process.env.AI_BATCH_SUBMITS_ENABLED = 'true';
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
              if (answer === 'network-error') {
                throw new TypeError('fetch failed');
              }
              return new Response(JSON.stringify(answer.body), {
                status: answer.status,
                headers: { 'content-type': 'application/json' },
              });
            },
          );
      },
      afterEach: async () => {
        if (submitsEnabled === undefined) {
          delete process.env.AI_BATCH_SUBMITS_ENABLED;
        } else {
          process.env.AI_BATCH_SUBMITS_ENABLED = submitsEnabled;
        }
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

    async function switchOn(
      automationId = AUTOMATION,
      batchedAI = true,
      aiCredits = 100,
      resolveCalls = 5,
    ) {
      let result = await switchOnAutomation(
        dbAdapter,
        {
          automationId,
          realm: REALM,
          user: PAYER,
          declaration: declaration(
            automationId,
            batchedAI,
            aiCredits,
            resolveCalls,
          ),
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
      { dryRun = false }: { dryRun?: boolean } = {},
    ): Promise<{ run: AutomationRun; token: string }> {
      let pending = await createAutomationRun(dbAdapter, {
        automationId,
        realm: REALM,
        trigger: dryRun ? 'manual' : 'daily',
        slot,
        actsAs: PAYER,
        dryRun,
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
        writesCap: 10,
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

      assert.ok(
        batch!.runAIReservation,
        'the batch holds a reservation on the run’s AI cap',
      );
      let reservedCredits =
        (requestCeilingUsd(
          chatBody('Classify ticket one'),
          PROMPT_USD,
          COMPLETION_USD,
        ) +
          requestCeilingUsd(
            chatBody('Classify ticket two'),
            PROMPT_USD,
            COMPLETION_USD,
          )) *
        1000 *
        BATCHED_AI_RESERVE_FACTOR;
      let held = (await getAutomationRun(dbAdapter, run.id))!.aiCreditsReserved;
      assert.ok(
        Math.abs(held - reservedCredits) < 1e-9,
        `the run holds twice its requests' worst case at the listed price (${held} vs ${reservedCredits})`,
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
        writesCap: 10,
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

    test('batch submits are on unless the realm server turns them off', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      delete process.env.AI_BATCH_SUBMITS_ENABLED;

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 202, response.text);
      assert.ok(
        await getAIBatch(dbAdapter, 'batch_123'),
        'the batch is recorded',
      );
    });

    test('a realm server that turns batch submits off refuses a submit, and still answers a status read', async function (assert) {
      await switchOn();
      let { run, token } = await runningRun();
      process.env.AI_BATCH_SUBMITS_ENABLED = 'false';

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 403);
      assert.ok(
        response.body.errors[0].includes("Batched AI isn't turned on"),
        response.body.errors[0],
      );
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
      assert.deepEqual(
        await listAIBatchesForRun(dbAdapter, run.id),
        [],
        'nothing is recorded',
      );

      await recordAIBatch(dbAdapter, {
        batchId: 'batch_123',
        runId: run.id,
        actsAs: PAYER,
        realm: REALM,
        automationId: AUTOMATION,
        model: MODEL,
        requestCount: 2,
        estimatedUsd: 0.01,
        runAIReservation: 'reservation-1',
        reservedCredits: 2,
        deadline: new Date(Date.now() + 3_600_000),
        expiresAt: null,
        state: 'validating',
      });
      let status = await request
        .get('/_ai-batches/batch_123')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(status.status, 200, 'a status read is answered');
    });

    test('each request of a batch counts against the run’s AI request cap', async function (assert) {
      await switchOn(AUTOMATION, true, 100, 5);
      let { run, token } = await runningRun();

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 202);
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))?.resolveCalls,
        2,
        'the two requests count as two AI requests',
      );
    });

    test('a run that has submitted a batch is refused a second, whichever attempt sends it', async function (assert) {
      await switchOn();
      let { token } = await runningRun();

      let first = await submit(token, twoRequests());
      assert.strictEqual(first.status, 202);
      let second = await submit(token, twoRequests());

      assert.strictEqual(second.status, 409);
      assert.ok(
        second.body.errors[0].includes('already submitted a batch'),
        second.body.errors[0],
      );
      assert.strictEqual(
        sent.filter((call) => call.method === 'POST').length,
        1,
        'one batch went to OpenRouter',
      );
    });

    test('a batch that would pass the run’s AI request cap ends the run at the cap, and nothing is sent', async function (assert) {
      await switchOn(AUTOMATION, true, 100, 1);
      let { run, token } = await runningRun();

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 403);
      assert.ok(
        response.body.errors[0].includes('resolveCalls cap'),
        response.body.errors[0],
      );
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
      let ended = await getAutomationRun(dbAdapter, run.id);
      assert.strictEqual(ended?.state, 'error');
      assert.strictEqual(ended?.errorReason, 'hit-a-cap');
      assert.strictEqual(ended?.resolveCalls, 0, 'no request was counted');
      assert.strictEqual(
        ended?.aiCreditsReserved,
        0,
        'the batch’s reservation is released',
      );
    });

    test('a Preview is refused a submit, since it sends its batched requests at the normal price', async function (assert) {
      await switchOn();
      let { token } = await runningRun(AUTOMATION, undefined, {
        dryRun: true,
      });

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 403);
      assert.ok(
        response.body.errors[0].includes('A Preview'),
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

    test('a batch that would pass the run’s AI cap is refused before anything is sent', async function (assert) {
      // Each request's worst case at the listed price is about 1.2 credits,
      // so two of them, reserved at twice that, pass a 4-credit cap.
      await switchOn(AUTOMATION, true, 4);
      let { run, token } = await runningRun();

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 403);
      assert.ok(
        response.body.errors[0].startsWith('This batch of 2 requests'),
        response.body.errors[0],
      );
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))!.aiCreditsReserved,
        0,
        'nothing is reserved',
      );
    });

    test('a batch OpenRouter refuses releases its reservation', async function (assert) {
      await switchOn();
      let { run, token } = await runningRun();
      submitAnswer = {
        status: 402,
        body: { error: { message: 'Insufficient balance.' } },
      };

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 402);
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))!.aiCreditsReserved,
        0,
      );
    });

    test('a 5xx answer to a submit is an unknown outcome: the reservation stays held', async function (assert) {
      await switchOn();
      let { run, token } = await runningRun();
      submitAnswer = { status: 524, body: { error: 'A timeout occurred' } };

      let response = await submit(token, twoRequests());

      assert.strictEqual(
        response.status,
        524,
        'OpenRouter’s answer is passed on',
      );
      let [{ count }] = await dbAdapter.execute(
        'SELECT COUNT(*) AS count FROM ai_batches',
      );
      assert.strictEqual(Number(count), 0, 'nothing is recorded');
      assert.ok(
        (await getAutomationRun(dbAdapter, run.id))!.aiCreditsReserved > 0,
        'the reservation stays held, since a batch may exist',
      );
    });

    test('a submit whose outcome is unknown keeps its reservation and records nothing', async function (assert) {
      await switchOn();
      let { run, token } = await runningRun();
      submitAnswer = 'network-error';

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 500);
      assert.strictEqual(sent.length, 1, 'the submit went out');
      let [{ count }] = await dbAdapter.execute(
        'SELECT COUNT(*) AS count FROM ai_batches',
      );
      assert.strictEqual(Number(count), 0, 'nothing is recorded');
      assert.ok(
        (await getAutomationRun(dbAdapter, run.id))!.aiCreditsReserved > 0,
        'the reservation stays held, since a batch may exist',
      );
    });

    test('a run token whose person’s sessions were revoked is refused', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await revokeUserSessions(dbAdapter, PAYER);
      // A revocation counts against tokens minted before it, by the second.
      await dbAdapter.execute(
        `UPDATE users SET sessions_revoked_at = sessions_revoked_at + 5 WHERE matrix_user_id = $1`,
        { bind: [PAYER] },
      );

      let response = await submit(token, twoRequests());

      assert.strictEqual(response.status, 401);
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });

    test('a run whose person loses direct write mid-run is refused its next batch call, which ends the run', async function (assert) {
      await switchOn();
      let { token, run } = await runningRun();
      let submitted = await submit(token, twoRequests());
      assert.strictEqual(submitted.status, 202, submitted.text);
      let sentBefore = sent.length;
      await dbAdapter.execute(
        `UPDATE realm_user_permissions SET write = false WHERE realm_url = $1 AND username = $2`,
        { bind: [REALM_URL, PAYER] },
      );

      let refused = await submit(token, twoRequests());
      assert.strictEqual(refused.status, 403, refused.text);
      let row = await getAutomationRun(dbAdapter, run.id);
      assert.deepEqual(
        [row?.state, row?.errorReason],
        ['error', 'not-a-direct-writer'],
        'the refused submit ended the run',
      );
      let status = await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(
        status.status,
        403,
        `the ended run reads no batch: ${status.text}`,
      );
      assert.strictEqual(
        sent.length,
        sentBefore,
        'nothing more went to OpenRouter',
      );
    });

    test('a status read needs no batched AI opt-in, so a follow-up can read a paid batch', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await submit(token, twoRequests());
      await dbAdapter.execute(
        `UPDATE automations SET caps_snapshot = jsonb_set(caps_snapshot, '{batchedAI}', 'false') WHERE automation_id = $1`,
        { bind: [AUTOMATION] },
      );

      let refused = await submit(token, twoRequests());
      assert.strictEqual(refused.status, 403, 'a submit still needs it');

      let response = await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.status, 'in_progress');
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

    test('a batch that ended before its deadline passes on its results', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await submit(token, twoRequests());
      let finalizedAt = Math.floor(Date.now() / 1000) - 60;
      statusAnswer = {
        status: 200,
        body: {
          id: 'batch_123',
          status: 'completed',
          finalized_at: finalizedAt,
          results: [{ custom_id: 'ticket-1', response: { status_code: 200 } }],
        },
      };

      let response = await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(response.status, 200);
      assert.deepEqual(response.body.results, [
        { custom_id: 'ticket-1', response: { status_code: 200 } },
      ]);
      assert.strictEqual(
        (await getAIBatch(dbAdapter, 'batch_123'))?.finalizedAt,
        new Date(finalizedAt * 1000).toISOString(),
        "OpenRouter's time is recorded as when the batch ended",
      );
    });

    // Moves the batch's deadline into the past, as if the script's wait had
    // run out.
    async function deadlinePassed() {
      await dbAdapter.execute(
        `UPDATE ai_batches SET deadline = now() - interval '1 minute' WHERE batch_id = 'batch_123'`,
      );
    }

    function completedAnswer() {
      return {
        status: 200,
        body: {
          id: 'batch_123',
          status: 'completed',
          finalized_at: Math.floor(Date.now() / 1000),
          request_counts: { total: 2, completed: 2, failed: 0 },
          results: [{ custom_id: 'ticket-1', response: { status_code: 200 } }],
        },
      };
    }

    test('a batch a run found still open past its deadline has its results discarded once it ends', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await submit(token, twoRequests());
      await deadlinePassed();
      // The follow-up reads the batch still running, so it falls back to the
      // normal price.
      await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);
      assert.ok(
        (await getAIBatch(dbAdapter, 'batch_123'))?.deadlineMissedAt,
        'the batch is recorded as late',
      );
      statusAnswer = completedAnswer();

      let response = await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.status, 'completed');
      assert.strictEqual(
        response.body.results,
        null,
        'its results are withheld',
      );
      assert.deepEqual(
        response.body.request_counts,
        { total: 2, completed: 2, failed: 0 },
        'the rest of the batch is passed on',
      );
    });

    test('a batch that ended before a run read it past its deadline passes on its results', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await submit(token, twoRequests());
      await deadlinePassed();
      statusAnswer = completedAnswer();

      let response = await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        response.body.results,
        [{ custom_id: 'ticket-1', response: { status_code: 200 } }],
        'the follow-up that finds it ended uses its results',
      );
      assert.strictEqual(
        (await getAIBatch(dbAdapter, 'batch_123'))?.deadlineMissedAt,
        null,
        'the batch is not late',
      );
    });

    test('a batch read still open before its deadline is not late', async function (assert) {
      await switchOn();
      let { token } = await runningRun();
      await submit(token, twoRequests());

      await request
        .get('/_ai-batches/batch_123')
        .set('Authorization', `Bearer ${token}`);

      assert.strictEqual(
        (await getAIBatch(dbAdapter, 'batch_123'))?.deadlineMissedAt,
        null,
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

    // The follow-up run of `batch_123`, started by an attempt, and its token.
    async function followUpRun(): Promise<{
      run: AutomationRun;
      token: string;
    }> {
      let pending = await createAutomationRun(dbAdapter, {
        automationId: AUTOMATION,
        realm: REALM,
        trigger: 'batch',
        slot: 'batch_123',
        actsAs: PAYER,
      });
      return await started(pending.id);
    }

    async function started(
      runId: string,
    ): Promise<{ run: AutomationRun; token: string }> {
      let attempt = await startAutomationRunAttempt(dbAdapter, runId, 1);
      if (attempt.kind !== 'run') {
        throw new Error(`expected the attempt to run, got ${attempt.kind}`);
      }
      let token = mintRunToken({
        realmSecretSeed,
        run: attempt.run,
        realmURL: REALM_URL,
        readRealms: [],
        writesCap: 10,
        realmServerURL: SERVER_URL,
        timeLimitSeconds: 600,
      });
      return { run: attempt.run, token };
    }

    function readFollowUp(token: string) {
      return request
        .get('/_ai-batches/batch_123/follow-up')
        .set('Accept', 'application/json')
        .set('Authorization', `Bearer ${token}`);
    }

    // A submitting run whose script planned three milestones, and the batch
    // it submitted in the second.
    async function submitPlanned() {
      await switchOn();
      let { run, token } = await runningRun();
      await dbAdapter.execute(
        `UPDATE automation_runs SET milestone_plan = ARRAY['fetch tickets', 'classify tickets', 'save labels'] WHERE id = $1`,
        { bind: [run.id] },
      );
      let response = await submit(token, {
        ...twoRequests(),
        milestone: 'classify tickets',
      });
      if (response.status !== 202) {
        throw new Error(`expected a submit, got ${response.status}`);
      }
      return run;
    }

    function completedWith(results: unknown[]) {
      return {
        status: 200,
        body: {
          id: 'batch_123',
          status: 'completed',
          finalized_at: Math.floor(Date.now() / 1000),
          request_counts: { total: 2, completed: 2, failed: 0 },
          results,
        },
      };
    }

    function chatAnswer(content: string) {
      return {
        status_code: 200,
        body: {
          model: MODEL,
          choices: [{ message: { content }, finish_reason: 'stop' }],
        },
      };
    }

    test('a submit keeps the batch’s requests and its milestone for its follow-up', async function (assert) {
      await submitPlanned();

      let batch = await getAIBatch(dbAdapter, 'batch_123');
      assert.strictEqual(batch?.milestone, 'classify tickets');
      assert.deepEqual(
        await getAIBatchRequests(dbAdapter, 'batch_123'),
        twoRequests().requests.map(({ customId, body }) => ({
          customId,
          body: { ...body, model: MODEL },
        })),
        'each request is kept as it was sent, in its order',
      );
    });

    test('a milestone past the longest name a run milestone may have is refused', async function (assert) {
      await switchOn();
      let { token } = await runningRun();

      let response = await submit(token, {
        ...twoRequests(),
        milestone: 'm'.repeat(81),
      });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });

    test('the follow-up of a completed batch gets each request’s result by its customId, and carries on the submitting run’s milestones', async function (assert) {
      await submitPlanned();
      await deadlinePassed();
      let { run, token } = await followUpRun();
      statusAnswer = completedWith([
        {
          custom_id: 'ticket-2',
          response: null,
          error: { message: 'max_tokens is greater than the model limit' },
        },
        { custom_id: 'ticket-1', response: chatAnswer('{"label":"bug"}') },
      ]);

      let response = await readFollowUp(token);

      assert.strictEqual(response.status, 200, response.text);
      let read = response.body;
      assert.false(read.late, 'the batch’s results are used');
      assert.strictEqual(read.state, 'completed');
      assert.strictEqual(read.id, 'batch_123');
      assert.strictEqual(read.milestone, 'classify tickets');
      assert.deepEqual(
        read.plan,
        ['classify tickets', 'save labels'],
        'the plan from the batch’s milestone on',
      );
      assert.deepEqual(
        read.requests[0].answer,
        chatAnswer('{"label":"bug"}').body,
        'the first request gets its result, though it came second',
      );
      assert.deepEqual(read.requests[0].body, {
        ...chatBody('Classify ticket one'),
        model: MODEL,
      });
      assert.true(
        /max_tokens is greater than the model limit/.test(
          read.requests[1].error,
        ),
        'a request the batch failed keeps its error',
      );
      assert.strictEqual(
        (await getAIBatch(dbAdapter, 'batch_123'))?.deadlineMissedAt,
        null,
        'the batch is not late',
      );
      let lines = await dbAdapter.execute(
        `SELECT message FROM automation_run_log WHERE run_id = $1`,
        { bind: [run.id] },
      );
      assert.true(
        lines.some((line: { message: string }) =>
          /completed, and this run picks up its 2 results/.test(line.message),
        ),
        'the run’s log says the batch completed',
      );
    });

    test('the follow-up of a batch still open past its deadline gets its requests to send at the normal price, and the batch is late from then on', async function (assert) {
      await submitPlanned();
      await deadlinePassed();
      let { token } = await followUpRun();

      let response = await readFollowUp(token);

      assert.strictEqual(response.status, 200, response.text);
      assert.true(response.body.late, 'the answers are late');
      assert.strictEqual(response.body.state, 'in_progress');
      assert.deepEqual(
        response.body.requests,
        twoRequests().requests.map(({ body }) => ({
          body: { ...body, model: MODEL },
        })),
        'each request carries its body and no answer',
      );
      assert.ok(
        (await getAIBatch(dbAdapter, 'batch_123'))?.deadlineMissedAt,
        'the batch is late, so its results are never used',
      );

      statusAnswer = completedWith([
        { custom_id: 'ticket-1', response: chatAnswer('{"label":"bug"}') },
      ]);
      let again = await readFollowUp(token);
      assert.true(
        again.body.late,
        'a batch that ends after it was found late still gives no results',
      );
      assert.strictEqual(again.body.requests[0].answer, undefined);
    });

    test('the follow-up of a batch that failed or expired gets its requests to send at the normal price', async function (assert) {
      await submitPlanned();
      let { token } = await followUpRun();
      for (let status of ['failed', 'expired']) {
        statusAnswer = {
          status: 200,
          body: { id: 'batch_123', status, results: null },
        };

        let response = await readFollowUp(token);

        assert.strictEqual(response.status, 200, response.text);
        assert.true(response.body.late, `a batch that ${status} is late`);
        assert.strictEqual(response.body.state, status);
        assert.strictEqual(response.body.requests.length, 2);
        assert.ok(response.body.requests[1].body);
      }
    });

    test('a follow-up a pause held and a resume started past its deadline uses the batch’s results while OpenRouter holds them, and otherwise falls back', async function (assert) {
      let submitting = await submitPlanned();
      await finishAutomationRun(dbAdapter, submitting.id, 1, {
        state: 'complete',
      });
      let options = {
        matrixServerName: 'localhost',
        virtualNetwork: new VirtualNetwork(),
      };
      let paused = await pauseAutomation(
        dbAdapter,
        { automationId: AUTOMATION, user: PAYER },
        options,
      );
      assert.true(paused.ok);
      await deadlinePassed();
      let resumed = await resumeAutomation(
        dbAdapter,
        {
          automationId: AUTOMATION,
          user: PAYER,
          declaration: declaration(),
          admit: async () => undefined,
        },
        options,
      );
      assert.true(resumed.ok);
      let recordingQueue = {
        publish: async () => ({ id: 1, done: new Promise(() => {}) }) as any,
        destroy: async () => {},
      };
      let [outcome] = await startResumedAIBatchFollowUps(
        dbAdapter,
        AUTOMATION,
        {
          // A queue that records the follow-up's job rather than running it,
          // so this test's attempt owns the run.
          queue: recordingQueue,
          virtualNetwork,
        },
      );
      if (outcome?.kind !== 'started') {
        throw new Error(
          `expected the follow-up to start, got ${outcome?.kind}`,
        );
      }
      let { token } = await started(outcome.runId);

      statusAnswer = completedWith([
        { custom_id: 'ticket-1', response: chatAnswer('{"label":"bug"}') },
        { custom_id: 'ticket-2', response: chatAnswer('{"label":"idea"}') },
      ]);
      let completed = await readFollowUp(token);
      assert.strictEqual(completed.status, 200, completed.text);
      assert.false(
        completed.body.late,
        'the completed batch’s results are used',
      );
      assert.deepEqual(
        completed.body.requests.map(
          (entry: {
            answer: { choices: { message: { content: string } }[] };
          }) => entry.answer.choices[0].message.content,
        ),
        ['{"label":"bug"}', '{"label":"idea"}'],
      );

      statusAnswer = {
        status: 410,
        body: {
          error: { code: 410, message: 'Batch results have expired' },
        },
      };
      let gone = await readFollowUp(token);
      assert.strictEqual(gone.status, 200, gone.text);
      assert.true(
        gone.body.late,
        'once OpenRouter no longer holds the batch, its requests are sent at the normal price',
      );
      assert.strictEqual(gone.body.state, 'gone');
      assert.ok(gone.body.requests[0].body);
    });

    test('only the batch’s own follow-up reads it for its results', async function (assert) {
      await submitPlanned();
      let { token } = await runningRun(AUTOMATION, '2026-11-12T11:30:00.000Z');
      let callsBefore = sent.length;

      let response = await readFollowUp(token);

      assert.strictEqual(response.status, 403);
      assert.strictEqual(
        sent.length,
        callsBefore,
        'nothing went to OpenRouter',
      );
    });

    test('a batch’s requests are dropped once its follow-up has ended, and kept while it hasn’t', async function (assert) {
      await submitPlanned();
      let { run } = await followUpRun();

      await dropFinishedAIBatchRequests(dbAdapter);
      assert.ok(
        await getAIBatchRequests(dbAdapter, 'batch_123'),
        'a running follow-up may still send them',
      );

      await finishAutomationRun(dbAdapter, run.id, 1, { state: 'complete' });
      await dropFinishedAIBatchRequests(dbAdapter);
      assert.strictEqual(
        await getAIBatchRequests(dbAdapter, 'batch_123'),
        undefined,
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
        'https://openrouter.ai/api/v1/%62atches',
        'https://openrouter.ai/api/v1/batche%73/batch_123',
        'https://openrouter.ai/api/v1/%E0%A4%A',
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
        // The payer has no credits, so the per-call path would refuse with
        // a 403 too; the message says the batch guard refused it.
        assert.ok(
          response.body.errors[0].includes(
            'accepted only from automation runs',
          ),
          `${url}: ${response.body.errors[0]}`,
        );
      }
      assert.strictEqual(sent.length, 0, 'nothing went to OpenRouter');
    });
  });
});
