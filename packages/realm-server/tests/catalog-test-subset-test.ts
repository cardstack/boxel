import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../server.ts';
import { closeServer, setupPermissionedRealmCached } from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// A card in a test realm adopting from a definition in the catalog test
// subset, reached through `@cardstack/catalog/` as it is in a deployment.
module(basename(import.meta.filename), function (hooks) {
  let testRealm: Realm;
  let testRealmHttpServer: Server;

  setupCatalogTestSubset(hooks);

  hooks.afterEach(async function () {
    await closeServer(testRealmHttpServer);
  });

  setupPermissionedRealmCached(hooks, {
    fixture: 'blank',
    permissions: { '*': ['read'] },
    onRealmSetup({ testRealm: realm, testRealmHttpServer: server }) {
      testRealm = realm;
      testRealmHttpServer = server;
    },
  });

  test('an instance of a catalog test subset definition indexes', async function (assert) {
    await testRealm.write(
      'policies/education.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: 'Education' },
            rules: [
              {
                targetType: { module: '../classroom', name: 'Classroom' },
                grants: [
                  { operation: 'read' },
                  {
                    operation: 'appendActivity',
                    where: { bxl: 'actor() in .teacherIds', snapshot: true },
                  },
                ],
              },
            ],
          },
          meta: {
            adoptsFrom: {
              module: rri('@cardstack/catalog/realm-policy/realm-policy'),
              name: 'RealmPolicy',
            },
          },
        },
      }),
    );

    let doc = await testRealm.realmIndexQueryEngine.cardDocument(
      new URL(`${testRealm.url}policies/education`),
    );
    assert.strictEqual(
      doc?.type,
      'doc',
      `the instance indexes cleanly: ${JSON.stringify(
        doc?.type === 'error' ? doc.error : undefined,
      )}`,
    );
    let rules = (doc?.type === 'doc' ? doc.doc.data.attributes?.rules : []) as {
      grants: { operation: string; where: unknown }[];
    }[];
    assert.deepEqual(
      rules[0]?.grants,
      [
        { operation: 'read', where: null },
        {
          operation: 'appendActivity',
          where: { bxl: 'actor() in .teacherIds', snapshot: true },
        },
      ],
      "the catalog definition's fields, including its serializer-backed predicate, round-trip",
    );
  });
});
