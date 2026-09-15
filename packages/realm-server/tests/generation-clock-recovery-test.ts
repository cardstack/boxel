import QUnit from 'qunit';
import { dirSync, type DirResult } from 'tmp';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  rri,
  type DefinitionLookup,
  type Realm,
} from '@cardstack/runtime-common';
import { createRealm, setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const root = 'http://127.0.0.1:4447/clock/';

module('Generation clock | index recovery', function (hooks) {
  let db: PgAdapter;
  let writer: IndexWriter;
  let network: VirtualNetwork;
  let realm: Realm;
  let dir: DirResult;

  setupDB(hooks, {
    beforeEach: async (adapter, publisher) => {
      db = adapter;
      writer = new IndexWriter(db);
      network = new VirtualNetwork();
      dir = dirSync({ unsafeCleanup: true });
      ({ realm } = await createRealm({
        dir: dir.name,
        realmURL: root,
        dbAdapter: db,
        publisher,
        virtualNetwork: network,
        // The fixture publishes rendered bytes. This HTML-only read must
        // never need a module, query field or a browser to answer an ETag.
        definitionLookup: {
          forRealm() {
            return this;
          },
          async lookupDefinition() {
            throw new Error('HTML-only fixture unexpectedly requested code');
          },
        } as unknown as DefinitionLookup,
      }));
    },
    afterEach: async () => {
      realm?.unsubscribe();
      dir?.removeCallback();
    },
  });

  async function publish(title: string) {
    let batch = await writer.createBatch(new URL(root), network, undefined, {
      splitPrerenderHtml: true,
    });
    await batch.updateEntry(new URL(root + 'one.json'), {
      type: 'instance',
      lastModified: Date.now(),
      resourceCreatedAt: 1,
      resource: {
        id: rri(root + 'one'),
        type: 'card',
        attributes: { title },
        meta: {
          adoptsFrom: { module: rri(root + 'record'), name: 'Record' },
        },
      },
      searchData: { title },
      types: [root + 'record/Record'],
      displayNames: ['Record'],
      deps: new Set(),
    });
    await batch.done();
    let html = await writer.createBatch(new URL(root), network, undefined, {
      prerenderHtmlOnly: true,
      generation: batch.currentGeneration,
    });
    await html.seedPrerenderedHtmlInvalidations([
      { url: root + 'one.json', operation: 'update' },
    ]);
    await html.updatePrerenderedHtmlEntry(new URL(root + 'one.json'), {
      type: 'instance',
      fittedHtml: { [root + 'record/Record']: `<h1>${title}</h1>` },
      deps: [],
    });
    await html.done();
    return batch.currentGeneration;
  }

  async function read(etag?: string | null) {
    return (await realm.handle(
      new Request(root + 'one', {
        headers: {
          Accept: 'application/vnd.card+html',
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      }),
    ))!;
  }

  test('the clock survives recovery while the derived index completion marker does not', async (assert) => {
    let rows = await db.execute(
      `SELECT relname, relpersistence FROM pg_class
       WHERE relname IN ('realm_generations', 'realm_meta', 'boxel_index')
       ORDER BY relname`,
    );
    assert.deepEqual(rows, [
      { relname: 'boxel_index', relpersistence: 'u' },
      { relname: 'realm_generations', relpersistence: 'p' },
      { relname: 'realm_meta', relpersistence: 'u' },
    ]);
  });

  test('rebuilding lost index data advances the HTML validator and rejects the old cached response', async (assert) => {
    let generation = await publish('Before recovery');
    await realm.start();
    let before = await read();
    assert.strictEqual(before.status, 200);
    assert.true((await before.text()).includes('Before recovery'));
    let etag = before.headers.get('etag');
    assert.ok(etag);
    assert.strictEqual((await read(etag)).status, 304);

    // The separate manual crash probe verifies PostgreSQL actually drops
    // these UNLOGGED tables. Normal test discovery exercises the resulting
    // recovery state without killing a shared test database.
    await db.execute('TRUNCATE boxel_index, boxel_index_working, realm_meta');
    assert.true(
      await writer.isNewIndex(new URL(root)),
      'startup must request a rebuild even though its durable clock survived',
    );
    let next = await publish('After recovery');
    assert.true(next > generation, 'a published generation is never reused');
    assert.false(await writer.isNewIndex(new URL(root)));
    let fresh = await read(etag);
    assert.strictEqual(fresh.status, 200, 'the old ETag cannot produce a 304');
    assert.notStrictEqual(fresh.headers.get('etag'), etag);
    assert.true((await fresh.text()).includes('After recovery'));
    assert.strictEqual((await read(fresh.headers.get('etag'))).status, 304);
  });

  test('an indexed empty realm is complete; an unrelated or obsolete summary is not', async (assert) => {
    assert.true(await writer.isNewIndex(new URL(root)));
    let batch = await writer.createBatch(new URL(root), network);
    await batch.done();
    assert.false(
      await writer.isNewIndex(new URL(root)),
      'an empty realm does not rebuild on every mount',
    );
    await db.execute(
      'UPDATE realm_meta SET generation=generation+1 WHERE realm_url=$1',
      {
        bind: [root],
      },
    );
    assert.true(await writer.isNewIndex(new URL(root)));
    await db.execute(
      'UPDATE realm_meta SET generation=generation-1, realm_url=$1',
      {
        bind: [root + 'unrelated/'],
      },
    );
    assert.true(await writer.isNewIndex(new URL(root)));
  });
});
