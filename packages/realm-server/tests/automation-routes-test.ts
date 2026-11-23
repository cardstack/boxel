import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  addToCreditsLedger,
  getUserByMatrixUserId,
} from '@cardstack/billing/billing-queries';
import {
  archiveRealm,
  createAutomationRun,
  getAutomationRun,
  ri,
  rri,
  type AutomationRun,
  type Realm,
  type SpendCharge,
} from '@cardstack/runtime-common';
import { getAutomation } from '@cardstack/runtime-common/automations';
import {
  appendRunLog,
  type RunLogLine,
} from '@cardstack/runtime-common/automation-run-log';
import {
  followAutomationRunLog,
  type AutomationRunLogPage,
} from '@cardstack/runtime-common/automation-run-log-follow';
import {
  AUTOMATION_PAUSE_PATH,
  AUTOMATION_PREVIEW_PATH,
  AUTOMATION_REMOVE_PATH,
  AUTOMATION_RESUME_PATH,
  AUTOMATION_RUN_CANCEL_PATH,
  AUTOMATION_RUN_LOG_PATH,
  AUTOMATION_RUN_NOW_PATH,
  AUTOMATION_SWITCH_ON_PATH,
} from '@cardstack/runtime-common/automation-routes';
import {
  automationFixture,
  createAutomationRunToken,
  ensureTestUser,
  insertIncomingWebhookRow,
  realmSecretSeed,
  ROOMY_AUTOMATION_CAPS,
  setupPermissionedRealmCached,
  setupSecretsKeyring,
  testAccountStandings,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import { addUserKey, mintKeyWriteTicket } from '../lib/user-keys.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import {
  checkPricingAtStartup,
  currentPricing,
  type PricingReporter,
} from '../lib/pricing.ts';
import { runCostCeiling } from '../lib/automation-estimate.ts';

// The realm-server routes a direct writer drives an automation with: the
// switch-on estimate, switch-on, Preview, Run now, pause, resume, remove and
// cancel. Each acts as the session's own user, and answers only a direct
// writer of the realm the request names.

const realmURL = new URL('http://127.0.0.1:4444/automation-routes-test/');
const secureOriginURL = new URL('https://secure.automation-routes.test/secure');
const OWNER = '@automation-routes-owner:localhost';
const WRITER = '@automation-routes-writer:localhost';
const READER = '@automation-routes-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';

const DAILY = 'automation/daily';
const NO_MONTHLY_CAP = 'automation/no-monthly-cap';
const HOOKED = 'automation/hooked';
const BATCHED = 'automation/batched';
const HOOK_PATH = 'whk_routes';
const OUTSIDER = '@automation-routes-outsider:localhost';
// Automations whose daily credit cap the tests reach: one with a webhook
// trigger, whose first run after a resume can start at once, and one whose
// next run is next new year's day.
const CAPPED = 'automation/capped';
const CAPPED_HOOK_PATH = 'whk_routes_capped';
const CAPPED_LATER = 'automation/capped-later';
const DAILY_CAP = 600;
// An automation whose script doesn't parse.
const BROKEN = 'automation/broken';
// An automation declaring an operation whose request carries the payer's
// own key, so each payer needs their own binding for it.
const KEYED = 'automation/keyed';
const VENDOR = 'http://127.0.0.1:4547';
const INBOX = { module: `${realmURL.href}inbox`, name: 'Inbox' };
const inboxModule = `
  import { CardDef } from "@cardstack/base/card-api";
  import { operation } from "@cardstack/base/operations";

  export class Inbox extends CardDef {
    @operation static list = {
      base: 'callApi',
      url: '${VENDOR}/echo/list',
      headers: { authorization: 'Bearer {{userKey}}' },
    };
  }
`;

const silent: PricingReporter = { info() {}, error() {}, alert() {} };

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

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
  let request: SuperTest<Test>;

  let pricedBefore = currentPricing() !== undefined;
  hooks.before(function () {
    checkPricingAtStartup('automation-routes-test', pricingEnv(), silent);
  });
  hooks.after(function () {
    if (!pricedBefore) {
      // Leaves the process without prices again, as it started.
      checkPricingAtStartup('automation-routes-test', {}, silent);
    }
  });

  setupCatalogTestSubset(hooks);
  // The tests seal incoming webhooks' signing secrets.
  setupSecretsKeyring(hooks);
  setupPermissionedRealmCached(hooks, {
    realmURL,
    secureOriginURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      [WRITER]: ['read', 'write'],
      [READER]: ['read'],
      // The realm's own user, which indexes it.
      [REALM_USER]: ['read', 'write', 'realm-owner'],
    },
    fileSystem: {
      ...automationFixture({
        operations: [],
        path: DAILY,
        triggers: [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
          },
        ],
      }),
      [`${DAILY}-script.js`]: `return 'ok';`,
      'inbox.gts': inboxModule,
      ...automationFixture({
        operations: [{ type: INBOX, names: ['list'] }],
        path: KEYED,
        triggers: [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
          },
        ],
      }),
      [`${KEYED}-script.js`]: `return 'ok';`,
      ...automationFixture({
        operations: [],
        path: CAPPED,
        caps: { dailyCredits: DAILY_CAP },
        triggers: [
          {
            kind: 'webhook',
            label: 'deliveries',
            webhookPath: CAPPED_HOOK_PATH,
          },
        ],
      }),
      [`${CAPPED}-script.js`]: `return 'ok';`,
      ...automationFixture({
        operations: [],
        path: CAPPED_LATER,
        caps: { dailyCredits: DAILY_CAP },
        triggers: [
          {
            kind: 'cron',
            label: 'new-year',
            expression: '0 0 1 1 *',
            timeZone: 'UTC',
          },
        ],
      }),
      [`${CAPPED_LATER}-script.js`]: `return 'ok';`,
      ...automationFixture({
        operations: [],
        path: BROKEN,
        triggers: [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
          },
        ],
      }),
      [`${BROKEN}-script.js`]: 'await realm.fs.writeText(\n',
      ...automationFixture({
        operations: [],
        path: BATCHED,
        batchedAI: true,
        triggers: [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
          },
        ],
      }),
      [`${BATCHED}-script.js`]: `return 'ok';`,
      ...automationFixture({
        operations: [],
        path: NO_MONTHLY_CAP,
        caps: { dailyCredits: 50, monthlyCredits: null },
      }),
      ...automationFixture({
        operations: [],
        path: HOOKED,
        triggers: [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
          },
          { kind: 'webhook', label: 'deliveries', webhookPath: HOOK_PATH },
        ],
      }),
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
      request = args.request;
    },
  });

  function auth(
    user: string,
    claims: { realmAuthority?: true; delegated?: boolean } = {},
  ): string {
    return `Bearer ${createRealmServerJWT(
      { user, sessionRoom: 'test-session', ...claims },
      realmSecretSeed,
    )}`;
  }

  function cardURL(path = DAILY): string {
    return `${realm.url}${path}`;
  }

  function automationId(path = DAILY) {
    return rri(cardURL(path));
  }

  async function post(
    path: string,
    user: string,
    attributes: Record<string, unknown>,
    {
      id = cardURL(),
      type = 'automation',
      authorization = auth(user),
    }: { id?: string; type?: string; authorization?: string } = {},
  ) {
    return await request
      .post(path)
      .set('Authorization', authorization)
      .set('Content-Type', 'application/json')
      .send({
        data: { type, id, attributes: { realm: realm.url, ...attributes } },
      });
  }

  async function switchOn(user = OWNER, path = DAILY) {
    let response = await post(
      AUTOMATION_SWITCH_ON_PATH,
      user,
      { monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits },
      { id: cardURL(path) },
    );
    if (response.status !== 201) {
      throw new Error(
        `could not switch the automation on: ${response.status} ${response.text}`,
      );
    }
    return response;
  }

  // A run's job is claimed by this process's worker, so a test waits for the
  // run it started to end before the realm is torn down.
  async function ended(runId: string): Promise<AutomationRun> {
    let deadline = Date.now() + 60_000;
    for (;;) {
      let run = await getAutomationRun(dbAdapter, runId);
      if (
        run &&
        (run.state === 'complete' ||
          run.state === 'error' ||
          run.state === 'canceled')
      ) {
        return run;
      }
      if (Date.now() > deadline) {
        throw new Error(`run ${runId} didn't end: ${run?.state}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  // Gives `user` `credits` more credits to spend: enough by default for a
  // run at the roomy caps, whose minimum balance a resume's payer must hold.
  async function fund(user: string, credits = 1_000_000) {
    await ensureTestUser(dbAdapter, user);
    let { id } = (await getUserByMatrixUserId(dbAdapter, user))!;
    await addToCreditsLedger(dbAdapter, {
      userId: id,
      creditAmount: credits,
      creditType: 'extra_credit',
      subscriptionCycleId: null,
    });
  }

  // Charges `credits` to `user` as the automation at `path`'s storage, now,
  // which its daily and monthly credit caps count.
  async function chargeAutomation(user: string, path: string, credits: number) {
    await ensureTestUser(dbAdapter, user);
    let { id: userId } = (await getUserByMatrixUserId(dbAdapter, user))!;
    let charge: SpendCharge = {
      kind: 'storage',
      realm: ri(realm.url),
      automationId: automationId(path),
      day: new Date().toISOString().slice(0, 10),
      pricingVersion: currentPricing()!.version,
    };
    await addToCreditsLedger(dbAdapter, {
      userId,
      creditAmount: -credits,
      creditType: 'extra_credit_used',
      subscriptionCycleId: null,
      charge,
      chargeId: randomUUID(),
    });
  }

  async function resume(user: string, path = DAILY) {
    return await post(
      AUTOMATION_RESUME_PATH,
      user,
      { monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits },
      { id: cardURL(path) },
    );
  }

  module('the switch-on estimate', function () {
    test('a direct writer reads the estimate and the monthly cap the card sets', async function (assert) {
      let response = await request
        .get(AUTOMATION_SWITCH_ON_PATH)
        .query({ realm: realm.url, automation: cardURL() })
        .set('Authorization', auth(OWNER));
      assert.strictEqual(response.status, 200, response.text);
      let { data } = response.body;
      assert.strictEqual(data.type, 'automation-estimate');
      assert.strictEqual(data.id, cardURL());
      assert.false(data.attributes.switchedOn, 'it is not switched on yet');
      assert.strictEqual(
        data.attributes.monthlyCredits,
        ROOMY_AUTOMATION_CAPS.monthlyCredits,
        'it names the card’s monthly cap',
      );
      let { estimate } = data.attributes;
      assert.deepEqual(
        estimate.triggers.map((t: { label: string }) => t.label),
        ['daily'],
      );
      assert.ok(
        estimate.unboundedRunsPerMonth >= 28,
        `a daily trigger counts a month of runs (${estimate.unboundedRunsPerMonth})`,
      );
      assert.ok(estimate.credits > 0, 'the estimate prices those runs');
      assert.strictEqual(
        estimate.pricingVersion,
        currentPricing()?.version,
        'at the server’s current prices',
      );
    });

    test('a card that turns on batched AI is estimated with each run’s AI counted twice', async function (assert) {
      let estimateOf = async (path: string) => {
        let response = await request
          .get(AUTOMATION_SWITCH_ON_PATH)
          .query({ realm: realm.url, automation: cardURL(path) })
          .set('Authorization', auth(OWNER));
        assert.strictEqual(response.status, 200, response.text);
        return response.body.data.attributes.estimate;
      };
      let plain = await estimateOf(DAILY);
      let batched = await estimateOf(BATCHED);
      assert.strictEqual(
        plain.perRun.aiCredits,
        ROOMY_AUTOMATION_CAPS.aiCredits,
        'a card that doesn’t batch counts its AI cap once',
      );
      assert.strictEqual(
        batched.perRun.aiCredits,
        ROOMY_AUTOMATION_CAPS.aiCredits * 2,
        'a card that batches counts it twice',
      );
      assert.strictEqual(
        batched.perRun.computeCredits,
        plain.perRun.computeCredits,
        'only the AI part changes',
      );
      assert.true(batched.credits > plain.credits);
    });

    test('the estimate says webhook triggers start no runs, for a card with one', async function (assert) {
      let hooked = await request
        .get(AUTOMATION_SWITCH_ON_PATH)
        .query({ realm: realm.url, automation: cardURL(HOOKED) })
        .set('Authorization', auth(OWNER));
      assert.strictEqual(hooked.status, 200, hooked.text);
      assert.deepEqual(
        hooked.body.data.attributes.notices.map(
          ({ code }: { code: string }) => code,
        ),
        ['webhook-triggers-start-no-runs'],
      );
      let daily = await request
        .get(AUTOMATION_SWITCH_ON_PATH)
        .query({ realm: realm.url, automation: cardURL() })
        .set('Authorization', auth(OWNER));
      assert.deepEqual(daily.body.data.attributes.notices, []);
    });

    test('a caller who is not a direct writer is refused', async function (assert) {
      let response = await request
        .get(AUTOMATION_SWITCH_ON_PATH)
        .query({ realm: realm.url, automation: cardURL() })
        .set('Authorization', auth(READER));
      assert.strictEqual(response.status, 403, response.text);
    });

    test('a server without prices answers 503', async function (assert) {
      checkPricingAtStartup('automation-routes-test', {}, silent);
      try {
        let response = await request
          .get(AUTOMATION_SWITCH_ON_PATH)
          .query({ realm: realm.url, automation: cardURL() })
          .set('Authorization', auth(OWNER));
        assert.strictEqual(response.status, 503, response.text);
      } finally {
        checkPricingAtStartup('automation-routes-test', pricingEnv(), silent);
      }
    });
  });

  module('switching on', function () {
    test('a direct writer switches the automation on and becomes its payer', async function (assert) {
      let response = await switchOn(OWNER);
      let { data, meta } = response.body;
      assert.strictEqual(data.type, 'automation');
      assert.strictEqual(data.id, cardURL());
      assert.strictEqual(data.attributes.state, 'active');
      assert.true(data.attributes.viewerIsPayer);
      assert.ok(data.attributes.nextRun, 'its daily trigger has a next run');
      assert.ok(meta.estimate.credits > 0, 'it answers the estimate too');
      let row = await getAutomation(dbAdapter, automationId());
      assert.strictEqual(row?.payer, OWNER, 'the caller is the payer');
      assert.strictEqual(
        row?.capsSnapshot.monthlyCredits,
        ROOMY_AUTOMATION_CAPS.monthlyCredits,
        'the snapshot holds the monthly cap the caller agreed to',
      );

      let again = await post(AUTOMATION_SWITCH_ON_PATH, WRITER, {
        monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits,
      });
      assert.strictEqual(again.status, 409, 'a second switch-on is refused');
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId()))?.payer,
        OWNER,
        'and the payer stays',
      );
    });

    test("switch-on refuses a webhook trigger naming a webhook the realm can't use, and says webhook triggers start no runs once on", async function (assert) {
      let switchOnHooked = () =>
        post(
          AUTOMATION_SWITCH_ON_PATH,
          OWNER,
          { monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits },
          { id: cardURL(HOOKED) },
        );
      let unknown = await switchOnHooked();
      assert.strictEqual(unknown.status, 422, unknown.text);
      assert.ok(
        unknown.text.includes(`Boxel has no incoming webhook at`),
        unknown.text,
      );

      let id = await insertIncomingWebhookRow(dbAdapter, {
        username: OUTSIDER,
        webhookPath: HOOK_PATH,
        signingSecret: 'outsider-secret',
      });
      let foreign = await switchOnHooked();
      assert.strictEqual(foreign.status, 422, foreign.text);
      assert.ok(
        foreign.text.includes('doesn’t belong to a workspace administrator'),
        foreign.text,
      );
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId(HOOKED)),
        undefined,
        'nothing was switched on',
      );

      await dbAdapter.execute(`DELETE FROM incoming_webhooks WHERE id = $1`, {
        bind: [id],
      });
      await insertIncomingWebhookRow(dbAdapter, {
        username: WRITER,
        webhookPath: HOOK_PATH,
        signingSecret: 'writer-secret',
      });
      let on = await switchOnHooked();
      assert.strictEqual(
        on.status,
        201,
        `another direct writer's webhook is the realm's: ${on.text}`,
      );
      assert.deepEqual(
        on.body.meta.notices.map(({ code }: { code: string }) => code),
        ['webhook-triggers-start-no-runs'],
      );
    });

    test('switch-on without a monthly cap is refused', async function (assert) {
      let missing = await post(AUTOMATION_SWITCH_ON_PATH, OWNER, {});
      assert.strictEqual(missing.status, 400, missing.text);
      let notANumber = await post(AUTOMATION_SWITCH_ON_PATH, OWNER, {
        monthlyCredits: '100',
      });
      assert.strictEqual(notANumber.status, 400, notANumber.text);
      let otherCap = await post(AUTOMATION_SWITCH_ON_PATH, OWNER, {
        monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits - 1,
      });
      assert.strictEqual(
        otherCap.status,
        409,
        `a cap other than the card's is refused: ${otherCap.text}`,
      );
      let cardHasNone = await post(
        AUTOMATION_SWITCH_ON_PATH,
        OWNER,
        { monthlyCredits: 50 },
        { id: cardURL(NO_MONTHLY_CAP) },
      );
      assert.strictEqual(
        cardHasNone.status,
        422,
        `a card with no monthly cap can't be switched on: ${cardHasNone.text}`,
      );
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId()),
        undefined,
        'nothing was switched on',
      );
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId(NO_MONTHLY_CAP)),
        undefined,
      );
    });

    test('a caller who is not a direct writer is refused', async function (assert) {
      let response = await post(AUTOMATION_SWITCH_ON_PATH, READER, {
        monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits,
      });
      assert.strictEqual(response.status, 403, response.text);
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId()),
        undefined,
      );
    });

    test("a session that isn't the user's own is refused", async function (assert) {
      // A delegated session is refused by the session check, a
      // realm-authority session by the route.
      for (let [claims, status] of [
        [{ realmAuthority: true as const }, 403],
        [{ delegated: true }, 401],
      ] as const) {
        let response = await post(
          AUTOMATION_SWITCH_ON_PATH,
          OWNER,
          { monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits },
          { authorization: auth(OWNER, claims) },
        );
        assert.strictEqual(
          response.status,
          status,
          `${JSON.stringify(claims)}: ${response.text}`,
        );
      }
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId()),
        undefined,
      );
    });

    test('an automation outside the realm named is refused', async function (assert) {
      let response = await post(
        AUTOMATION_SWITCH_ON_PATH,
        OWNER,
        { monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits },
        { id: 'http://127.0.0.1:4444/another-realm/automation/daily' },
      );
      assert.strictEqual(response.status, 400, response.text);
    });
  });

  module('pause, resume and remove', function () {
    test('a direct writer pauses, resumes and removes an automation', async function (assert) {
      await switchOn(OWNER);
      await fund(WRITER);

      let paused = await post(AUTOMATION_PAUSE_PATH, WRITER, {});
      assert.strictEqual(paused.status, 200, paused.text);
      assert.strictEqual(paused.body.data.attributes.state, 'paused');
      assert.strictEqual(paused.body.data.attributes.pauseReason, 'requested');
      assert.false(paused.body.data.attributes.viewerIsPayer);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, WRITER, {})).status,
        409,
        'pausing a paused automation is refused',
      );

      let noCap = await post(AUTOMATION_RESUME_PATH, WRITER, {});
      assert.strictEqual(noCap.status, 400, 'resume names the monthly cap');
      let resumed = await post(AUTOMATION_RESUME_PATH, WRITER, {
        monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits,
      });
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(resumed.body.data.attributes.state, 'active');
      assert.true(
        resumed.body.data.attributes.viewerIsPayer,
        'whoever resumes becomes the payer',
      );
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId()))?.payer,
        WRITER,
      );
      assert.strictEqual(
        (
          await post(AUTOMATION_RESUME_PATH, WRITER, {
            monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits,
          })
        ).status,
        409,
        'resuming an active automation is refused',
      );

      let removed = await post(AUTOMATION_REMOVE_PATH, OWNER, {});
      assert.strictEqual(removed.status, 200, removed.text);
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId()),
        undefined,
        'the row is gone',
      );
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {})).status,
        404,
        'an automation that is not switched on has nothing to pause',
      );
    });

    test('a caller who is not a direct writer is refused', async function (assert) {
      await switchOn(OWNER);
      for (let [path, attributes] of [
        [AUTOMATION_PAUSE_PATH, {}],
        [
          AUTOMATION_RESUME_PATH,
          { monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits },
        ],
        [AUTOMATION_REMOVE_PATH, {}],
      ] as const) {
        let response = await post(path, READER, attributes);
        assert.strictEqual(response.status, 403, `${path}: ${response.text}`);
      }
      let row = await getAutomation(dbAdapter, automationId());
      assert.strictEqual(row?.state, 'active', 'the automation is untouched');
      assert.strictEqual(row?.payer, OWNER);
    });
  });

  module('admitting the payer a resume makes', function (hooks) {
    hooks.beforeEach(function () {
      configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
    });
    hooks.afterEach(function () {
      resetOutbound();
      testAccountStandings.clear();
    });

    // Adds a key for `user` and approves the keyed automation's `list`
    // operation with it, for automations, as the approval screen does.
    async function approveOwnKey(user: string) {
      let ticket = async (action: 'add') =>
        (
          await mintKeyWriteTicket(dbAdapter, user, {
            action,
            keyId: null,
            realmURL: null,
            shareId: null,
          })
        ).ticket;
      let key = await addUserKey(dbAdapter, secretsKeyring(), {
        owner: user,
        name: 'vendor',
        value: `sk-${user.slice(1, 12)}-routes-key`,
        ticket: await ticket('add'),
      });
      let authorization = await secureSessionAuth(dbAdapter, user);
      let shown = (
        await request
          .get('/_key-bindings/preview')
          .query({
            realm: realmURL.href,
            module: INBOX.module,
            name: INBOX.name,
            operation: 'list',
          })
          .set('Authorization', authorization)
      ).body.data.attributes;
      let [slot] = shown.slots;
      let approved = await request
        .post('/_key-bindings')
        .set('Authorization', authorization)
        .set('Origin', secureOriginURL.origin)
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'key-binding-approval',
            attributes: {
              realm: realmURL.href,
              operations: [
                {
                  codeRef: INBOX,
                  operation: 'list',
                  expectedDestination: shown.destination,
                  slots: {
                    [slot.slot]: {
                      keyId: key.id,
                      expectedFingerprint: slot.fingerprint,
                    },
                  },
                },
              ],
            },
          },
        });
      if (approved.status !== 201) {
        throw new Error(
          `approving list answered ${approved.status}: ${approved.text}`,
        );
      }
    }

    async function assertStillPaused(
      assert: Assert,
      path: string,
      payer: string,
    ) {
      let row = await getAutomation(dbAdapter, automationId(path));
      assert.strictEqual(row?.state, 'paused', 'the automation stays paused');
      assert.strictEqual(row?.pauseReason, 'requested');
      assert.strictEqual(row?.payer, payer, 'the payer is unchanged');
    }

    test('a new payer with no binding of their own for a {{userKey}} slot is refused, and the automation stays paused', async function (assert) {
      await fund(OWNER);
      await fund(WRITER);
      await approveOwnKey(OWNER);
      await switchOn(OWNER, KEYED);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );

      let refused = await resume(WRITER, KEYED);
      assert.strictEqual(refused.status, 422, refused.text);
      assert.strictEqual(refused.body.meta.code, 'binding-not-approved');
      assert.true(
        refused.body.errors[0].startsWith(
          'The declared operation "list" on Inbox',
        ),
        'the refusal says which operation the new payer has no binding for',
      );
      await assertStillPaused(assert, KEYED, OWNER);

      let resumed = await resume(OWNER, KEYED);
      assert.strictEqual(
        resumed.status,
        200,
        `the payer whose own key fills the slot resumes it: ${resumed.text}`,
      );
      assert.strictEqual(resumed.body.data.attributes.state, 'active');
    });

    test('a new payer whose balance is short of one run’s minimum is refused, and the automation stays paused', async function (assert) {
      await switchOn(OWNER);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {})).status,
        200,
      );
      await fund(WRITER, 10);

      let refused = await resume(WRITER);
      assert.strictEqual(refused.status, 422, refused.text);
      assert.strictEqual(refused.body.meta.code, 'insufficient-credits');
      assert.false(
        refused.body.errors[0].includes(' 10 '),
        'the refusal never says what the person holds',
      );
      await assertStillPaused(assert, DAILY, OWNER);

      await fund(WRITER);
      let resumed = await resume(WRITER);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId()))?.payer,
        WRITER,
        'once the balance covers a run, the resume makes them the payer',
      );
    });

    test('a resume prices a card that turns on batched AI with its AI counted twice', async function (assert) {
      await switchOn(OWNER, BATCHED);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(BATCHED) }))
          .status,
        200,
      );
      let pricing = currentPricing()!;
      let minimum = (batchedAI: boolean) =>
        Math.max(
          Math.ceil(
            runCostCeiling({ ...ROOMY_AUTOMATION_CAPS, batchedAI }, pricing)
              .totalCredits,
          ),
          pricing.values.minimumBalanceFloorCredits,
        );
      assert.true(
        minimum(true) > minimum(false),
        'the doubled minimum is above the single one',
      );
      // Enough for a run that counts its AI once, short of one that counts
      // it twice.
      await fund(WRITER, minimum(false));

      let refused = await resume(WRITER, BATCHED);
      assert.strictEqual(refused.status, 422, refused.text);
      assert.strictEqual(refused.body.meta.code, 'insufficient-credits');
      assert.true(
        refused.body.errors[0].includes(`${minimum(true)} credits`),
        'the refusal names the doubled minimum',
      );
      await assertStillPaused(assert, BATCHED, OWNER);

      await fund(WRITER, minimum(true) - minimum(false));
      let resumed = await resume(WRITER, BATCHED);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(BATCHED)))?.payer,
        WRITER,
      );
    });

    test('a new payer whose account can’t sign in is refused, and the automation stays paused', async function (assert) {
      await fund(WRITER);
      await switchOn(OWNER);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {})).status,
        200,
      );
      testAccountStandings.set(WRITER, 'deactivated');

      let refused = await resume(WRITER);
      assert.strictEqual(refused.status, 422, refused.text);
      assert.strictEqual(refused.body.meta.code, 'account-deactivated');
      await assertStillPaused(assert, DAILY, OWNER);
    });

    test('a resume whose first run falls on a day the automation has spent its daily cap is refused, and the automation stays paused', async function (assert) {
      await fund(WRITER);
      await insertIncomingWebhookRow(dbAdapter, {
        username: OWNER,
        webhookPath: CAPPED_HOOK_PATH,
        signingSecret: 'capped-secret',
      });
      await switchOn(OWNER, CAPPED);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(CAPPED) }))
          .status,
        200,
      );
      await chargeAutomation(OWNER, CAPPED, DAILY_CAP);

      let refused = await resume(WRITER, CAPPED);
      assert.strictEqual(refused.status, 422, refused.text);
      assert.strictEqual(refused.body.meta.code, 'daily-credit-cap-reached');
      await assertStillPaused(assert, CAPPED, OWNER);
    });

    test('a cap spent today doesn’t refuse a resume whose first run falls on a later day', async function (assert) {
      await fund(WRITER);
      await switchOn(OWNER, CAPPED_LATER);
      assert.strictEqual(
        (
          await post(
            AUTOMATION_PAUSE_PATH,
            OWNER,
            {},
            { id: cardURL(CAPPED_LATER) },
          )
        ).status,
        200,
      );
      await chargeAutomation(OWNER, CAPPED_LATER, DAILY_CAP);

      let resumed = await resume(WRITER, CAPPED_LATER);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(CAPPED_LATER)))?.payer,
        WRITER,
      );
    });

    test('a script that doesn’t parse refuses the resume, and the automation stays paused', async function (assert) {
      await fund(WRITER);
      await switchOn(OWNER, BROKEN);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(BROKEN) }))
          .status,
        200,
      );

      let refused = await resume(WRITER, BROKEN);
      assert.strictEqual(refused.status, 422, refused.text);
      assert.strictEqual(refused.body.meta.code, 'script-error');
      assert.true(
        refused.body.errors[0].includes("doesn't parse"),
        refused.body.errors[0],
      );
      await assertStillPaused(assert, BROKEN, OWNER);
    });

    test('an automation that isn’t paused is refused as not paused, whatever its new payer could pay', async function (assert) {
      await switchOn(OWNER);
      let refused = await resume(WRITER);
      assert.strictEqual(refused.status, 409, refused.text);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId()))?.payer,
        OWNER,
      );
    });
  });

  module('Preview and Run now', function () {
    test('a direct writer starts a Preview, which runs as and is charged to them', async function (assert) {
      let response = await post(AUTOMATION_PREVIEW_PATH, WRITER, {
        click: randomUUID(),
      });
      assert.strictEqual(response.status, 202, response.text);
      let { data } = response.body;
      assert.strictEqual(data.type, 'automation-run');
      assert.true(data.attributes.dryRun, 'it is a Preview');
      assert.strictEqual(data.attributes.trigger, 'manual');
      let run = await ended(data.id);
      assert.strictEqual(run.actsAs, WRITER, 'it acts as the caller');
      assert.strictEqual(
        run.state,
        'complete',
        `it completes (${run.errorReason}: ${run.errorMessage})`,
      );
      assert.strictEqual(run.commitStartedAt, null, 'it never commits');
    });

    test('a direct writer starts a Run now, whether or not the automation is switched on', async function (assert) {
      let response = await post(AUTOMATION_RUN_NOW_PATH, OWNER, {
        click: randomUUID(),
      });
      assert.strictEqual(response.status, 202, response.text);
      assert.false(response.body.data.attributes.dryRun, 'it commits');
      let run = await ended(response.body.data.id);
      assert.strictEqual(run.actsAs, OWNER);
      assert.strictEqual(
        run.state,
        'complete',
        `it completes (${run.errorReason}: ${run.errorMessage})`,
      );
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId()),
        undefined,
        'running it by hand does not switch it on',
      );
    });

    test('a click is required, and one already used for another kind of run is refused', async function (assert) {
      let missing = await post(AUTOMATION_PREVIEW_PATH, OWNER, {});
      assert.strictEqual(missing.status, 400, missing.text);
      let click = randomUUID();
      let preview = await post(AUTOMATION_PREVIEW_PATH, OWNER, { click });
      assert.strictEqual(preview.status, 202, preview.text);
      let reused = await post(AUTOMATION_RUN_NOW_PATH, OWNER, { click });
      assert.strictEqual(reused.status, 409, reused.text);
      await ended(preview.body.data.id);
    });

    test('a caller who is not a direct writer is refused', async function (assert) {
      for (let path of [AUTOMATION_PREVIEW_PATH, AUTOMATION_RUN_NOW_PATH]) {
        let response = await post(path, READER, { click: randomUUID() });
        assert.strictEqual(response.status, 403, `${path}: ${response.text}`);
      }
      let [{ count }] = (await dbAdapter.execute(
        `SELECT COUNT(*)::int AS count FROM automation_runs WHERE automation_id = '${automationId()}'`,
      )) as { count: number }[];
      assert.strictEqual(count, 0, 'no run was started');
    });
  });

  module('canceling a run', function () {
    async function pendingRun(): Promise<AutomationRun> {
      // A pending run with no job, so it stays pending until canceled.
      return await createAutomationRun(dbAdapter, {
        automationId: automationId(),
        realm: ri(realm.url),
        trigger: 'manual',
        slot: randomUUID(),
        actsAs: OWNER,
        dryRun: false,
      });
    }

    test('a direct writer cancels a run', async function (assert) {
      let run = await pendingRun();
      let response = await post(
        AUTOMATION_RUN_CANCEL_PATH,
        WRITER,
        {},
        { type: 'automation-run', id: run.id },
      );
      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(response.body.data.attributes.state, 'canceled');
      assert.strictEqual(response.body.data.attributes.canceledBy, WRITER);
      let again = await post(
        AUTOMATION_RUN_CANCEL_PATH,
        WRITER,
        {},
        { type: 'automation-run', id: run.id },
      );
      assert.strictEqual(again.status, 409, 'an ended run is not cancelable');
    });

    test('a caller who is not a direct writer is refused, and an unknown run is not found', async function (assert) {
      let run = await pendingRun();
      let refused = await post(
        AUTOMATION_RUN_CANCEL_PATH,
        READER,
        {},
        { type: 'automation-run', id: run.id },
      );
      assert.strictEqual(refused.status, 403, refused.text);
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))?.state,
        'pending',
        'the run is untouched',
      );
      for (let id of [randomUUID(), 'not-a-run']) {
        let missing = await post(
          AUTOMATION_RUN_CANCEL_PATH,
          OWNER,
          {},
          { type: 'automation-run', id },
        );
        assert.strictEqual(missing.status, 404, `${id}: ${missing.text}`);
      }
    });

    test('a direct writer naming a run in another realm finds no run', async function (assert) {
      let elsewhere = 'http://127.0.0.1:4444/another-realm/';
      let run = await createAutomationRun(dbAdapter, {
        automationId: rri(`${elsewhere}automation/daily`),
        realm: ri(elsewhere),
        trigger: 'manual',
        slot: randomUUID(),
        actsAs: OWNER,
        dryRun: false,
      });
      let response = await post(
        AUTOMATION_RUN_CANCEL_PATH,
        OWNER,
        {},
        { type: 'automation-run', id: run.id },
      );
      assert.strictEqual(response.status, 404, response.text);
      assert.strictEqual(
        (await getAutomationRun(dbAdapter, run.id))?.state,
        'pending',
        'the run is untouched',
      );
    });
  });

  module("reading a run's log", function () {
    let at = Date.UTC(2026, 10, 17, 9, 0, 0);

    function line(
      message: string,
      fields: Partial<RunLogLine> = {},
    ): RunLogLine {
      return {
        at: at++,
        source: 'script',
        kind: 'console',
        level: 'log',
        message,
        ...fields,
      };
    }

    // A pending run with no job, so nothing but the test writes its log.
    async function runWithLog(lines: RunLogLine[]): Promise<AutomationRun> {
      let run = await createAutomationRun(dbAdapter, {
        automationId: automationId(),
        realm: ri(realm.url),
        trigger: 'manual',
        slot: randomUUID(),
        actsAs: OWNER,
        dryRun: false,
      });
      await appendRunLog(dbAdapter, run.id, lines);
      return run;
    }

    // A fetch that reaches the test's realm server through supertest, with
    // `user`'s session.
    function fetchAs(user: string) {
      return async (url: string) => {
        let { pathname, search } = new URL(url);
        let response = await request
          .get(`${pathname}${search}`)
          .set('Authorization', auth(user));
        return new Response(response.text, { status: response.status });
      };
    }

    async function readLog(
      runId: string,
      query: Record<string, string | number> = {},
      user = WRITER,
    ) {
      return await request
        .get(AUTOMATION_RUN_LOG_PATH)
        .query({ realm: realm.url, run: runId, ...query })
        .set('Authorization', auth(user));
    }

    test('a direct writer reads a run’s log page by page', async function (assert) {
      let run = await runWithLog([
        line('one', { scriptLine: 3 }),
        line('two'),
        line('three'),
        line('Milestone: Fetch', {
          kind: 'milestone',
          level: undefined,
          data: { name: 'Fetch' },
        }),
        line('five'),
      ]);

      let first = await readLog(run.id, { limit: 2 });
      assert.strictEqual(first.status, 200, first.text);
      assert.strictEqual(first.body.data.type, 'automation-run-log');
      assert.strictEqual(first.body.data.id, run.id);
      let page = first.body.data.attributes;
      assert.strictEqual(page.state, 'pending');
      assert.deepEqual(
        page.lines.map((l: { seq: number; message: string }) => [
          l.seq,
          l.message,
        ]),
        [
          [0, 'one'],
          [1, 'two'],
        ],
      );
      assert.strictEqual(
        page.lines[0].scriptLine,
        3,
        'a line keeps its script line',
      );
      assert.strictEqual(page.lines[0].level, 'log');
      assert.true(page.more, 'the log holds more');
      assert.strictEqual(page.next, 1);
      assert.strictEqual(page.total, 5);
      assert.strictEqual(page.dropped, 0);

      let second = (await readLog(run.id, { limit: 2, after: page.next })).body
        .data.attributes;
      assert.deepEqual(
        second.lines.map((l: { seq: number }) => l.seq),
        [2, 3],
      );
      assert.deepEqual(second.lines[1].data, { name: 'Fetch' });
      assert.strictEqual(
        second.lines[1].level,
        undefined,
        'a milestone has no level',
      );
      assert.true(second.more);

      let last = (await readLog(run.id, { limit: 2, after: second.next })).body
        .data.attributes;
      assert.deepEqual(
        last.lines.map((l: { seq: number }) => l.seq),
        [4],
      );
      assert.false(last.more, 'the last page says so');
      assert.strictEqual(last.next, 4);

      let past = (await readLog(run.id, { after: last.next })).body.data
        .attributes;
      assert.deepEqual(past.lines, [], 'nothing past the end');
      assert.strictEqual(past.next, 4, 'and the cursor stays where it was');

      let whole = (await readLog(run.id)).body.data.attributes;
      assert.strictEqual(whole.lines.length, 5, 'one page holds a short log');
      assert.false(whole.more);
    });

    test('a page ends at the lines the run’s row counts', async function (assert) {
      let run = await runWithLog([line('one'), line('two')]);
      // A line written but not counted on the run's row, as when an
      // append commits while the page is read.
      await dbAdapter.execute(
        `INSERT INTO automation_run_log (run_id, seq, at, source, kind, level, message) VALUES ('${run.id}', 2, now(), 'script', 'console', 'log', 'three')`,
      );
      let page = (await readLog(run.id)).body.data.attributes;
      assert.deepEqual(
        page.lines.map((l: { message: string }) => l.message),
        ['one', 'two'],
        'the uncounted line is left for a later page',
      );
      assert.strictEqual(page.next, 1, 'and the cursor stops short of it');
      assert.false(page.more);
      await dbAdapter.execute(
        `UPDATE automation_runs SET log_lines = 3 WHERE id = '${run.id}'`,
      );
      let later = (await readLog(run.id, { after: page.next })).body.data
        .attributes;
      assert.deepEqual(
        later.lines.map((l: { message: string }) => l.message),
        ['three'],
        'the next page reads it once it is counted',
      );
    });

    test('a level filter keeps the lines at those levels, and the cursor passes the rest', async function (assert) {
      let run = await runWithLog([
        line('debugging', { level: 'log' }),
        line('careful', { level: 'warn' }),
        line('Fetching', { kind: 'activity', level: undefined }),
        line('broke', { level: 'error' }),
        line('fine', { level: 'info' }),
        line('debugging again', { level: 'log' }),
      ]);
      let messages = (page: AutomationRunLogPage) =>
        page.lines.map((l) => l.message);

      let problems = (await readLog(run.id, { level: 'warn,error' })).body.data
        .attributes;
      assert.deepEqual(messages(problems), ['careful', 'broke']);
      assert.false(problems.more);
      assert.strictEqual(
        problems.next,
        5,
        'the cursor passes the lines the filter left out',
      );
      assert.strictEqual(problems.total, 6, 'total counts every line');

      let info = (await readLog(run.id, { level: 'info' })).body.data
        .attributes;
      assert.deepEqual(
        messages(info),
        ['Fetching', 'fine'],
        'a line with no level reads as info',
      );

      let paged = (await readLog(run.id, { level: 'warn,error', limit: 1 }))
        .body.data.attributes;
      assert.deepEqual(messages(paged), ['careful']);
      assert.true(paged.more);
      assert.strictEqual(paged.next, 1, 'a full page ends at its last line');
      let rest = (
        await readLog(run.id, {
          level: 'warn,error',
          limit: 1,
          after: paged.next,
        })
      ).body.data.attributes;
      assert.deepEqual(messages(rest), ['broke']);

      let bad = await readLog(run.id, { level: 'warn,debug' });
      assert.strictEqual(bad.status, 400, bad.text);
    });

    test('a log past its cap says how many lines were dropped', async function (assert) {
      let run = await runWithLog([]);
      await appendRunLog(
        dbAdapter,
        run.id,
        [line('kept'), line('dropped'), line('dropped too')],
        { maxLines: 1 },
      );
      let page = (await readLog(run.id)).body.data.attributes;
      assert.deepEqual(
        page.lines.map((l: { message: string }) => l.message),
        ['kept'],
        'no line of the page stands for the dropped ones',
      );
      assert.strictEqual(page.dropped, 2);
      assert.strictEqual(page.total, 1);
    });

    test('a caller who is not a direct writer is refused', async function (assert) {
      let run = await runWithLog([line('secret')]);
      let reader = await readLog(run.id, {}, READER);
      assert.strictEqual(reader.status, 403, reader.text);
      assert.notOk(reader.text.includes('secret'), 'and reads no line');
      let unknown = await readLog(randomUUID(), {}, READER);
      assert.strictEqual(
        unknown.status,
        403,
        'refused the same way for a run that does not exist',
      );
      assert.strictEqual(
        unknown.body.errors[0].detail,
        reader.body.errors[0].detail,
      );

      // A delegated session is refused by the session check, a
      // realm-authority session by the route.
      for (let [claims, status] of [
        [{ realmAuthority: true as const }, 403],
        [{ delegated: true }, 401],
      ] as const) {
        let response = await request
          .get(AUTOMATION_RUN_LOG_PATH)
          .query({ realm: realm.url, run: run.id })
          .set('Authorization', auth(WRITER, claims));
        assert.strictEqual(
          response.status,
          status,
          `${JSON.stringify(claims)}: ${response.text}`,
        );
      }

      let { token } = await createAutomationRunToken(dbAdapter, realm, WRITER);
      let runToken = await request
        .get(AUTOMATION_RUN_LOG_PATH)
        .query({ realm: realm.url, run: run.id })
        .set('Authorization', `Bearer ${token}`);
      assert.strictEqual(
        runToken.status,
        401,
        `a run token is refused by the session check: ${runToken.text}`,
      );

      let anonymous = await request
        .get(AUTOMATION_RUN_LOG_PATH)
        .query({ realm: realm.url, run: run.id });
      assert.strictEqual(anonymous.status, 401, anonymous.text);
    });

    test('a run of another realm, or no run, is not found', async function (assert) {
      let elsewhere = 'http://127.0.0.1:4444/somewhere-else/';
      let run = await createAutomationRun(dbAdapter, {
        automationId: rri(`${elsewhere}automation/daily`),
        realm: ri(elsewhere),
        trigger: 'manual',
        slot: randomUUID(),
        actsAs: OWNER,
        dryRun: false,
      });
      await appendRunLog(dbAdapter, run.id, [line('elsewhere')]);
      let response = await readLog(run.id);
      assert.strictEqual(response.status, 404, response.text);
      assert.strictEqual((await readLog(randomUUID())).status, 404);
      assert.strictEqual((await readLog('not-a-run')).status, 404);
    });

    test('the page parameters are checked', async function (assert) {
      let run = await runWithLog([line('one')]);
      let queries: Record<string, string | number>[] = [
        { limit: 0 },
        { limit: 1001 },
        { limit: 'many' },
        { after: -2 },
        { after: 1.5 },
        { after: 2 ** 31 },
      ];
      for (let query of queries) {
        let response = await readLog(run.id, query);
        assert.strictEqual(
          response.status,
          400,
          `${JSON.stringify(query)}: ${response.text}`,
        );
      }
    });

    test('a follower receives a running run’s lines as they arrive, and stops once it ends', async function (assert) {
      let { run } = await createAutomationRunToken(dbAdapter, realm, OWNER);
      await appendRunLog(dbAdapter, run.id, [line('started')], {
        attempt: 1,
      });

      let pages: AutomationRunLogPage[] = [];
      let errors: Error[] = [];
      let arrived = (message: string) =>
        pages.some((p) => p.lines.some((l) => l.message === message));
      let until = async (what: string, condition: () => boolean) => {
        let deadline = Date.now() + 10_000;
        while (!condition()) {
          if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${what}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      let follower = followAutomationRunLog({
        fetch: fetchAs(WRITER),
        realmServerURL: new URL(realm.url).origin,
        realm: realm.url,
        runId: run.id,
        intervalMs: 1000,
        onPage: (page) => pages.push(page),
        onError: (error) => errors.push(error),
      });
      try {
        await until('the first line', () => arrived('started'));
        assert.strictEqual(pages[0].state, 'running');

        await appendRunLog(dbAdapter, run.id, [line('working')], {
          attempt: 1,
        });
        await until('a line the next poll reads', () => arrived('working'));

        await appendRunLog(
          dbAdapter,
          run.id,
          [line('more'), line('and more')],
          { attempt: 1 },
        );
        follower.wake();
        await until('the lines a wake reads', () => arrived('and more'));

        // The run's row ends before its last line is written, as the
        // realm server ends a run, so the follower reads once more.
        await dbAdapter.execute(
          `UPDATE automation_runs SET state = 'complete', finished_at = now() WHERE id = '${run.id}'`,
        );
        follower.wake();
        await until('a page that reads the run ended', () =>
          pages.some((p) => p.state === 'complete'),
        );
        await appendRunLog(dbAdapter, run.id, [
          line('The run finished', {
            source: 'platform',
            kind: 'finish',
            level: 'info',
          }),
        ]);
        follower.wake();
        await follower.done;
      } finally {
        follower.stop();
      }
      assert.deepEqual(
        pages.flatMap((p) => p.lines.map((l) => l.message)),
        ['started', 'working', 'more', 'and more', 'The run finished'],
        'each line arrives once, in order, the last one after the run ended',
      );
      assert.strictEqual(pages.at(-1)?.state, 'complete');
      assert.deepEqual(errors, [], 'no read failed');
    });

    test('a follower of a finished run reads its whole log and stops', async function (assert) {
      let run = await runWithLog([line('one'), line('two'), line('three')]);
      await dbAdapter.execute(
        `UPDATE automation_runs SET state = 'complete', finished_at = now() WHERE id = '${run.id}'`,
      );
      let pages: AutomationRunLogPage[] = [];
      let follower = followAutomationRunLog({
        fetch: fetchAs(WRITER),
        realmServerURL: new URL(realm.url).origin,
        realm: realm.url,
        runId: run.id,
        limit: 2,
        intervalMs: 10,
        onPage: (page) => pages.push(page),
      });
      await follower.done;
      assert.deepEqual(
        pages.flatMap((p) => p.lines.map((l) => l.message)),
        ['one', 'two', 'three'],
      );
    });

    // A fetch that answers each read from `answers` in turn and records when
    // each read was asked.
    function scriptedFetch(answers: Partial<AutomationRunLogPage>[]) {
      let asked: number[] = [];
      let fetch = async () => {
        asked.push(Date.now());
        let answer = answers.shift();
        if (answer === undefined) {
          throw new Error('no more scripted answers');
        }
        let attributes = {
          state: 'running',
          lines: [],
          next: -1,
          more: false,
          total: 0,
          dropped: 0,
          ...answer,
        };
        return new Response(
          JSON.stringify({
            data: { type: 'automation-run-log', id: 'run', attributes },
          }),
          { status: 200 },
        );
      };
      return { fetch, asked };
    }

    test('a wake does not cut short the read after a run ends', async function (assert) {
      let intervalMs = 300;
      let { fetch, asked } = scriptedFetch([
        { state: 'complete' },
        { state: 'complete' },
      ]);
      let follower = followAutomationRunLog({
        fetch,
        realmServerURL: 'http://127.0.0.1:4444/',
        realm: realm.url,
        runId: randomUUID(),
        intervalMs,
        // A `job` event that arrives as the run ends.
        onPage: () => follower.wake(),
      });
      follower.wake();
      await follower.done;
      assert.strictEqual(asked.length, 2, 'it reads once more, then stops');
      assert.ok(
        asked[1] - asked[0] >= intervalMs - 20,
        `the last read waits its interval (${asked[1] - asked[0]} ms)`,
      );
    });

    test('a follower stopped during a read that fails reports nothing and settles at once', async function (assert) {
      let fail!: (error: Error) => void;
      let failing = new Promise<never>((_resolve, reject) => {
        fail = reject;
      });
      failing.catch(() => {});
      let errors: Error[] = [];
      let follower = followAutomationRunLog({
        fetch: async () => await failing,
        realmServerURL: 'http://127.0.0.1:4444/',
        realm: realm.url,
        runId: randomUUID(),
        intervalMs: 60_000,
        onPage: () => assert.ok(false, 'no page is read'),
        onError: (error) => errors.push(error),
      });
      follower.stop();
      fail(new Error('the network went away'));
      let settled = await Promise.race([
        follower.done.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      assert.true(settled, 'done settles without waiting an interval');
      assert.deepEqual(
        errors,
        [],
        'the failure after the stop is not reported',
      );
    });

    test('a follower stops when its read is refused', async function (assert) {
      let run = await runWithLog([line('one')]);
      let errors: Error[] = [];
      let follower = followAutomationRunLog({
        fetch: fetchAs(READER),
        realmServerURL: new URL(realm.url).origin,
        realm: realm.url,
        runId: run.id,
        intervalMs: 10,
        onPage: () => assert.ok(false, 'no page is read'),
        onError: (error) => errors.push(error),
      });
      await follower.done;
      assert.strictEqual(errors.length, 1);
      assert.strictEqual((errors[0] as { status?: number }).status, 403);
    });
  });

  // A caller who isn't a direct writer is refused before anything about the
  // realm's automations or runs is read, so the refusal is the same whether
  // or not they exist.
  module('refusing a caller who is not a direct writer', function () {
    test('names nothing that exists', async function (assert) {
      let estimate = await request
        .get(AUTOMATION_SWITCH_ON_PATH)
        .query({ realm: realm.url, automation: cardURL('automation/nothing') })
        .set('Authorization', auth(READER));
      assert.strictEqual(estimate.status, 403, estimate.text);
      for (let path of [AUTOMATION_PAUSE_PATH, AUTOMATION_REMOVE_PATH]) {
        let response = await post(path, READER, {});
        assert.strictEqual(
          response.status,
          403,
          `${path} of an automation that isn't switched on: ${response.text}`,
        );
      }
      let cancel = await post(
        AUTOMATION_RUN_CANCEL_PATH,
        READER,
        {},
        { type: 'automation-run', id: randomUUID() },
      );
      assert.strictEqual(cancel.status, 403, `an unknown run: ${cancel.text}`);
      let log = await request
        .get(AUTOMATION_RUN_LOG_PATH)
        .query({ realm: realm.url, run: randomUUID() })
        .set('Authorization', auth(READER));
      assert.strictEqual(log.status, 403, `an unknown run's log: ${log.text}`);
    });
  });

  module('an archived realm', function () {
    test('switch-on, resume, Preview and Run now are refused', async function (assert) {
      await switchOn(OWNER);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {})).status,
        200,
      );
      await archiveRealm(dbAdapter, new URL(realm.url));

      let resumed = await post(AUTOMATION_RESUME_PATH, OWNER, {
        monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits,
      });
      assert.strictEqual(resumed.status, 409, resumed.text);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId()))?.state,
        'paused',
        'the automation stays paused',
      );

      await post(AUTOMATION_REMOVE_PATH, OWNER, {});
      let switchedOn = await post(AUTOMATION_SWITCH_ON_PATH, OWNER, {
        monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits,
      });
      assert.strictEqual(switchedOn.status, 409, switchedOn.text);
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId()),
        undefined,
        'nothing is switched on',
      );

      for (let path of [AUTOMATION_PREVIEW_PATH, AUTOMATION_RUN_NOW_PATH]) {
        let response = await post(path, OWNER, { click: randomUUID() });
        assert.strictEqual(response.status, 409, `${path}: ${response.text}`);
      }
    });
  });
});
