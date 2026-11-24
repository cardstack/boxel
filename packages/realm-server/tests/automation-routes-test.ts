import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { writeFileSync } from 'fs';
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
  type DefinitionLookup,
  type Realm,
  type SpendCharge,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  getAutomation,
  waitForKeyApproval,
} from '@cardstack/runtime-common/automations';
import { syncAutomationsAfterIndex } from '@cardstack/runtime-common/automation-index-hook';
import { MANUAL_RUN_TRIGGER } from '@cardstack/runtime-common/automation-declaration';
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
  createJWT,
  ensureTestUser,
  insertIncomingWebhookRow,
  realmSecretSeed,
  ROOMY_AUTOMATION_CAPS,
  setupPermissionedRealmCached,
  setupSecretsKeyring,
  testAccountStandings,
  setupProcessPricing,
  silentPricingReporter,
  testPricingEnv,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { secureSessionAuth } from './helpers/secure-session.ts';
import { configureOutbound, resetOutbound } from '../lib/outbound/client.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import { addUserKey, mintKeyWriteTicket } from '../lib/user-keys.ts';
import { shareKey } from '../lib/key-shares.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import { checkPricingAtStartup, currentPricing } from '../lib/pricing.ts';
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
    @operation static shared = {
      base: 'callApi',
      url: '${VENDOR}/echo/shared',
      headers: { authorization: 'Bearer {{apiKey}}' },
    };
  }
`;
// An automation declaring an operation whose request carries the realm's
// shared key, so the share's key owner approves it.
const SHARED = 'automation/shared';
// An automation declaring the keyed operation first, then one the Inbox
// doesn't define.
const KEYED_THEN_MISSING = 'automation/keyed-then-missing';

// The keyed automation's card and script, as the realm starts with them.
function keyedFixture() {
  return automationFixture({
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
  });
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;
  let request: SuperTest<Test>;
  let virtualNetwork: VirtualNetwork;
  let testRealmPath: string;

  setupProcessPricing(hooks, 'automation-routes-test');

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
      ...keyedFixture(),
      [`${KEYED}-script.js`]: `return 'ok';`,
      ...automationFixture({
        operations: [{ type: INBOX, names: ['shared'] }],
        path: SHARED,
        triggers: [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
          },
        ],
      }),
      [`${SHARED}-script.js`]: `return 'ok';`,
      ...automationFixture({
        operations: [{ type: INBOX, names: ['list', 'nowhere'] }],
        path: KEYED_THEN_MISSING,
        triggers: [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
          },
        ],
      }),
      [`${KEYED_THEN_MISSING}-script.js`]: `return 'ok';`,
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
      virtualNetwork = args.virtualNetwork;
      testRealmPath = args.testRealmPath;
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

  async function keyWriteTicket(
    user: string,
    action: 'add' | 'share' | 'delete',
    { keyId = null }: { keyId?: string | null } = {},
  ) {
    return (
      await mintKeyWriteTicket(dbAdapter, user, {
        action,
        keyId,
        realmURL: action === 'share' ? realmURL.href : null,
        shareId: null,
      })
    ).ticket;
  }

  // Adds a key of `user`'s own, named `name`.
  async function addKey(user: string, name = 'vendor') {
    return await addUserKey(dbAdapter, secretsKeyring(), {
      owner: user,
      name,
      value: `sk-${user.slice(1, 12)}-${name}-routes-key`,
      ticket: await keyWriteTicket(user, 'add'),
    });
  }

  // Adds a key of `user`'s own and shares it in the realm.
  async function shareOwnKey(user: string) {
    let key = await addKey(user);
    return await shareKey(dbAdapter, {
      owner: user,
      realm: realmURL.href,
      keyId: key.id,
      label: `Vendor ${user.slice(1).split(':')[0]}`,
      ticket: await keyWriteTicket(user, 'share', { keyId: key.id }),
    });
  }

  // Approves the Inbox's `operation` as `user`, filling its one slot with
  // `fill`, for automations, as the approval screen does. `automation`
  // names the automation the confirmation also approves, and the version
  // its approver was shown.
  async function approveOperation(
    user: string,
    operation: string,
    fill: { keyId: string } | { shareId: string },
    automation?: { id: string; version: string },
  ) {
    let authorization = await secureSessionAuth(dbAdapter, user);
    let shown = (
      await request
        .get('/_key-bindings/preview')
        .query({
          realm: realmURL.href,
          module: INBOX.module,
          name: INBOX.name,
          operation,
        })
        .set('Authorization', authorization)
    ).body.data.attributes;
    let [slot] = shown.slots;
    return await request
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
                operation,
                expectedDestination: shown.destination,
                slots: {
                  [slot.slot]: {
                    ...fill,
                    expectedFingerprint: slot.fingerprint,
                  },
                },
              },
            ],
            ...(automation ? { automation } : {}),
          },
        },
      });
  }

  // The automation's key approvals, as the switch-on estimate answers them.
  async function keyApprovalsOf(path: string, user = OWNER) {
    let response = await request
      .get(AUTOMATION_SWITCH_ON_PATH)
      .query({ realm: realm.url, automation: cardURL(path) })
      .set('Authorization', auth(user));
    if (response.status !== 200) {
      throw new Error(
        `the estimate answered ${response.status}: ${response.text}`,
      );
    }
    return response.body.data.attributes.keyApprovals;
  }

  // Rewrites the keyed automation's card as the fixture writes it, with its
  // attributes changed by `change`.
  async function editCard(
    path: typeof KEYED,
    change: (attributes: Record<string, unknown>) => void,
  ) {
    let doc = JSON.parse(keyedFixture()[`${path}.json`]);
    change(doc.data.attributes);
    await realm.write(`${path}.json`, JSON.stringify(doc, null, 2));
  }

  // Waits for the automation's row to reach `state`, as an index pass over
  // an edit moves it once the pass commits.
  async function reachesState(path: string, state: string) {
    let deadline = Date.now() + 60_000;
    for (;;) {
      let row = await getAutomation(dbAdapter, automationId(path));
      if (row?.state === state) {
        return row;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `${path} didn't reach ${state}; it is ${row?.state ?? 'not switched on'}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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
      checkPricingAtStartup(
        'automation-routes-test',
        {},
        silentPricingReporter,
      );
      try {
        let response = await request
          .get(AUTOMATION_SWITCH_ON_PATH)
          .query({ realm: realm.url, automation: cardURL() })
          .set('Authorization', auth(OWNER));
        assert.strictEqual(response.status, 503, response.text);
      } finally {
        checkPricingAtStartup(
          'automation-routes-test',
          testPricingEnv(),
          silentPricingReporter,
        );
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

  module('key approvals at switch-on', function (hooks) {
    hooks.beforeEach(function () {
      configureOutbound({ devAllowlist: ['127.0.0.1', 'localhost'] });
    });
    hooks.afterEach(function () {
      resetOutbound();
    });

    function operationStates(keyApprovals: {
      operations: {
        operation: string;
        state: string;
        missing?: { slot: string; canApprove: string }[];
      }[];
    }) {
      return keyApprovals.operations.map(({ operation, state, missing }) => ({
        operation,
        state,
        ...(missing ? { missing } : {}),
      }));
    }

    // Switches the keyed automation on as the owner and approves the owner's
    // own key for it, naming the version switch-on answered.
    async function switchOnApproved(path = KEYED) {
      let shown = (await switchOn(OWNER, path)).body.meta.keyApprovals;
      if (path === KEYED) {
        await approveOwnKey(OWNER, shown.version);
      }
      return await reachesState(path, 'active');
    }

    async function approveOwnKey(user: string, version: string) {
      let key = await addKey(user);
      let approved = await approveOperation(
        user,
        'list',
        { keyId: key.id },
        { id: cardURL(KEYED), version },
      );
      if (approved.status !== 201) {
        throw new Error(
          `approving list answered ${approved.status}: ${approved.text}`,
        );
      }
      return approved;
    }

    // Runs the index hook over the keyed card, as the pass after an edit
    // does, and answers what it did to the automation.
    async function syncAfterEdit() {
      let synced = await syncAutomationsAfterIndex({
        dbAdapter,
        definitionLookup: {} as DefinitionLookup,
        virtualNetwork,
        realmURL: realm.url,
        touched: [`${cardURL(KEYED)}.json`],
        readFile: async (url) =>
          url === `${cardURL(KEYED)}-script.js` ? `return 'ok';` : undefined,
      });
      return synced.get(automationId(KEYED));
    }

    test('an automation that needs no key switches on active, its operations all approved', async function (assert) {
      let response = await switchOn(OWNER, DAILY);
      assert.strictEqual(response.body.data.attributes.state, 'active');
      assert.true(response.body.meta.keyApprovals.approved);
      assert.deepEqual(response.body.meta.keyApprovals.operations, []);
    });

    test('a switch-on whose key approvals the realm can’t check, its script unreadable, is refused', async function (assert) {
      await realm.delete(`${KEYED}-script.js`);
      let response = await post(
        AUTOMATION_SWITCH_ON_PATH,
        OWNER,
        { monthlyCredits: ROOMY_AUTOMATION_CAPS.monthlyCredits },
        { id: cardURL(KEYED) },
      );
      assert.strictEqual(response.status, 422, response.text);
      assert.strictEqual(
        await getAutomation(dbAdapter, automationId(KEYED)),
        undefined,
        'nothing is switched on',
      );
    });

    test('a missing approval the payer can give: the automation switches on waiting, with no next run and nothing enqueued', async function (assert) {
      let response = await switchOn(OWNER, KEYED);
      assert.strictEqual(
        response.body.data.attributes.state,
        'waiting-for-key-approval',
      );
      assert.strictEqual(response.body.data.attributes.nextRun, null);
      let { keyApprovals } = response.body.meta;
      assert.false(keyApprovals.approved);
      assert.strictEqual(typeof keyApprovals.version, 'string');
      assert.deepEqual(operationStates(keyApprovals), [
        {
          operation: 'list',
          state: 'missing',
          missing: [{ slot: 'userKey', canApprove: 'payer' }],
        },
      ]);
      let row = await getAutomation(dbAdapter, automationId(KEYED));
      assert.strictEqual(row?.state, 'waiting-for-key-approval');
      assert.strictEqual(row?.nextRun, null);
      let [{ n }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS n FROM automation_runs WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      assert.strictEqual(n, 0, 'nothing is enqueued while it waits');
    });

    test('a binding approved without naming the automation still leaves the automation waiting for the key owner’s approval of it', async function (assert) {
      let key = await addKey(OWNER);
      let approved = await approveOperation(OWNER, 'list', { keyId: key.id });
      assert.strictEqual(approved.status, 201, approved.text);
      let response = await switchOn(OWNER, KEYED);
      assert.strictEqual(
        response.body.data.attributes.state,
        'waiting-for-key-approval',
      );
      assert.deepEqual(operationStates(response.body.meta.keyApprovals), [
        {
          operation: 'list',
          state: 'missing',
          missing: [{ slot: 'userKey', canApprove: 'payer' }],
        },
      ]);
    });

    test('a missing approval another key owner must give, and one the payer gives for their own share', async function (assert) {
      await shareOwnKey(WRITER);
      let response = await switchOn(OWNER, SHARED);
      assert.strictEqual(
        response.body.data.attributes.state,
        'waiting-for-key-approval',
      );
      assert.deepEqual(operationStates(response.body.meta.keyApprovals), [
        {
          operation: 'shared',
          state: 'missing',
          missing: [{ slot: 'apiKey', canApprove: 'another-key-owner' }],
        },
      ]);

      await shareOwnKey(OWNER);
      assert.deepEqual(
        operationStates(await keyApprovalsOf(SHARED)),
        [
          {
            operation: 'shared',
            state: 'missing',
            missing: [{ slot: 'apiKey', canApprove: 'payer' }],
          },
        ],
        'a share whose key the payer owns is the payer’s to approve',
      );
    });

    test('an {{apiKey}} slot with no share in the realm can be approved by nobody yet', async function (assert) {
      let response = await switchOn(OWNER, SHARED);
      assert.deepEqual(operationStates(response.body.meta.keyApprovals), [
        {
          operation: 'shared',
          state: 'missing',
          missing: [{ slot: 'apiKey', canApprove: 'nobody-yet' }],
        },
      ]);
    });

    test('another key owner’s approval landing makes the automation active, with its next run computed', async function (assert) {
      let share = await shareOwnKey(WRITER);
      let shown = (await switchOn(OWNER, SHARED)).body.meta.keyApprovals;
      let approved = await approveOperation(
        WRITER,
        'shared',
        { shareId: share.id },
        { id: cardURL(SHARED), version: shown.version },
      );
      assert.strictEqual(approved.status, 201, approved.text);
      let row = await getAutomation(dbAdapter, automationId(SHARED));
      assert.strictEqual(row?.state, 'active');
      assert.notStrictEqual(row?.nextRun, null, 'its next run is computed');
      assert.true(
        (await keyApprovalsOf(SHARED)).approved,
        'every operation reads as approved',
      );
      let [record] = await dbAdapter.execute(
        `SELECT approved_by, version FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(SHARED)] },
      );
      assert.strictEqual(record.approved_by, WRITER);
      let version = record.version as {
        payer: string;
        operations: string[];
        triggers: { label: string }[];
      };
      assert.strictEqual(version.payer, OWNER, 'the approval names the payer');
      assert.deepEqual(
        version.triggers.map(({ label }) => label),
        ['daily'],
      );
      assert.strictEqual(version.operations.length, 1);
    });

    test('an approval landing keeps the payer’s own switch-on as the moment a revocation of the payer’s sessions is held against', async function (assert) {
      let share = await shareOwnKey(WRITER);
      let switched = (await switchOn(OWNER, SHARED)).body;
      let before = await getAutomation(dbAdapter, automationId(SHARED));
      // Another second passes, so a schedule restarted at the approval would
      // move the anchor past the switch-on.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      let approved = await approveOperation(
        WRITER,
        'shared',
        { shareId: share.id },
        { id: cardURL(SHARED), version: switched.meta.keyApprovals.version },
      );
      assert.strictEqual(approved.status, 201, approved.text);
      let row = await getAutomation(dbAdapter, automationId(SHARED));
      assert.strictEqual(row?.state, 'active');
      assert.strictEqual(
        row?.scheduledSince,
        before?.scheduledSince,
        'scheduled_since stays the payer’s switch-on',
      );
      assert.true(
        (row?.nextRun ?? 0) > Math.floor(Date.now() / 1000),
        'the next run is after the approval',
      );
    });

    test('resuming a suspended share runs an automation that waited on it again', async function (assert) {
      let share = await shareOwnKey(WRITER);
      let shown = (await switchOn(OWNER, SHARED)).body.meta.keyApprovals;
      let approved = await approveOperation(
        WRITER,
        'shared',
        { shareId: share.id },
        { id: cardURL(SHARED), version: shown.version },
      );
      assert.strictEqual(approved.status, 201, approved.text);
      let suspended = await request
        .post(`/_key-shares/${share.id}/suspend`)
        .set('Authorization', auth(OWNER));
      assert.strictEqual(suspended.status, 200, suspended.text);
      // A run refused share-suspended moves the automation to waiting.
      await waitForKeyApproval(dbAdapter, automationId(SHARED), {
        payer: OWNER,
      });
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SHARED)))?.state,
        'waiting-for-key-approval',
      );
      let ticket = (
        await mintKeyWriteTicket(dbAdapter, WRITER, {
          action: 'resume',
          keyId: null,
          realmURL: null,
          shareId: share.id,
        })
      ).ticket;
      let resumed = await request
        .post(`/_key-shares/${share.id}/resume`)
        .set('Authorization', auth(WRITER))
        .set('Content-Type', 'application/json')
        .send({ meta: { ticket } });
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SHARED)))?.state,
        'active',
        'the approval the share kept matches again',
      );
    });

    test('an approval naming a version the automation no longer has is refused', async function (assert) {
      await switchOn(OWNER, KEYED);
      let key = await addKey(OWNER);
      let approved = await approveOperation(
        OWNER,
        'list',
        { keyId: key.id },
        { id: cardURL(KEYED), version: 'not-the-version-shown' },
      );
      assert.strictEqual(approved.status, 409, approved.text);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'waiting-for-key-approval',
      );
    });

    test('an approval shown at one callApiCalls cap is refused once the card raises the cap', async function (assert) {
      let shown = (await switchOn(OWNER, KEYED)).body.meta.keyApprovals;
      await editCard(KEYED, (attributes) => {
        let caps = attributes.caps as Record<string, number>;
        attributes.caps = { ...caps, callApiCalls: caps.callApiCalls + 100 };
      });
      let key = await addKey(OWNER);
      let approved = await approveOperation(
        OWNER,
        'list',
        { keyId: key.id },
        { id: cardURL(KEYED), version: shown.version },
      );
      assert.strictEqual(approved.status, 409, approved.text);
      let [{ n }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS n FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      assert.strictEqual(n, 0, 'no approval is recorded at a cap never shown');
    });

    test('an approval lasts for the life of the automation: a pause and a resume by the same payer need no approval again', async function (assert) {
      await fund(OWNER);
      await switchOnApproved();
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );
      let resumed = await resume(OWNER, KEYED);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(resumed.body.data.attributes.state, 'active');
      assert.true(resumed.body.meta.keyApprovals.approved);
    });

    for (let [what, edit] of [
      [
        'the script',
        async () => realm.write(`${KEYED}-script.js`, `return 'changed';`),
      ],
      [
        'a trigger',
        async () =>
          editCard(KEYED, (attributes) => {
            attributes.triggers = [
              {
                kind: 'cron',
                label: 'daily',
                expression: '0 10 * * *',
                timeZone: 'UTC',
              },
            ];
          }),
      ],
      [
        'the params',
        async () =>
          editCard(KEYED, (attributes) => {
            attributes.params = [{ name: 'city', value: 'Paris' }];
          }),
      ],
      [
        'the operations',
        async () =>
          editCard(KEYED, (attributes) => {
            attributes.operations = [
              { targetType: INBOX, operation: 'list' },
              { targetType: INBOX, operation: 'shared' },
            ];
          }),
      ],
    ] as const) {
      test(`an edit to ${what} moves the automation back to waiting for key approval`, async function (assert) {
        await switchOnApproved();
        await edit();
        let row = await reachesState(KEYED, 'waiting-for-key-approval');
        assert.strictEqual(row.nextRun, null);
        assert.false((await keyApprovalsOf(KEYED)).approved);
      });
    }

    test('an edit to the caps that asks for no more keeps the approval', async function (assert) {
      await switchOnApproved();
      await editCard(KEYED, (attributes) => {
        let caps = attributes.caps as Record<string, number>;
        attributes.caps = {
          ...caps,
          callApiCalls: caps.callApiCalls - 1,
          seconds: caps.seconds - 1,
        };
      });
      // The index hook's own comparison, run here so the assertion doesn't
      // race the pass's hook.
      let synced = await syncAfterEdit();
      assert.strictEqual(synced?.kind, 'recomputed');
      let row = await getAutomation(dbAdapter, automationId(KEYED));
      assert.strictEqual(row?.state, 'active', 'the automation keeps running');
      let approvals = await keyApprovalsOf(KEYED);
      assert.true(
        approvals.approved,
        'a lower callApiCalls cap and a lower time limit still match the approval',
      );
    });

    test('a change to a trigger’s run count moves the automation back to waiting for key approval', async function (assert) {
      await switchOnApproved();
      await editCard(KEYED, (attributes) => {
        attributes.triggers = [
          {
            kind: 'cron',
            label: 'daily',
            expression: '0 9 * * *',
            timeZone: 'UTC',
            count: 3,
          },
        ];
      });
      let row = await reachesState(KEYED, 'waiting-for-key-approval');
      assert.strictEqual(row.nextRun, null);
    });

    test('an approval a former payer gave with their own key doesn’t hold the automation back once a new payer approves theirs', async function (assert) {
      await fund(OWNER);
      await fund(WRITER);
      await switchOnApproved();
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );
      let resumed = await resume(WRITER, KEYED);
      assert.strictEqual(
        resumed.body.data.attributes.state,
        'waiting-for-key-approval',
      );
      await approveOwnKey(WRITER, resumed.body.meta.keyApprovals.version);
      await reachesState(KEYED, 'active');
      // An edit that asks for no more: the former payer's approval, still
      // recorded beside the new one, is for a binding no run uses now.
      await editCard(KEYED, (attributes) => {
        let caps = attributes.caps as Record<string, number>;
        attributes.caps = { ...caps, seconds: caps.seconds - 1 };
      });
      let synced = await syncAfterEdit();
      assert.strictEqual(synced?.kind, 'recomputed');
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'active',
      );
    });

    test('revoking a binding a former payer approved with their own key leaves the automation running', async function (assert) {
      await fund(OWNER);
      await fund(WRITER);
      await switchOnApproved();
      let [{ binding_id: formerPayers }] = await dbAdapter.execute(
        `SELECT binding_id FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );
      let resumed = await resume(WRITER, KEYED);
      await approveOwnKey(WRITER, resumed.body.meta.keyApprovals.version);
      await reachesState(KEYED, 'active');
      let revoked = await request
        .delete(`/_key-bindings/${formerPayers}`)
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
        .set('Origin', secureOriginURL.origin);
      assert.strictEqual(revoked.status, 204, revoked.text);
      let row = await getAutomation(dbAdapter, automationId(KEYED));
      assert.strictEqual(row?.state, 'active');
      assert.notStrictEqual(row?.nextRun, null);
    });

    test('revoking the binding of an operation the card no longer declares leaves the automation running', async function (assert) {
      await fund(OWNER);
      await switchOnApproved();
      let [{ binding_id }] = await dbAdapter.execute(
        `SELECT binding_id FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      await editCard(KEYED, (attributes) => {
        attributes.operations = [];
      });
      await syncAfterEdit();
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'active',
      );
      let revoked = await request
        .delete(`/_key-bindings/${binding_id}`)
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
        .set('Origin', secureOriginURL.origin);
      assert.strictEqual(revoked.status, 204, revoked.text);
      // The revocation moves it to waiting, and the check once it commits
      // finds nothing missing.
      let row = await getAutomation(dbAdapter, automationId(KEYED));
      assert.strictEqual(row?.state, 'active');
      assert.notStrictEqual(row?.nextRun, null);
    });

    test('revoking the binding an automation uses moves it to waiting for key approval', async function (assert) {
      await switchOnApproved();
      let [{ binding_id }] = await dbAdapter.execute(
        `SELECT binding_id FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      let revoked = await request
        .delete(`/_key-bindings/${binding_id}`)
        .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
        .set('Origin', secureOriginURL.origin);
      assert.strictEqual(revoked.status, 204, revoked.text);
      let row = await getAutomation(dbAdapter, automationId(KEYED));
      assert.strictEqual(row?.state, 'waiting-for-key-approval');
      assert.strictEqual(row?.nextRun, null);
      let [{ n }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS n FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      assert.strictEqual(
        n,
        0,
        'the automation’s approval went with its binding',
      );
    });

    test('an approval that ended after switch-on is caught by a run’s admission in the realm', async function (assert) {
      await switchOnApproved();
      let ask = async ({ manual = false }: { manual?: boolean } = {}) => {
        let { token, run } = await createAutomationRunToken(
          dbAdapter,
          realm,
          OWNER,
          { automation: KEYED },
        );
        if (manual) {
          await dbAdapter.execute(
            `UPDATE automation_runs SET trigger = $1 WHERE id = $2`,
            { bind: [MANUAL_RUN_TRIGGER, run.id] },
          );
        }
        let response = (await realm.handleAutomation(
          new Request(`${realm.url}_run-admission`, {
            headers: {
              Accept: 'application/vnd.api+json',
              Authorization: `Bearer ${token}`,
            },
          }),
        ))!;
        return (await response.json()).data.attributes;
      };
      assert.deepEqual(await ask(), { refusal: null, operations: 1 });

      await dbAdapter.execute(
        `DELETE FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      let refused = await ask();
      assert.strictEqual(refused.refusal?.code, 'key-approval-ended');
      assert.strictEqual(refused.refusal?.operation, 'list');
      assert.deepEqual(
        await ask({ manual: true }),
        { refusal: null, operations: 1 },
        'a run started by hand needs no automation approval',
      );
    });

    // The automations the realm sends an `automation` event for while `act`
    // runs, as their realm's direct writers receive it.
    async function automationEventsDuring(act: () => Promise<unknown>) {
      let sent: string[] = [];
      let original = realm.broadcastAutomationEvent;
      realm.broadcastAutomationEvent = async (event) => {
        sent.push(event.automation);
        return await original.call(realm, event);
      };
      try {
        await act();
      } finally {
        realm.broadcastAutomationEvent = original;
      }
      return sent;
    }

    async function approvalRowsOf(path: string) {
      return await dbAdapter.execute(
        `SELECT binding_id, approved_by, version_key, updated_at FROM automation_key_approvals WHERE automation_id = $1 ORDER BY binding_id`,
        { bind: [automationId(path)] },
      );
    }

    test('an edit and its revert leave the automation active, with nobody asked to approve it again', async function (assert) {
      await switchOnApproved();
      let approvals = await approvalRowsOf(KEYED);
      await realm.write(`${KEYED}-script.js`, `return 'changed';`);
      await reachesState(KEYED, 'waiting-for-key-approval');
      await realm.write(`${KEYED}-script.js`, `return 'ok';`);
      let row = await reachesState(KEYED, 'active');
      assert.notStrictEqual(row.nextRun, null, 'its schedule starts again');
      assert.deepEqual(
        await approvalRowsOf(KEYED),
        approvals,
        'the approval its key owner gave matches again, unchanged',
      );
      assert.true((await keyApprovalsOf(KEYED)).approved);
    });

    test('an edit that adds an operation needing a key to an automation with no approval moves it to waiting for key approval at once', async function (assert) {
      let switchedOn = await switchOn(OWNER, DAILY);
      assert.strictEqual(switchedOn.body.data.attributes.state, 'active');
      await realm.write(
        `${DAILY}.json`,
        automationFixture({
          operations: [{ type: INBOX, names: ['list'] }],
          path: DAILY,
          triggers: [
            {
              kind: 'cron',
              label: 'daily',
              expression: '0 9 * * *',
              timeZone: 'UTC',
            },
          ],
        })[`${DAILY}.json`],
      );
      let row = await reachesState(DAILY, 'waiting-for-key-approval');
      assert.strictEqual(row.nextRun, null);
      let [{ n }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS n FROM automation_runs WHERE automation_id = $1`,
        { bind: [automationId(DAILY)] },
      );
      assert.strictEqual(n, 0, 'no run had to be refused to move it');
      assert.deepEqual(operationStates(await keyApprovalsOf(DAILY)), [
        {
          operation: 'list',
          state: 'missing',
          missing: [{ slot: 'userKey', canApprove: 'payer' }],
        },
      ]);
    });

    test('deleting a key sends an automation event for each automation it moved to waiting for key approval', async function (assert) {
      await switchOnApproved();
      let [{ key_id: keyId }] = await dbAdapter.execute(
        `SELECT b.key_id FROM automation_key_approvals a JOIN key_bindings b ON b.id = a.binding_id WHERE a.automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      let sent = await automationEventsDuring(async () => {
        let deleted = await request
          .delete(`/_user-keys/${keyId}`)
          .set('Authorization', auth(OWNER))
          .set('Content-Type', 'application/json')
          .send({
            meta: {
              ticket: await keyWriteTicket(OWNER, 'delete', {
                keyId: keyId as string,
              }),
            },
          });
        assert.strictEqual(deleted.status, 204, deleted.text);
      });
      assert.deepEqual(sent, [automationId(KEYED)]);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'waiting-for-key-approval',
      );
    });

    test('removing a grant sends an automation event for each automation it moved to waiting for key approval', async function (assert) {
      await switchOnApproved();
      let [{ grant_id: grantId }] = await dbAdapter.execute(
        `SELECT b.grant_id FROM automation_key_approvals a JOIN key_bindings b ON b.id = a.binding_id WHERE a.automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      let sent = await automationEventsDuring(async () => {
        let removed = await request
          .delete(`/_user-key-grants/${grantId}`)
          .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
          .set('Origin', secureOriginURL.origin);
        assert.strictEqual(removed.status, 200, removed.text);
      });
      assert.deepEqual(sent, [automationId(KEYED)]);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'waiting-for-key-approval',
      );
    });

    test('deleting a key sends an automation event for a paused automation its bindings served, which keeps its pause', async function (assert) {
      await switchOnApproved();
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );
      let [{ key_id: keyId }] = await dbAdapter.execute(
        `SELECT b.key_id FROM automation_key_approvals a JOIN key_bindings b ON b.id = a.binding_id WHERE a.automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      let sent = await automationEventsDuring(async () => {
        let deleted = await request
          .delete(`/_user-keys/${keyId}`)
          .set('Authorization', auth(OWNER))
          .set('Content-Type', 'application/json')
          .send({
            meta: {
              ticket: await keyWriteTicket(OWNER, 'delete', {
                keyId: keyId as string,
              }),
            },
          });
        assert.strictEqual(deleted.status, 204, deleted.text);
      });
      assert.deepEqual(
        sent,
        [automationId(KEYED)],
        'its approvals changed, so an open console reads it again',
      );
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'paused',
      );
    });

    // Changes a file of the realm on disk, as an edit made while no realm
    // server watched the files does: no incremental pass indexes it, and the
    // realm holds none of its earlier bytes, so a from-scratch pass is the
    // first to index it.
    function editUnwatched(path: string, content: string) {
      writeFileSync(join(testRealmPath, path), content);
      realm.clearLocalSourceCaches();
    }

    // Runs a from-scratch pass over the realm, whose worker asks the realm to
    // check its automations' key approvals once the pass's hook has synced
    // them, and answers how many checks the realm ran. With `realmChecks`
    // false the realm answers the request without checking, which leaves the
    // automations as the hook alone moves them.
    async function fromScratchPass({ realmChecks = true } = {}) {
      let checks: Promise<void>[] = [];
      let original = realm.followAutomationKeyApprovalsAfterFromScratchPass;
      realm.followAutomationKeyApprovalsAfterFromScratchPass = function () {
        let check = realmChecks ? original.call(realm) : Promise.resolve();
        checks.push(check);
        return check;
      };
      try {
        await realm.reindex();
        await Promise.all(checks);
      } finally {
        realm.followAutomationKeyApprovalsAfterFromScratchPass = original;
      }
      return checks.length;
    }

    test('a revert a from-scratch pass is the first to index runs a waiting automation again, with nobody asked to approve it again', async function (assert) {
      await switchOnApproved();
      let approvals = await approvalRowsOf(KEYED);
      await realm.write(`${KEYED}-script.js`, `return 'changed';`);
      await reachesState(KEYED, 'waiting-for-key-approval');
      // The realm's own check after that pass reads the script as the realm
      // holds it, so it settles before the file changes under it.
      await realm.incrementalIndexing();
      editUnwatched(`${KEYED}-script.js`, `return 'ok';`);

      assert.strictEqual(
        await fromScratchPass({ realmChecks: false }),
        1,
        'the worker asks the realm once',
      );
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'waiting-for-key-approval',
        "the worker's index hook alone leaves it waiting",
      );

      await fromScratchPass();
      let row = await reachesState(KEYED, 'active');
      assert.notStrictEqual(row.nextRun, null, 'its schedule starts again');
      assert.deepEqual(
        await approvalRowsOf(KEYED),
        approvals,
        'the approval its key owner gave matches again, unchanged',
      );
    });

    test('an edit a from-scratch pass is the first to index, adding an operation needing a key to an automation with no approval, moves it to waiting for key approval', async function (assert) {
      let switchedOn = await switchOn(OWNER, DAILY);
      assert.strictEqual(switchedOn.body.data.attributes.state, 'active');
      editUnwatched(
        `${DAILY}.json`,
        automationFixture({
          operations: [{ type: INBOX, names: ['list'] }],
          path: DAILY,
          triggers: [
            {
              kind: 'cron',
              label: 'daily',
              expression: '0 9 * * *',
              timeZone: 'UTC',
            },
          ],
        })[`${DAILY}.json`],
      );

      await fromScratchPass();
      let row = await reachesState(DAILY, 'waiting-for-key-approval');
      assert.strictEqual(row.nextRun, null);
      assert.deepEqual(operationStates(await keyApprovalsOf(DAILY)), [
        {
          operation: 'list',
          state: 'missing',
          missing: [{ slot: 'userKey', canApprove: 'payer' }],
        },
      ]);
    });

    test('a from-scratch pass leaves a paused automation paused', async function (assert) {
      await switchOnApproved();
      await realm.write(`${KEYED}-script.js`, `return 'changed';`);
      await reachesState(KEYED, 'waiting-for-key-approval');
      await realm.incrementalIndexing();
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );
      editUnwatched(`${KEYED}-script.js`, `return 'ok';`);

      await fromScratchPass();
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'paused',
      );
    });

    test('the request to check the automations’ key approvals takes a direct writer of the realm', async function (assert) {
      let path = `${new URL(realm.url).pathname}_follow-automation-key-approvals`;
      let refused = await request
        .post(path)
        .set('Accept', 'application/vnd.api+json')
        .set('Authorization', `Bearer ${createJWT(realm, READER, ['read'])}`);
      assert.strictEqual(refused.status, 403, refused.text);
      let answered = await request
        .post(path)
        .set('Accept', 'application/vnd.api+json')
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, WRITER, ['read', 'write'])}`,
        );
      assert.strictEqual(answered.status, 204, answered.text);
    });

    test('approving a slot again with another key sends an automation event for the automation whose approval it ended', async function (assert) {
      await switchOnApproved();
      let other = await addKey(OWNER, 'vendor-backup');
      let sent = await automationEventsDuring(async () => {
        let approved = await approveOperation(OWNER, 'list', {
          keyId: other.id,
        });
        assert.strictEqual(approved.status, 201, approved.text);
      });
      assert.deepEqual(sent, [automationId(KEYED)]);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'waiting-for-key-approval',
        'its approval was given for the key the binding sent before',
      );
    });

    // Switches the shared automation on with WRITER's share approved for it,
    // and answers the share.
    async function switchOnShared() {
      let share = await shareOwnKey(WRITER);
      let shown = (await switchOn(OWNER, SHARED)).body.meta.keyApprovals;
      let approved = await approveOperation(
        WRITER,
        'shared',
        { shareId: share.id },
        { id: cardURL(SHARED), version: shown.version },
      );
      if (approved.status !== 201) {
        throw new Error(
          `approving shared answered ${approved.status}: ${approved.text}`,
        );
      }
      await reachesState(SHARED, 'active');
      return share;
    }

    test('unsharing a key sends an automation event for each automation its share’s bindings served, and moves it to waiting for key approval', async function (assert) {
      let share = await switchOnShared();
      let sent = await automationEventsDuring(async () => {
        let unshared = await request
          .delete(`/_key-shares/${share.id}`)
          .set('Authorization', auth(WRITER));
        assert.strictEqual(unshared.status, 204, unshared.text);
      });
      assert.deepEqual(sent, [automationId(SHARED)]);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SHARED)))?.state,
        'waiting-for-key-approval',
      );
    });

    test('swapping a key into a share sends an automation event for each automation whose approval of its bindings the swap ended', async function (assert) {
      let share = await switchOnShared();
      let suspended = await request
        .post(`/_key-shares/${share.id}/suspend`)
        .set('Authorization', auth(OWNER));
      assert.strictEqual(suspended.status, 200, suspended.text);
      let key = await addKey(OWNER);
      let ticket = (
        await mintKeyWriteTicket(dbAdapter, OWNER, {
          action: 'swap',
          keyId: key.id,
          realmURL: null,
          shareId: share.id,
        })
      ).ticket;
      let sent = await automationEventsDuring(async () => {
        let swapped = await request
          .post(`/_key-shares/${share.id}/swap`)
          .set('Authorization', await secureSessionAuth(dbAdapter, OWNER))
          .set('Origin', secureOriginURL.origin)
          .set('Content-Type', 'application/json')
          .send({
            data: { type: 'key-share', attributes: { keyId: key.id } },
            meta: { ticket },
          });
        assert.strictEqual(swapped.status, 200, swapped.text);
      });
      assert.deepEqual(sent, [automationId(SHARED)]);
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(SHARED)))?.state,
        'waiting-for-key-approval',
        'the approval was given for the key the share held before',
      );
    });

    test('a revert written with no realm events runs the automation again and sends no automation event', async function (assert) {
      await switchOnApproved();
      await realm.write(`${KEYED}-script.js`, `return 'changed';`);
      await reachesState(KEYED, 'waiting-for-key-approval');
      await realm.incrementalIndexing();
      let sent = await automationEventsDuring(async () => {
        await realm.write(`${KEYED}-script.js`, `return 'ok';`, {
          broadcastRealmEvents: false,
        });
        await realm.incrementalIndexing();
      });
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'active',
        'the realm’s check moved the row once the pass landed',
      );
      assert.deepEqual(sent, [], 'and reported nothing');
    });

    test('removing the automation removes its approvals', async function (assert) {
      await switchOnApproved();
      assert.strictEqual(
        (await post(AUTOMATION_REMOVE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );
      let [{ n }] = await dbAdapter.execute(
        `SELECT COUNT(*)::int AS n FROM automation_key_approvals WHERE automation_id = $1`,
        { bind: [automationId(KEYED)] },
      );
      assert.strictEqual(n, 0);
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
    // operation with it, for automations, as the approval screen does,
    // naming the automation when `automation` says which.
    async function approveOwnKey(
      user: string,
      automation?: { id: string; version: string },
    ) {
      let key = await addKey(user);
      let approved = await approveOperation(
        user,
        'list',
        { keyId: key.id },
        automation,
      );
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

    test('a new payer with no binding of their own for a {{userKey}} slot resumes it waiting for key approval, and it runs once they approve it', async function (assert) {
      await fund(OWNER);
      await fund(WRITER);
      let shown = (await switchOn(OWNER, KEYED)).body.meta.keyApprovals;
      await approveOwnKey(OWNER, {
        id: cardURL(KEYED),
        version: shown.version,
      });
      assert.strictEqual(
        (await getAutomation(dbAdapter, automationId(KEYED)))?.state,
        'active',
      );
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );

      let resumed = await resume(WRITER, KEYED);
      assert.strictEqual(resumed.status, 200, resumed.text);
      assert.strictEqual(
        resumed.body.data.attributes.state,
        'waiting-for-key-approval',
        'the new payer has no approval of their own, so the automation waits',
      );
      assert.strictEqual(resumed.body.data.attributes.nextRun, null);
      assert.deepEqual(
        resumed.body.meta.keyApprovals.operations.map(
          (o: { operation: string; state: string; missing?: unknown }) => [
            o.operation,
            o.state,
            o.missing,
          ],
        ),
        [['list', 'missing', [{ slot: 'userKey', canApprove: 'payer' }]]],
        'the new payer approves their own key',
      );

      await approveOwnKey(WRITER, {
        id: cardURL(KEYED),
        version: resumed.body.meta.keyApprovals.version,
      });
      let row = await getAutomation(dbAdapter, automationId(KEYED));
      assert.strictEqual(row?.state, 'active', 'the approval landing runs it');
      assert.strictEqual(row?.payer, WRITER);
      assert.notStrictEqual(row?.nextRun, null);
    });

    test('a resume passes over a missing key approval and answers the refusal of a later operation', async function (assert) {
      await fund(OWNER);
      await fund(WRITER);
      await switchOn(OWNER, KEYED_THEN_MISSING);
      assert.strictEqual(
        (
          await post(
            AUTOMATION_PAUSE_PATH,
            OWNER,
            {},
            { id: cardURL(KEYED_THEN_MISSING) },
          )
        ).status,
        200,
      );
      // WRITER has no binding for `list`, which only makes the automation
      // wait; `nowhere` isn't an operation the Inbox defines, which a run
      // would be refused for.
      let refused = await resume(WRITER, KEYED_THEN_MISSING);
      assert.strictEqual(refused.status, 422, refused.text);
      assert.strictEqual(refused.body.meta.code, 'target-not-found');
      await assertStillPaused(assert, KEYED_THEN_MISSING, OWNER);
    });

    test('a resume whose key approvals the realm can’t check, its script unreadable once admitted, is refused', async function (assert) {
      await fund(OWNER);
      await switchOn(OWNER, KEYED);
      assert.strictEqual(
        (await post(AUTOMATION_PAUSE_PATH, OWNER, {}, { id: cardURL(KEYED) }))
          .status,
        200,
      );
      // The script reads for the payer's admission and then can't be read
      // for the key approvals check.
      let original = realm.checkAutomationKeyApprovals.bind(realm);
      realm.checkAutomationKeyApprovals = async () => undefined;
      try {
        let refused = await resume(OWNER, KEYED);
        assert.strictEqual(refused.status, 422, refused.text);
      } finally {
        realm.checkAutomationKeyApprovals = original;
      }
      await assertStillPaused(assert, KEYED, OWNER);
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
        // Written before ADR 049, with the cost in its message as well.
        line('resolve test/model: 200 (900 ms, $0.002000)', {
          kind: 'resolve',
          data: { model: 'test/model', status: 200, costInUsd: 0.002 },
        }),
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
      assert.deepEqual(
        last.lines[0].data,
        { model: 'test/model', status: 200 },
        'a stored AI request’s cost is never served to a writer',
      );
      assert.strictEqual(
        last.lines[0].message,
        'resolve test/model: 200 (900 ms)',
        'nor is the cost a stored line’s message names',
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
