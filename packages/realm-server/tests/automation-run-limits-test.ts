import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import sinon from 'sinon';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  getAutomationRun,
  rri,
  SupportedMimeType,
  type Realm,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { HIT_A_CAP_REASON } from '@cardstack/runtime-common/automation-runs';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import {
  automationFixture,
  createAutomationRunToken,
  insertPlan,
  insertProxyEndpoints,
  insertUser,
  setupPermissionedRealmCached,
  setupSecretsKeyring,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { startStubVendor, type StubVendor } from './helpers/stub-vendor.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { AllowedProxyDestinations } from '../lib/allowed-proxy-destinations.ts';
import { OPENROUTER_MODELS_REALM } from '../lib/openrouter-model-price.ts';
import { OPENROUTER_CHAT_COMPLETIONS_URL } from '../lib/run-token-forward.ts';

// An automation run's calls are held to its automation card's declaration:
// a `callApi` for an operation the card doesn't declare is refused, and the
// run's `callApi` calls, the response bytes they read, its `resolve` calls
// and their AI spending are counted on the run row against the card's caps.
// A call past a cap is refused and ends the run.

const realmURL = new URL('http://127.0.0.1:4444/automation-run-limits-test/');
const MODELS_REALM_URL = 'http://127.0.0.1:4444/openrouter/';
const VENDOR_PORT = 4541;
const VENDOR = `http://127.0.0.1:${VENDOR_PORT}`;
const OPERATIONS = SupportedMimeType.BoxelOperations;
const OWNER = '@limits-owner:localhost';
const REALM_USER = '@node-test_realm:localhost';
const FEED = { module: rri(`${realmURL.href}feed`), name: 'Feed' };
const MODEL = 'anthropic/claude-limits-test';

// Each automation's card, by its path in the realm.
const ROOMY = 'automation/roomy';
const TIGHT = 'automation/tight';
const NO_AI = 'automation/no-ai';

const feedModule = `
  import { CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";

  export class Feed extends CardDef {
    @operation static latest = {
      base: 'callApi',
      url: '${VENDOR}/status/200',
    };

    @operation static large = {
      base: 'callApi',
      params: { bytes: StringField },
      url: '${VENDOR}/large',
      query: { bytes: params('bytes') },
    };

    @operation static undeclared = {
      base: 'callApi',
      url: '${VENDOR}/status/200',
    };
  }
`;

module(basename(import.meta.filename), function (hooks) {
  setupCatalogTestSubset(hooks);

  let realm: Realm;
  let request: SuperTest<Test>;
  let dbAdapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let vendor: StubVendor;

  hooks.before(async function () {
    vendor = await startStubVendor({ port: VENDOR_PORT });
  });
  hooks.after(async function () {
    await vendor.close();
  });

  hooks.beforeEach(function () {
    configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
  });
  hooks.afterEach(function () {
    resetOutbound();
    AllowedProxyDestinations.reset();
  });

  const declared = [{ type: FEED, names: ['latest', 'large'] }];

  // Proxy endpoints' keys are sealed as they are written.
  setupSecretsKeyring(hooks);

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      'feed.gts': feedModule,
      ...automationFixture({ operations: declared, path: ROOMY }),
      ...automationFixture({
        operations: declared,
        path: TIGHT,
        caps: { callApiCalls: 1, responseBytes: 200, resolveCalls: 1 },
      }),
      ...automationFixture({
        operations: declared,
        path: NO_AI,
        caps: { aiCredits: 0 },
      }),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      request = args.request;
      dbAdapter = args.dbAdapter as PgAdapter;
      virtualNetwork = args.virtualNetwork;
      vendor.requests.length = 0;
    },
  });

  async function runOf(automation: string) {
    return await createAutomationRunToken(dbAdapter, realm, OWNER, {
      automation,
    });
  }

  async function callApi(
    token: string,
    name: string,
    params: Record<string, unknown> = {},
  ) {
    let response = (await realm.handleAutomation(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: OPERATIONS,
          'Content-Type': OPERATIONS,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          'boxel:operations': [
            {
              op: 'invoke',
              'boxel:name': name,
              data: { ...params, meta: { adoptsFrom: FEED } },
            },
          ],
        }),
      }),
    ))!;
    let text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, body };
  }

  function errorOf(body: any) {
    return body.errors?.[0] ?? body['boxel:results']?.[0]?.error ?? body;
  }

  test('a run calls a declared operation within its caps, and its row counts the call and the bytes it read', async function (assert) {
    let { token, run } = await runOf(ROOMY);
    let answer = await callApi(token, 'latest');
    assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));
    assert.strictEqual(vendor.requests.length, 1, 'the vendor was called');

    let row = (await getAutomationRun(dbAdapter, run.id))!;
    assert.strictEqual(row.state, 'running');
    assert.strictEqual(row.callApiCalls, 1);
    assert.true(
      row.callApiResponseBytes > 0,
      `the response's ${row.callApiResponseBytes} bytes are counted`,
    );
  });

  test('a run is refused an operation its automation does not declare, and nothing is sent', async function (assert) {
    let { token, run } = await runOf(ROOMY);
    let answer = await callApi(token, 'undeclared');
    let error = errorOf(answer.body);
    assert.strictEqual(
      error.code,
      'operation-not-declared',
      JSON.stringify(answer.body),
    );
    assert.strictEqual(vendor.requests.length, 0, 'the vendor was not called');

    let row = (await getAutomationRun(dbAdapter, run.id))!;
    assert.strictEqual(row.state, 'running', 'the run goes on');
    assert.strictEqual(row.callApiCalls, 0, 'a refused call is not counted');
  });

  test('a run of a card that is not indexed may call nothing', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let answer = await callApi(token, 'latest');
    assert.strictEqual(
      errorOf(answer.body).code,
      'operation-not-declared',
      JSON.stringify(answer.body),
    );
    assert.strictEqual(vendor.requests.length, 0);
  });

  test('a call past the callApiCalls cap is refused and ends the run', async function (assert) {
    let { token, run } = await runOf(TIGHT);
    let first = await callApi(token, 'latest');
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));

    let second = await callApi(token, 'latest');
    let error = errorOf(second.body);
    assert.strictEqual(
      error.code,
      'run-cap-reached',
      JSON.stringify(second.body),
    );
    assert.strictEqual(error.meta?.cap, 'callApiCalls');
    assert.strictEqual(vendor.requests.length, 1, 'only the first was sent');

    let row = (await getAutomationRun(dbAdapter, run.id))!;
    assert.strictEqual(row.state, 'error');
    assert.strictEqual(row.errorReason, HIT_A_CAP_REASON);
    assert.true(
      row.errorMessage?.includes('callApiCalls'),
      `the run names the cap: ${row.errorMessage}`,
    );
    assert.strictEqual(row.callApiCalls, 1);

    let after = await callApi(token, 'latest');
    assert.strictEqual(after.status, 401, 'the ended run makes no more calls');
  });

  test('a response past the responseBytes cap is refused and ends the run', async function (assert) {
    let { token, run } = await runOf(TIGHT);
    let answer = await callApi(token, 'large', { bytes: '500' });
    let error = errorOf(answer.body);
    assert.strictEqual(
      error.code,
      'run-cap-reached',
      JSON.stringify(answer.body),
    );
    assert.strictEqual(error.meta?.cap, 'responseBytes');

    let row = (await getAutomationRun(dbAdapter, run.id))!;
    assert.strictEqual(row.state, 'error');
    assert.strictEqual(row.errorReason, HIT_A_CAP_REASON);
    assert.true(row.errorMessage?.includes('responseBytes'));
    assert.true(
      row.callApiResponseBytes <= 200,
      `no more than the cap is counted: ${row.callApiResponseBytes}`,
    );
  });

  test('a response within the responseBytes cap is read whole', async function (assert) {
    let { token, run } = await runOf(TIGHT);
    let answer = await callApi(token, 'large', { bytes: '150' });
    assert.strictEqual(answer.status, 200, JSON.stringify(answer.body));
    let row = (await getAutomationRun(dbAdapter, run.id))!;
    assert.strictEqual(row.state, 'running');
    assert.strictEqual(row.callApiResponseBytes, 150);
  });

  module('resolve calls', function (hooks) {
    let fetchStub: sinon.SinonStub;
    let forwarded: string[];

    hooks.beforeEach(async function () {
      if (!virtualNetwork.isRegisteredPrefix(OPENROUTER_MODELS_REALM)) {
        virtualNetwork.addRealmMapping(
          OPENROUTER_MODELS_REALM,
          MODELS_REALM_URL,
        );
      }
      await insertProxyEndpoints(dbAdapter, [
        {
          url: OPENROUTER_CHAT_COMPLETIONS_URL,
          apiKey: 'sk-or-v1-limits-9f2c4e7a1b3d5068',
          creditStrategy: 'openrouter',
          supportsStreaming: true,
        },
      ]);
      // The realm's permissions gave the owner a user row; it needs a plan and
      // credits to be billed for a forward.
      if (!(await getUserByMatrixUserId(dbAdapter, OWNER))) {
        await insertUser(dbAdapter, OWNER, 'cus_limits', 'limits@example.com');
      }
      await insertPlan(dbAdapter, 'Test Plan', 1000, 100, 'price_limits');
      let user = await getUserByMatrixUserId(dbAdapter, OWNER);
      await addToCreditsLedger(dbAdapter, {
        userId: user!.id,
        creditAmount: 1000,
        creditType: 'extra_credit',
        subscriptionCycleId: null,
      });
      await insertModelListing(MODEL, 0.000002, 0.00001);

      forwarded = [];
      let realFetch = global.fetch;
      fetchStub = sinon
        .stub(global, 'fetch')
        .callsFake(
          async (input: string | URL | Request, init?: RequestInit) => {
            let url = input instanceof Request ? input.url : input.toString();
            if (url !== OPENROUTER_CHAT_COMPLETIONS_URL) {
              return await realFetch(input, init);
            }
            forwarded.push(String(init?.body ?? ''));
            return new Response(
              JSON.stringify({
                id: 'gen-limits-1',
                choices: [{ message: { content: '{}' } }],
                usage: { total_tokens: 20, cost: 0.0001 },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            );
          },
        );
    });
    hooks.afterEach(function () {
      fetchStub.restore();
    });

    async function insertModelListing(
      modelId: string,
      promptUsd: number,
      completionUsd: number,
    ) {
      await dbAdapter.execute(
        `INSERT INTO boxel_index (url, file_alias, type, generation, realm_url, pristine_doc)
         VALUES ($1, $2, 'instance', 1, $3, $4)`,
        {
          bind: [
            `${MODELS_REALM_URL}OpenRouterModel/limits-test.json`,
            `${MODELS_REALM_URL}OpenRouterModel/limits-test`,
            MODELS_REALM_URL,
            JSON.stringify({
              attributes: {
                modelId,
                contextLength: 8000,
                pricing: {
                  prompt: String(promptUsd),
                  completion: String(completionUsd),
                },
              },
            }),
          ],
        },
      );
    }

    async function resolve(token: string) {
      return await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${token}`)
        .send({
          url: OPENROUTER_CHAT_COMPLETIONS_URL,
          method: 'POST',
          requestBody: JSON.stringify({
            model: MODEL,
            max_tokens: 100,
            messages: [{ role: 'user', content: 'Summarize the feed' }],
          }),
        });
    }

    test('a resolve within the caps is forwarded, counted, and its AI cost settled on the run', async function (assert) {
      let { token, run } = await runOf(ROOMY);
      let response = await resolve(token);
      assert.strictEqual(response.status, 200, JSON.stringify(response.body));
      assert.strictEqual(forwarded.length, 1);

      let row = (await getAutomationRun(dbAdapter, run.id))!;
      assert.strictEqual(row.state, 'running');
      assert.strictEqual(row.resolveCalls, 1);
      assert.strictEqual(row.aiCreditsReserved, 0, 'nothing is left reserved');
      assert.true(
        row.aiCreditsSpent > 0,
        `the generation's cost is spent: ${row.aiCreditsSpent}`,
      );
    });

    test('a resolve past the resolveCalls cap is refused and ends the run', async function (assert) {
      let { token, run } = await runOf(TIGHT);
      assert.strictEqual((await resolve(token)).status, 200);

      let second = await resolve(token);
      assert.strictEqual(second.status, 403, JSON.stringify(second.body));
      assert.strictEqual(forwarded.length, 1, 'only the first was forwarded');

      let row = (await getAutomationRun(dbAdapter, run.id))!;
      assert.strictEqual(row.state, 'error');
      assert.strictEqual(row.errorReason, HIT_A_CAP_REASON);
      assert.true(row.errorMessage?.includes('resolveCalls'));
      assert.strictEqual(row.resolveCalls, 1);
      assert.strictEqual(
        row.aiCreditsReserved,
        0,
        "the refused request's reservation is released",
      );
    });

    test('a resolve past the aiCredits cap is refused and ends the run', async function (assert) {
      let { token, run } = await runOf(NO_AI);
      let response = await resolve(token);
      assert.strictEqual(response.status, 403, JSON.stringify(response.body));
      assert.strictEqual(forwarded.length, 0, 'nothing was forwarded');

      let row = (await getAutomationRun(dbAdapter, run.id))!;
      assert.strictEqual(row.state, 'error');
      assert.strictEqual(row.errorReason, HIT_A_CAP_REASON);
      assert.true(row.errorMessage?.includes('aiCredits'));
      assert.strictEqual(
        row.resolveCalls,
        0,
        'a refused request is not counted',
      );
    });

    test('a run may forward only a chat completion to OpenRouter', async function (assert) {
      let { token } = await runOf(ROOMY);
      let response = await request
        .post('/_request-forward')
        .set('Accept', 'application/json')
        .set('Content-Type', 'application/json')
        .set('Authorization', `Bearer ${token}`)
        .send({
          url: OPENROUTER_CHAT_COMPLETIONS_URL,
          method: 'POST',
          stream: true,
          requestBody: JSON.stringify({ model: MODEL, messages: [] }),
        });
      assert.strictEqual(response.status, 403, JSON.stringify(response.body));
      assert.strictEqual(forwarded.length, 0);
    });
  });
});
