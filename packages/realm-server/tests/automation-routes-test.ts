import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomUUID } from 'crypto';
import type { SuperTest, Test } from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createAutomationRun,
  getAutomationRun,
  ri,
  rri,
  type AutomationRun,
  type Realm,
} from '@cardstack/runtime-common';
import { getAutomation } from '@cardstack/runtime-common/automations';
import {
  AUTOMATION_PAUSE_PATH,
  AUTOMATION_PREVIEW_PATH,
  AUTOMATION_REMOVE_PATH,
  AUTOMATION_RESUME_PATH,
  AUTOMATION_RUN_CANCEL_PATH,
  AUTOMATION_RUN_NOW_PATH,
  AUTOMATION_SWITCH_ON_PATH,
} from '@cardstack/runtime-common/automation-routes';
import {
  automationFixture,
  realmSecretSeed,
  ROOMY_AUTOMATION_CAPS,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';
import {
  checkPricingAtStartup,
  currentPricing,
  type PricingReporter,
} from '../lib/pricing.ts';

// The realm-server routes a direct writer drives an automation with: the
// switch-on estimate, switch-on, Preview, Run now, pause, resume, remove and
// cancel. Each acts as the session's own user, and answers only a direct
// writer of the realm the request names.

const realmURL = new URL('http://127.0.0.1:4444/automation-routes-test/');
const OWNER = '@automation-routes-owner:localhost';
const WRITER = '@automation-routes-writer:localhost';
const READER = '@automation-routes-reader:localhost';
const REALM_USER = '@node-test_realm:localhost';

const DAILY = 'automation/daily';
const NO_MONTHLY_CAP = 'automation/no-monthly-cap';

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
  setupPermissionedRealmCached(hooks, {
    realmURL,
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
      ...automationFixture({
        operations: [],
        path: NO_MONTHLY_CAP,
        caps: { dailyCredits: 50, monthlyCredits: null },
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
  });
});
