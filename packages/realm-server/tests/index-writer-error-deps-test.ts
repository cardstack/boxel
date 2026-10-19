import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { IndexWriter, VirtualNetwork } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let indexWriter: IndexWriter;
  let virtualNetwork: VirtualNetwork;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    indexWriter = new IndexWriter(adapter);
    virtualNetwork = new VirtualNetwork();
    virtualNetwork.addRealmMapping(
      '@cardstack/base/',
      'http://localhost:4201/base/',
    );
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  test("an error doc's dependencies keep their identifier form", async function (assert) {
    let batch = await indexWriter.createBatch(
      new URL(testRealm),
      virtualNetwork,
      undefined,
      { splitPrerenderHtml: false },
    );
    let brokenURL = new URL(`${testRealm}broken.json`);
    await batch.invalidate([brokenURL]);
    await batch.updateEntry(brokenURL, {
      type: 'instance-error',
      error: {
        id: brokenURL.href,
        status: 500,
        title: 'broken',
        message: 'a render that failed',
        additionalErrors: null,
        deps: [
          '@cardstack/base/card-api.gts',
          './person.gts',
          `${testRealm}pets/pet.gts?x=1#y`,
          '@cardstack/boxel-ui/components',
          'lodash',
        ],
      },
    });
    await batch.done();

    let [row] = (await adapter.execute(
      `SELECT error_doc FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      { bind: [brokenURL.href] },
    )) as { error_doc: { deps?: string[] } | null }[];
    assert.deepEqual(row?.error_doc?.deps, [
      '@cardstack/base/card-api',
      `${testRealm}person`,
      `${testRealm}pets/pet`,
      '@cardstack/boxel-ui/components',
      'lodash',
    ]);
  });
});
