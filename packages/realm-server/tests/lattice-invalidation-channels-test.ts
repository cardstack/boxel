import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  VirtualNetwork,
  type DefinitionLookup,
} from '@cardstack/runtime-common';
import { latticeReadState } from '@cardstack/runtime-common/lattice-materialization';
import { IndexBackedDependencyErrors } from '@cardstack/runtime-common/index-runner/index-backed-dependency-errors';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-channels.example/';

module('Lattice | invalidation channels', function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
    },
  });

  async function seed() {
    const data = {
      input: [],
      owner: ['input'],
      calendar: [],
      navigation: ['calendar'],
    };
    const html = {
      input: [],
      owner: ['input'],
      calendar: ['input', 'navigation'],
      navigation: ['calendar'],
    };
    // Production-only rows also exercise imports with no working counterpart.
    for (const [table, graph] of Object.entries({
      boxel_index: data,
      prerendered_html: html,
    })) {
      for (const [name, deps] of Object.entries(graph)) {
        await db.execute(
          `INSERT INTO ${table}
          (url,file_alias,type,realm_url,generation,is_deleted,deps)
          VALUES ($1,$2,'instance',$3,0,false,$4)`,
          {
            bind: [
              realm + name + '.json',
              realm + name,
              realm,
              JSON.stringify(deps.map((dep) => realm + dep + '.json')),
            ],
          },
        );
      }
    }
  }

  test('render-only fan-out stays out of data indexing and publishes on the HTML channel', async function (assert) {
    await seed();
    const writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    });
    const network = new VirtualNetwork();
    const data = await writer.createBatch(new URL(realm), network);
    await data.invalidate([new URL(realm + 'input.json')]);
    assert.deepEqual(
      data.invalidations.sort(),
      ['input', 'owner'].map((name) => realm + name + '.json'),
    );
    const html = await writer.createBatch(new URL(realm), network, undefined, {
      prerenderHtmlOnly: true,
      generation: 1,
    });
    await html.seedPrerenderedHtmlInvalidations(
      data.invalidations.map((url) => ({ url, operation: 'update' as const })),
      { expandDependencies: true },
    );
    assert.deepEqual(
      html.invalidations.sort(),
      ['calendar', 'input', 'navigation', 'owner'].map(
        (name) => realm + name + '.json',
      ),
      'HTML graph traversal includes cyclic render consumers once',
    );
    for (const url of html.invalidations) {
      await html.updatePrerenderedHtmlEntry(new URL(url), {
        type: 'instance',
        deps: [],
        isolatedHtml: '<p>current</p>',
      });
    }
    await html.done();
    const rows = await db.execute(
      'SELECT url,generation,isolated_html FROM prerendered_html WHERE realm_url=$1 ORDER BY url',
      { bind: [realm] },
    );
    assert.strictEqual(rows.length, 4);
    assert.true(
      rows.every(
        (row) =>
          Number(row.generation) === 1 &&
          row.isolated_html === '<p>current</p>',
      ),
      'all affected HTML was published',
    );
    const sourceRows = await db.execute(
      'SELECT generation,is_deleted FROM boxel_index WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.true(
      sourceRows.every(
        (row) => Number(row.generation) === 0 && !row.is_deleted,
      ),
      'HTML publication never changes source data',
    );
  });

  test('fused indexing still follows the complete data and HTML graph', async function (assert) {
    await seed();
    const batch = await new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    }).createBatch(new URL(realm), new VirtualNetwork(), undefined, {
      splitPrerenderHtml: false,
    });
    await batch.invalidate([new URL(realm + 'input.json')]);
    assert.deepEqual(
      batch.invalidations.sort(),
      ['calendar', 'input', 'navigation', 'owner'].map(
        (name) => realm + name + '.json',
      ),
    );
  });

  for (const [name, lattice] of [
    ['no policy', undefined],
    ['another realm enabled', new LatticeRealmConfig([`${realm}other/`])],
  ] as const) {
    test(`ordinary split indexing supplies the full render fan-out with ${name}`, async function (assert) {
      await seed();
      const writer = new IndexWriter(db, { lattice });
      const network = new VirtualNetwork();
      const data = await writer.createBatch(new URL(realm), network);
      await data.invalidate([new URL(realm + 'input.json')]);
      const expected = ['calendar', 'input', 'navigation', 'owner'].map(
        (name) => realm + name + '.json',
      );
      assert.deepEqual(
        data.invalidations.sort(),
        expected,
        'the source pass includes data and render-only consumers, including cycles',
      );
      const html = await writer.createBatch(
        new URL(realm),
        network,
        undefined,
        {
          prerenderHtmlOnly: true,
          generation: 1,
        },
      );
      await html.seedPrerenderedHtmlInvalidations(
        data.invalidations.map((url) => ({
          url,
          operation: 'update' as const,
        })),
      );
      assert.deepEqual(
        html.invalidations.sort(),
        expected,
        'the ordinary HTML pass receives the complete set without expanding it again',
      );
    });
  }

  async function seedOwner() {
    await seed();
    const stamp = {
      version: 1 as const,
      state: 'ready' as const,
      outputRevision: 1,
      validatedThrough: 0,
      definitionRevision: '0',
      computedFields: ['count'],
      queryFields: [],
      watches: [],
    };
    await db.execute(
      'UPDATE boxel_index SET generation=1, pristine_doc=$1 WHERE url=$2',
      {
        bind: [
          JSON.stringify({
            id: realm + 'owner',
            type: 'card',
            attributes: { count: 7 },
            meta: { publication: stamp },
          }),
          realm + 'owner.json',
        ],
      },
    );
    await db.execute(
      "INSERT INTO realm_generations (realm_url,current_generation,loader_epoch) VALUES ($1,1,'0')",
      { bind: [realm] },
    );
    await db.execute(
      "INSERT INTO lattice_owners (realm_url,owner_url,published_generation,input_generation,definition_revision,retired) VALUES ($1,$2,1,0,'0',false)",
      { bind: [realm, realm + 'owner.json'] },
    );
    return stamp;
  }

  test('dependency-only deletion retains the published snapshot and secondary matching marks it pending', async function (assert) {
    const stamp = await seedOwner();
    const writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    });
    const network = new VirtualNetwork();
    const data = await writer.createBatch(new URL(realm), network);
    await data.invalidate([new URL(realm + 'input.json')], {
      latticeDeferOwners: true,
    });
    assert.deepEqual(
      data.invalidations,
      [realm + 'input.json'],
      'owner is not rediscovered or tombstoned',
    );
    // This fixture has concrete dependencies and no query watches, so no
    // definition lookups are needed by the real publication protocol.
    const publication = writer.latticePublication(
      {} as DefinitionLookup,
      network,
    );
    await data.done({ lattice: publication, latticeRealmUsername: 'lattice' });
    assert.strictEqual(
      await latticeReadState(db, realm, realm + 'owner.json', stamp),
      'pending',
      'durable outbox prevents a stale-ready read before matching',
    );
    assert.true(await publication.matchPending(realm, 'lattice'));
    const [owner] = await db.execute(
      'SELECT dirty_generation,published_generation FROM lattice_owners WHERE realm_url=$1',
      { bind: [realm] },
    );
    assert.strictEqual(Number(owner.dirty_generation), 2);
    assert.strictEqual(
      Number(owner.published_generation),
      1,
      'publication watermark still describes completed output',
    );
    const [row] = await db.execute(
      'SELECT pristine_doc,generation,is_deleted FROM boxel_index WHERE url=$1',
      { bind: [realm + 'owner.json'] },
    );
    assert.strictEqual((row.pristine_doc as any).attributes.count, 7);
    assert.strictEqual(Number(row.generation), 1);
    assert.false(Boolean(row.is_deleted));
  });

  test('explicit owner edits and definition edits still rediscover the owner', async function (assert) {
    await seedOwner();
    const writer = new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    });
    const network = new VirtualNetwork();
    const direct = await writer.createBatch(new URL(realm), network);
    await direct.invalidate([new URL(realm + 'owner.json')], {
      latticeDeferOwners: true,
    });
    assert.true(direct.invalidations.includes(realm + 'owner.json'));
    await db.execute('UPDATE boxel_index SET deps=$1 WHERE url=$2', {
      bind: [JSON.stringify([realm + 'definition']), realm + 'owner.json'],
    });
    const moduleEdit = await writer.createBatch(new URL(realm), network);
    await moduleEdit.invalidate([new URL(realm + 'definition.gts')], {
      latticeDeferOwners: true,
    });
    assert.true(
      moduleEdit.invalidations.includes(realm + 'owner.json'),
      'new definitions cannot reuse old discovery metadata',
    );
  });

  test('thin error checks avoid dependency payloads and real errors still traverse the full graph', async function (assert) {
    const network = new VirtualNetwork();
    const batch = await new IndexWriter(db, {
      lattice: new LatticeRealmConfig([realm]),
    }).createBatch(new URL(realm), network);
    for (const [name, deps, error] of [
      [
        'direct.gts',
        [realm + 'nested.gts', realm + 'x'.repeat(100_000)],
        { message: 'direct failed', status: 500 },
      ],
      ['nested.gts', [], { message: 'nested failed', status: 500 }],
    ] as const) {
      await db.execute(
        `INSERT INTO boxel_index
        (url,file_alias,type,realm_url,generation,is_deleted,has_error,error_doc,deps)
        VALUES ($1,$1,'file',$2,0,false,true,$3,$4)`,
        {
          bind: [
            realm + name,
            realm,
            JSON.stringify(error),
            JSON.stringify(deps),
          ],
        },
      );
    }
    const thin = await batch.getDependencyRows([realm + 'direct.gts'], {
      includeDeps: false,
    });
    assert.strictEqual(thin[0].deps, null);
    assert.true(thin[0].hasError);
    let fullReads = 0;
    const errors = new IndexBackedDependencyErrors({
      realmURL: new URL(realm),
      virtualNetwork: network,
      canonicalURLMemo: new Map(),
      readDefinitionCacheEntries: async () => ({}),
      getInvalidations: () => [],
      getDirectDependencyErrorRows: (urls) =>
        batch.getDependencyRows(urls, { includeDeps: false }),
      getDependencyRows: (urls) => {
        fullReads++;
        return batch.getDependencyRows(urls);
      },
    });
    const result = await errors.indexBackedDependencyErrorForEntry(
      [realm + 'direct.gts'],
      new URL(realm + 'owner'),
    );
    assert.ok(result);
    assert.true(
      fullReads > 0,
      'a real error still loads traversal dependencies',
    );
    assert.true(
      result!.additionalErrors!.some((e) => e.message === 'nested failed'),
      'the thin read did not poison the full traversal cache',
    );
    await db.execute(
      'UPDATE boxel_index SET has_error=false,error_doc=NULL WHERE realm_url=$1',
      { bind: [realm] },
    );
    const before = fullReads;
    assert.strictEqual(
      await errors.indexBackedDependencyErrorForEntry(
        [realm + 'direct.gts'],
        new URL(realm + 'owner'),
      ),
      undefined,
    );
    assert.strictEqual(
      fullReads,
      before,
      'healthy rows require no graph payload',
    );
  });
});
