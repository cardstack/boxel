import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type {
  DBAdapter,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  insertPermissions,
  internalKeyFor,
  ri,
  rri,
} from '@cardstack/runtime-common';
import {
  getAutomation,
  switchOnAutomation,
} from '@cardstack/runtime-common/automations';
import {
  automationRef,
  readAutomationDeclaration,
} from '@cardstack/runtime-common/automation-declaration';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// The catalog's Automation card as the index stores it, and the declaration
// the server reads from that row.
module(basename(import.meta.filename), function (hooks) {
  let testRealm: Realm;
  let testRealmHttpServer: Server;
  let dbAdapter: DBAdapter;
  let virtualNetwork: VirtualNetwork;

  setupCatalogTestSubset(hooks);

  hooks.afterEach(async function () {
    await closeServer(testRealmHttpServer);
  });

  setupPermissionedRealmCached(hooks, {
    fixture: 'blank',
    permissions: { '*': ['read'] },
    onRealmSetup({
      testRealm: realm,
      testRealmHttpServer: server,
      dbAdapter: adapter,
      virtualNetwork: network,
    }) {
      testRealm = realm;
      testRealmHttpServer = server;
      dbAdapter = adapter;
      virtualNetwork = network;
    },
  });

  const attributes = {
    cardInfo: { name: 'Nightly import' },
    triggers: [
      {
        kind: 'cron',
        label: 'nightly',
        expression: '30 2 * * *',
        timeZone: 'America/Chicago',
        untilDate: '2026-12-31',
        untilTime: '06:00',
        count: 30,
        date: null,
        time: null,
        webhookPath: null,
      },
      {
        kind: 'once',
        label: 'launch',
        expression: null,
        timeZone: 'America/Chicago',
        untilDate: null,
        untilTime: null,
        count: null,
        date: '2026-11-20',
        time: '15:00',
        webhookPath: null,
      },
      {
        kind: 'webhook',
        label: 'push',
        expression: null,
        timeZone: null,
        untilDate: null,
        untilTime: null,
        count: null,
        date: null,
        time: null,
        webhookPath: 'github-push',
      },
    ],
    operations: [
      {
        targetType: { module: '../github/repo', name: 'Repo' },
        operation: 'openIssues',
      },
    ],
    caps: {
      callApiCalls: 10,
      responseBytes: 1000000,
      resolveCalls: 2,
      writes: 5,
      seconds: 300,
      dailyCredits: 50,
      monthlyCredits: 500,
    },
    params: [{ name: 'owner', value: 'cardstack' }],
    batchedAI: true,
    batchDeadlineMinutes: 90,
  };

  async function writeAutomation(path: string, extra: object = {}) {
    await testRealm.write(
      `${path}.json`,
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { ...attributes, ...extra },
          relationships: {
            script: { links: { self: '../scripts/nightly-import.js' } },
          },
          meta: { adoptsFrom: automationRef },
        },
      }),
    );
  }

  test('an Automation instance indexes, and its fields round-trip', async function (assert) {
    await testRealm.write(
      'scripts/nightly-import.js',
      "await realm.fs.writeText('imported.txt', 'done');\n",
    );
    await writeAutomation('automations/nightly');

    let doc = await testRealm.realmIndexQueryEngine.cardDocument(
      new URL(`${testRealm.url}automations/nightly`),
    );
    assert.strictEqual(
      doc?.type,
      'doc',
      `the instance indexes cleanly: ${JSON.stringify(
        doc?.type === 'error' ? doc.error : undefined,
      )}`,
    );
    if (doc?.type !== 'doc') {
      throw new Error('the instance did not index');
    }
    let stored = doc.doc.data.attributes!;
    for (let name of [
      'triggers',
      'caps',
      'params',
      'batchedAI',
      'batchDeadlineMinutes',
    ] as const) {
      assert.deepEqual(stored[name], attributes[name], `${name} round-trips`);
    }
    assert.deepEqual(
      stored.operations,
      [
        {
          targetType: { module: `${testRealm.url}github/repo`, name: 'Repo' },
          operation: 'openIssues',
        },
      ],
      'operations round-trip, with the code ref resolved against the card',
    );
    assert.strictEqual(
      (doc.doc.data.relationships?.script as { links: { self: string } })?.links
        ?.self,
      '../scripts/nightly-import.js',
      'the script link round-trips',
    );
  });

  test('the server reads the indexed instance into its declaration', async function (assert) {
    await testRealm.write(
      'scripts/nightly-import.js',
      "await realm.fs.writeText('imported.txt', 'done');\n",
    );
    await writeAutomation('automations/nightly');

    let entry = await testRealm.realmIndexQueryEngine.instance(
      new URL(`${testRealm.url}automations/nightly`),
    );
    if (entry?.type !== 'instance') {
      throw new Error(`no indexed instance: ${JSON.stringify(entry)}`);
    }
    let automationTypeKey = internalKeyFor(
      automationRef,
      undefined,
      createVirtualNetwork(),
    );
    assert.true(
      entry.types?.includes(automationTypeKey),
      `the adoption chain names the catalog type as ${automationTypeKey}`,
    );
    let result = readAutomationDeclaration(
      {
        url: entry.canonicalURL,
        realmURL: entry.realmURL,
        types: entry.types,
        instance: entry.instance,
      },
      { automationTypeKey },
    );
    assert.true(
      result.ok,
      `the declaration reads: ${JSON.stringify(result.ok ? [] : result.problems)}`,
    );
    if (!result.ok) {
      throw new Error('the declaration did not read');
    }
    let { declaration } = result;
    assert.strictEqual(
      declaration.script,
      `${testRealm.url}scripts/nightly-import.js`,
    );
    assert.deepEqual(
      declaration.triggers.map((t) => [t.kind, t.label]),
      [
        ['cron', 'nightly'],
        ['once', 'launch'],
        ['webhook', 'push'],
      ],
    );
    assert.deepEqual(declaration.operations, [
      {
        targetType: { module: `${testRealm.url}github/repo`, name: 'Repo' },
        operation: 'openIssues',
      },
    ]);
    assert.deepEqual(declaration.caps, attributes.caps);
    assert.deepEqual(declaration.params, { owner: 'cardstack' });
    assert.true(declaration.batchedAI);
    assert.strictEqual(declaration.batchDeadlineMinutes, 90);
  });

  test('an indexed instance with a trigger that fires too often is reported', async function (assert) {
    await writeAutomation('automations/too-often', {
      triggers: [{ ...attributes.triggers[0], expression: '*/2 * * * *' }],
    });
    let entry = await testRealm.realmIndexQueryEngine.instance(
      new URL(`${testRealm.url}automations/too-often`),
    );
    if (entry?.type !== 'instance') {
      throw new Error(`no indexed instance: ${JSON.stringify(entry)}`);
    }
    let result = readAutomationDeclaration(
      {
        url: entry.canonicalURL,
        realmURL: entry.realmURL,
        types: entry.types,
        instance: entry.instance,
      },
      {
        automationTypeKey: internalKeyFor(
          automationRef,
          undefined,
          createVirtualNetwork(),
        ),
      },
    );
    assert.deepEqual(
      result.ok ? [] : result.problems.map((p) => [p.code, p.path]),
      [['cron-too-frequent', 'triggers.0.expression']],
    );
  });

  test("indexing a switched-on automation's card keeps its row in step, and deleting the card removes the row", async function (assert) {
    const owner = '@automation-owner:localhost';
    await insertPermissions(dbAdapter, new URL(testRealm.url), {
      [owner]: ['read', 'write', 'realm-owner'],
    });
    await testRealm.write(
      'scripts/nightly-import.js',
      "await realm.fs.writeText('imported.txt', 'done');\n",
    );
    let nightly = {
      ...attributes.triggers[0],
      untilDate: null,
      untilTime: null,
      count: null,
    };
    await writeAutomation('automations/in-step', { triggers: [nightly] });

    let automationId = rri(`${testRealm.url}automations/in-step`);
    let entry = await testRealm.realmIndexQueryEngine.instance(
      new URL(automationId),
    );
    if (entry?.type !== 'instance') {
      throw new Error(`no indexed instance: ${JSON.stringify(entry)}`);
    }
    // Switch-on takes the declaration read from the card's own id.
    let read = readAutomationDeclaration(
      {
        url: automationId,
        realmURL: entry.realmURL,
        types: entry.types,
        instance: entry.instance,
      },
      {
        automationTypeKey: internalKeyFor(
          automationRef,
          undefined,
          virtualNetwork,
        ),
        virtualNetwork,
      },
    );
    if (!read.ok) {
      throw new Error(`no declaration: ${JSON.stringify(read.problems)}`);
    }
    let switchedOn = await switchOnAutomation(
      dbAdapter,
      {
        automationId,
        realm: ri(testRealm.url),
        user: owner,
        declaration: read.declaration,
      },
      { matrixServerName: 'localhost', virtualNetwork },
    );
    if (!switchedOn.ok) {
      throw new Error(`switch-on refused: ${switchedOn.reason}`);
    }
    assert.strictEqual(
      switchedOn.automation.state,
      'active',
      'the automation is switched on with a nightly run ahead',
    );

    // The card's only trigger becomes a one-time run whose time has passed.
    await writeAutomation('automations/in-step', {
      triggers: [
        {
          ...attributes.triggers[1],
          date: '2020-01-01',
          time: '09:00',
        },
      ],
    });
    let done = await getAutomation(dbAdapter, automationId);
    assert.strictEqual(done?.state, 'done', 'the spent automation is done');
    assert.strictEqual(done?.nextRun, null);

    await testRealm.delete('automations/in-step.json');
    assert.strictEqual(
      await getAutomation(dbAdapter, automationId),
      undefined,
      "deleting the card removes the automation's row",
    );
  });
});
