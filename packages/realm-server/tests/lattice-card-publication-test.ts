import { LatticeWorkSuperseded } from '@cardstack/runtime-common/lattice-work';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import { basename } from 'node:path';
import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexWriter,
  latticeSnapshotFields,
  param,
  query,
  VirtualNetwork,
  rri,
  type DefinitionLookup,
  type FileEntry,
  type InstanceEntry,
  type Querier,
  type RealmMetaTable,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-card-publication.example/';
const owner = new URL('day.json', realm);
const codeRef = `${realm}day/Day`;

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let writer: IndexWriter;
  let publication: ReturnType<IndexWriter['latticePublication']>;
  let network: VirtualNetwork;
  let catalogueScans: number;

  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      network = new VirtualNetwork();
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realm]),
      });
      // These cards have no query watches; resolving a definition would be
      // unexpected work in this publication-only fixture.
      const lookup = {
        async lookupDefinition() {
          throw new Error('Unexpected definition lookup');
        },
      } as unknown as DefinitionLookup;
      publication = writer.latticePublication(lookup, network);
      catalogueScans = 0;
      const withWriteLock = db.withWriteLock.bind(db);
      db.withWriteLock = async (key, fn) =>
        withWriteLock(key, async (tx) => {
          const measured: Querier = async (expression) => {
            if (
              expression.some(
                (part) =>
                  typeof part === 'string' &&
                  part.includes('SELECT CAST(count(DISTINCT i.url)'),
              )
            ) {
              catalogueScans++;
            }
            return tx!(expression);
          };
          return fn(measured);
        });
    },
  });

  function entry(
    url: URL,
    count: number,
    inputGeneration: number,
  ): InstanceEntry {
    return {
      type: 'instance',
      lastModified: 1,
      resourceCreatedAt: 1,
      resource: {
        id: rri(url.href.replace(/\.json$/, '')),
        type: 'card',
        attributes: { count },
        meta: {
          adoptsFrom: { module: rri(`${realm}day`), name: 'Day' },
          publication: {
            version: 1,
            state: 'pending',
            computedFields: ['count'],
            queryFields: [],
            watches: [],
            validatedThrough: inputGeneration,
          },
        },
      },
      searchData: { count },
      types: [codeRef],
      displayNames: ['Day'],
      iconHTML: '<span>day</span>',
      deps: new Set(),
    };
  }

  async function seed() {
    const batch = await writer.createBatch(new URL(realm), network);
    await batch.updateEntry(owner, entry(owner, 12, 0));
    const other = new URL('other.json', realm);
    await batch.updateEntry(other, entry(other, 5, 0));
    await batch.done({ lattice: publication });
    catalogueScans = 0;
  }

  async function readCatalogue() {
    const [row] = await db.execute(
      `SELECT rm.value, rm.generation FROM realm_meta rm
       JOIN realm_generations rg ON rg.realm_url=rm.realm_url
         AND rg.current_generation=rm.generation WHERE rm.realm_url=$1`,
      { bind: [realm] },
    );
    return row as unknown as Pick<RealmMetaTable, 'value' | 'generation'>;
  }

  async function candidate(url: URL, count: number) {
    const batch = await writer.createBatch(new URL(realm), network, undefined, {
      latticeMaterialization: true,
    });
    const inputGeneration = batch.currentGeneration - 1;
    const value = entry(url, count, inputGeneration);
    value.resource.meta.publication!.stale = true;
    await batch.updateEntry(url, value);
    return { batch, inputGeneration };
  }

  async function tickState() {
    return {
      cards: await db.execute(
        `SELECT url, generation, pristine_doc->'attributes'->>'count' AS count, pristine_doc->'meta'->'publication'->>'validatedThrough' AS input FROM boxel_index WHERE realm_url=$1 AND type='instance' ORDER BY url`,
        { bind: [realm] },
      ),
      notices: await db.execute(
        `SELECT payload FROM lattice_publication_events WHERE realm_url=$1`,
        { bind: [realm] },
      ),
      clock: (await readCatalogue()).generation,
    };
  }

  test('a tick publishes peers with one generation and one complete notice', async function (assert) {
    await seed();
    const a = await candidate(owner, 13);
    const other = new URL('other.json', realm);
    const b = await candidate(other, 6);
    await a.batch.publishLatticeTick([a, b], { lattice: publication });
    const state = await tickState();
    assert.deepEqual(
      state.cards.map((row) => Number(row.count)),
      [13, 6],
    );
    assert.deepEqual(
      state.cards.map((row) => Number(row.generation)),
      [2, 2],
    );
    assert.strictEqual(Number(state.clock), 2);
    assert.strictEqual(state.notices.length, 1);
    assert.deepEqual(
      (state.notices[0].payload as any).invalidations.sort(),
      [owner.href, other.href].sort(),
    );
    assert.strictEqual(catalogueScans, 0);
  });

  test('an ordinary final wave sends one union notice for its shared generation', async function (assert) {
    await seed();
    const batch = await writer.createBatch(new URL(realm), network);
    const other = new URL('other.json', realm);
    await batch.updateEntry(owner, entry(owner, 13, 1));
    await batch.updateEntry(other, entry(other, 6, 1));
    await batch.done({ lattice: publication, latticeInputGeneration: 1 });
    const state = await tickState();
    assert.deepEqual(
      state.cards.map((row) => Number(row.count)),
      [13, 6],
    );
    assert.strictEqual(state.notices.length, 1);
    assert.deepEqual(
      (state.notices[0].payload as any).invalidations.sort(),
      [owner.href, other.href].sort(),
    );
    assert.strictEqual((state.notices[0].payload as any).generation, 2);
  });

  test('a tick keeps each original input revision across intervening publications', async function (assert) {
    await seed();
    const a = await candidate(owner, 13);
    const bridge = await writer.createBatch(new URL(realm), network);
    await bridge.updateEntry(
      new URL('bridge.json', realm),
      entry(new URL('bridge.json', realm), 8, 0),
    );
    await bridge.done({ lattice: publication });
    const b = await candidate(new URL('other.json', realm), 6);
    assert.notEqual(a.inputGeneration, b.inputGeneration);
    await a.batch.publishLatticeTick([a, b], { lattice: publication });
    const state = await tickState();
    assert.deepEqual(
      state.cards
        .filter((row) => row.url !== new URL('bridge.json', realm).href)
        .map((row) => Number(row.input)),
      [a.inputGeneration, b.inputGeneration],
    );
    assert.strictEqual(Number(state.clock), 3);
  });

  for (const phase of ['opening', 'commit'] as const) {
    test(`a superseded ${phase} check rolls back just its owner, including registry writes`, async function (assert) {
      await seed();
      const a = await candidate(owner, 13);
      const b = await candidate(new URL('other.json', realm), 6);
      const register =
        phase === 'opening'
          ? a.batch.registerLatticePublicationCheck.bind(a.batch)
          : a.batch.registerLatticeCommitCheck.bind(a.batch);
      register(owner.href, async () => {
        throw new LatticeWorkSuperseded('newer source');
      });
      await a.batch.publishLatticeTick([a, b], { lattice: publication });
      const state = await tickState();
      assert.deepEqual(
        state.cards.map((row) => Number(row.count)),
        [12, 6],
      );
      assert.deepEqual([...a.batch.latticeSkippedOutputs], [owner.href]);
      assert.deepEqual((state.notices[0].payload as any).invalidations, [
        new URL('other.json', realm).href,
      ]);
      const [pending] = await db.execute(
        'SELECT dirty_generation,input_generation FROM lattice_owners WHERE realm_url=$1 AND owner_url=$2',
        { bind: [realm, owner.href] },
      );
      assert.true(
        Number(pending.dirty_generation) > Number(pending.input_generation),
        'failed peer stays dirty',
      );
    });
  }

  test('an unexpected peer failure rolls back the whole tick and its outbox', async function (assert) {
    await seed();
    const a = await candidate(owner, 13);
    const b = await candidate(new URL('other.json', realm), 6);
    b.batch.registerLatticeCommitCheck(
      new URL('other.json', realm).href,
      async () => {
        throw new Error('database failure');
      },
    );
    await assert.rejects(
      a.batch.publishLatticeTick([a, b], { lattice: publication }),
      /database failure/,
    );
    const state = await tickState();
    assert.deepEqual(
      state.cards.map((row) => Number(row.count)),
      [12, 5],
    );
    assert.strictEqual(state.notices.length, 0);
    assert.strictEqual(Number(state.clock), 1);
  });

  test('expiry at the transaction tail rolls back even peers that passed earlier checks', async function (assert) {
    await seed();
    const a = await candidate(owner, 13);
    let checks = 0;
    a.batch.registerLatticeCommitCheck(owner.href, async () => {
      if (++checks > 1) throw new LatticeWorkSuperseded('expired lease');
    });
    await assert.rejects(
      a.batch.publishLatticeTick([a], { lattice: publication }),
      /expired lease/,
    );
    const state = await tickState();
    assert.strictEqual(state.notices.length, 0);
    assert.strictEqual(Number(state.clock), 1);
  });

  test('an entirely superseded tick makes no clock advance or notice', async function (assert) {
    await seed();
    const a = await candidate(owner, 13);
    a.batch.registerLatticePublicationCheck(owner.href, async () => {
      throw new LatticeWorkSuperseded('newer source');
    });
    await a.batch.publishLatticeTick([a], { lattice: publication });
    const state = await tickState();
    assert.strictEqual(state.notices.length, 0);
    assert.strictEqual(Number(state.clock), 1);
  });

  test('a source value edit reuses the catalogue, while added and deleted members rebuild its counts', async function (assert) {
    await seed();
    const before = await readCatalogue();
    const edit = await writer.createBatch(new URL(realm), network);
    await edit.updateEntry(owner, entry(owner, 13, 0));
    await edit.done({
      lattice: publication,
      latticeRealmUsername: 'source-test',
    });
    assert.strictEqual(
      catalogueScans,
      0,
      'value-only source edit does not scan the realm',
    );
    assert.deepEqual((await readCatalogue()).value, before.value);

    const added = new URL('added.json', realm);
    const create = await writer.createBatch(new URL(realm), network);
    await create.updateEntry(added, entry(added, 1, 0));
    await create.done({
      lattice: publication,
      latticeRealmUsername: 'source-test',
    });
    assert.strictEqual(
      catalogueScans,
      2,
      'new member requires both type summaries',
    );
    assert.strictEqual((await readCatalogue()).value.instances[0].total, 3);

    const remove = await writer.createBatch(new URL(realm), network);
    await remove.invalidate([added]);
    await remove.done({
      lattice: publication,
      latticeRealmUsername: 'source-test',
    });
    assert.strictEqual(catalogueScans, 4, 'deleted member rebuilds counts too');
    assert.deepEqual((await readCatalogue()).value, before.value);
  });

  function fileEntry(label: string): FileEntry {
    return {
      type: 'file',
      lastModified: 1,
      resourceCreatedAt: 1,
      searchData: { title: label },
      types: [`${realm}json/JsonFile`],
      displayNames: [label],
      iconHTML: `<span>${label}</span>`,
      isolatedHtml: `<article>${label}</article>`,
      deps: new Set(),
    };
  }

  test('computed value and per-recipient native index notices commit together', async function (assert) {
    await seed();
    await query(db, [
      `INSERT INTO users (matrix_user_id, session_room_id) VALUES
       ('@reader:example', '!reader:example')`,
    ]);
    await query(db, [
      'INSERT INTO realm_user_permissions (realm_url, username, read, write) VALUES (',
      param(realm),
      `, '@reader:example', TRUE, FALSE)`,
    ]);
    const batch = await writer.createBatch(new URL(realm), network);
    await batch.updateEntry(owner, entry(owner, 13, 1));
    await batch.done({ lattice: publication, latticeInputGeneration: 1 });
    const [event] = await query(db, [
      'SELECT id, owner_url, payload FROM lattice_publication_events',
    ]);
    assert.strictEqual(event.owner_url, owner.href);
    assert.deepEqual(
      event.payload,
      {
        eventName: 'index',
        indexType: 'incremental',
        realmURL: realm,
        invalidations: [owner.href],
        generation: 2,
        publicationId: event.id,
      },
      'the existing Card Store event contract carries only identity and revision',
    );
    const [delivery] = await query(db, [
      'SELECT publication_id, user_id, delivered_at FROM lattice_publication_deliveries',
    ]);
    assert.strictEqual(delivery.publication_id, event.id);
    assert.strictEqual(delivery.user_id, '@reader:example');
    assert.strictEqual(delivery.delivered_at, null);
    const [resource] = await query(db, [
      `SELECT pristine_doc FROM boxel_index WHERE url =`,
      param(owner.href),
      `AND type = 'instance'`,
    ]);
    assert.strictEqual((resource.pristine_doc as any).attributes.count, 13);
    assert.strictEqual(
      (resource.pristine_doc as any).meta.publication.state,
      'ready',
    );
  });

  test('outbox failure cannot publish the count or advance its provenance', async function (assert) {
    await seed();
    const before = await query(db, [
      `SELECT pristine_doc, generation FROM boxel_index WHERE url =`,
      param(owner.href),
      `AND type = 'instance'`,
    ]);
    const ownerBefore = await query(db, [
      'SELECT published_generation, dirty_generation, attributes_generation FROM lattice_owners WHERE owner_url =',
      param(owner.href),
    ]);
    await query(db, [
      `CREATE FUNCTION lattice_test_refuse_data_event() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'data outbox unavailable'; END $$`,
    ]);
    await query(db, [
      `CREATE TRIGGER lattice_test_refuse_data_event BEFORE INSERT ON lattice_publication_events
      FOR EACH ROW EXECUTE FUNCTION lattice_test_refuse_data_event()`,
    ]);
    const batch = await writer.createBatch(new URL(realm), network);
    await batch.updateEntry(owner, entry(owner, 13, 1));
    await assert.rejects(
      batch.done({ lattice: publication, latticeInputGeneration: 1 }),
      /data outbox unavailable/,
    );
    assert.deepEqual(
      await query(db, [
        `SELECT pristine_doc, generation FROM boxel_index WHERE url =`,
        param(owner.href),
        `AND type = 'instance'`,
      ]),
      before,
    );
    assert.deepEqual(
      await query(db, [
        'SELECT published_generation, dirty_generation, attributes_generation FROM lattice_owners WHERE owner_url =',
        param(owner.href),
      ]),
      ownerBefore,
    );
    assert.deepEqual(
      await query(db, ['SELECT id FROM lattice_publication_events']),
      [],
    );
  });

  test('unchanged output still announces the new confirmed generation', async function (assert) {
    await seed();
    const batch = await writer.createBatch(new URL(realm), network);
    await batch.updateEntry(owner, entry(owner, 12, 1));
    await batch.done({ lattice: publication, latticeInputGeneration: 1 });
    const [event] = await query(db, [
      'SELECT payload FROM lattice_publication_events',
    ]);
    assert.strictEqual((event.payload as any).generation, 2);
    assert.deepEqual((event.payload as any).invalidations, [owner.href]);
  });

  test('equal ready output retains its revision while validating newer inputs and notifying readers', async function (assert) {
    await seed();
    const initial = await writer.createBatch(new URL(realm), network);
    await initial.updateEntry(owner, entry(owner, 12, 1));
    await initial.done({ lattice: publication, latticeInputGeneration: 1 });
    const source = await writer.createBatch(new URL(realm), network);
    await source.done({ lattice: publication });
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      if (!tx) throw new Error('Expected transaction');
      await publication.registry.markDirty(tx, realm, [owner.href], 3);
    });
    const current = await writer.createBatch(new URL(realm), network);
    await current.updateEntry(owner, entry(owner, 12, 3));
    await current.done({ lattice: publication, latticeInputGeneration: 3 });
    const [stored] = await query(db, [
      'SELECT i.generation,i.pristine_doc,o.published_generation,o.input_generation,o.dirty_generation,o.attributes_generation FROM boxel_index i JOIN lattice_owners o ON i.url=o.owner_url AND i.realm_url=o.realm_url WHERE i.url=',
      param(owner.href),
    ]);
    assert.strictEqual(Number(stored.generation), 2);
    assert.strictEqual(
      Number(stored.published_generation),
      2,
      'output revision is stable',
    );
    assert.strictEqual(
      Number(stored.input_generation),
      3,
      'new inputs have been validated',
    );
    assert.strictEqual(stored.dirty_generation, null);
    assert.strictEqual(Number(stored.attributes_generation), 2);
    const resource = stored.pristine_doc as any;
    assert.deepEqual(resource.attributes, { count: 12 });
    assert.strictEqual(resource.meta.publication.validatedThrough, 3);
    assert.strictEqual(resource.meta.publication.outputRevision, 2);
    assert.deepEqual(
      latticeSnapshotFields(resource),
      { computedFields: ['count'], queryFields: [] },
      'the retained output has valid hydration provenance',
    );
    assert.true(
      current.latticeRetainedOutputs.has(owner.href),
      'no new HTML or downstream output work is needed',
    );
    const events = await query(db, [
      'SELECT payload FROM lattice_publication_events ORDER BY created_at',
    ]);
    assert.strictEqual(
      (events.at(-1)!.payload as any).generation,
      4,
      'revalidation still announces confirmation to pending readers',
    );
  });

  for (const change of [
    'attributes',
    'search',
    'membership',
    'order',
    'coverage',
    'definition',
  ]) {
    test(`changed ${change} advances output and invalidates its dependent`, async function (assert) {
      await seed();
      const ready = entry(owner, 12, 1);
      const members = [rri(realm + 'a'), rri(realm + 'b')];
      ready.resource.relationships = {
        rows: {
          data: members.map((id) => ({ type: 'card', id })),
          meta: { total: 2 },
        },
      };
      ready.resource.meta.publication!.queryFields = ['rows'];
      const initial = await writer.createBatch(new URL(realm), network);
      await initial.updateEntry(owner, ready);
      await initial.done({ lattice: publication, latticeInputGeneration: 1 });
      // This dependent is already current when the next owner attempt starts.
      const dependent = new URL('dependent.json', realm);
      const downstream = await writer.createBatch(new URL(realm), network);
      const dependentEntry = entry(dependent, 12, 2);
      dependentEntry.deps.add(owner.href);
      await downstream.updateEntry(dependent, dependentEntry);
      await downstream.done({
        lattice: publication,
        latticeInputGeneration: 2,
      });
      const next = structuredClone(ready);
      next.resource.meta.publication!.validatedThrough = 3;
      if (change === 'attributes') next.resource.attributes!.count = 13;
      if (change === 'search') next.searchData = { count: 13 };
      if (change === 'membership') members[1] = rri(realm + 'c');
      if (change === 'order') members.reverse();
      if (change === 'coverage')
        next.resource.meta.publication!.computedFields = [];
      next.resource.relationships!.rows = {
        data: members.map((id) => ({ type: 'card', id })),
        meta: { total: 2 },
      };
      if (change === 'definition')
        await db.execute(
          "UPDATE realm_generations SET loader_epoch='new-definition' WHERE realm_url=$1",
          { bind: [realm] },
        );
      const batch = await writer.createBatch(new URL(realm), network);
      await batch.updateEntry(owner, next);
      await batch.done({ lattice: publication, latticeInputGeneration: 3 });
      const [published] = await db.execute(
        "SELECT generation,pristine_doc FROM boxel_index WHERE url=$1 AND type='instance'",
        { bind: [owner.href] },
      );
      assert.strictEqual(Number(published.generation), 4);
      assert.strictEqual(
        (published.pristine_doc as any).meta.publication.outputRevision,
        4,
      );
      assert.deepEqual(
        (published.pristine_doc as any).attributes,
        next.resource.attributes,
      );
      assert.deepEqual(
        (published.pristine_doc as any).relationships,
        next.resource.relationships,
      );
      assert.false(batch.latticeRetainedOutputs.has(owner.href));
      const [dirty] = await db.execute(
        'SELECT dirty_generation FROM lattice_owners WHERE owner_url=$1',
        { bind: [dependent.href] },
      );
      assert.strictEqual(Number(dirty.dirty_generation), 4);
    });
  }

  test('equal output replaces its dependency watch and rolls back validation if notification fails', async function (assert) {
    publication = writer.latticePublication(
      {
        async lookupDefinition() {
          return {
            type: 'card-def',
            codeRef: { module: rri(realm + 'day'), name: 'Day' },
            displayName: 'Day',
            fields: { id: 'string' },
            fieldDefs: {
              string: {
                type: 'contains',
                isPrimitive: true,
                isComputed: false,
                fieldOrCard: { module: rri(realm + 'string'), name: 'String' },
              },
            },
          };
        },
      } as unknown as DefinitionLookup,
      network,
    );
    await seed();
    const ready = entry(owner, 12, 1);
    ready.resource.attributes = { count: 12, nested: { a: 1, b: 2 } };
    ready.resource.meta.publication!.watches = [
      { fieldPath: 'source', query: { filter: { eq: { id: realm + 'a' } } } },
    ];
    const initial = await writer.createBatch(new URL(realm), network);
    await initial.updateEntry(owner, ready);
    await initial.done({ lattice: publication, latticeInputGeneration: 1 });
    const next = structuredClone(ready);
    next.resource.meta.publication!.validatedThrough = 2;
    next.resource.meta.publication!.watches[0].query.filter = {
      eq: { id: realm + 'b' },
    };
    next.resource.attributes = { nested: { b: 2, a: 1 }, count: 12 };
    const current = await writer.createBatch(new URL(realm), network);
    await current.updateEntry(owner, next);
    await current.done({ lattice: publication, latticeInputGeneration: 2 });
    assert.true(
      current.latticeRetainedOutputs.has(owner.href),
      'object key order is not a value change',
    );
    const watches = await db.execute(
      'SELECT query FROM lattice_query_watches WHERE owner_url=$1',
      { bind: [owner.href] },
    );
    assert.deepEqual(
      watches.map((row) => row.query as unknown),
      [next.resource.meta.publication!.watches[0].query],
      'fresh dependency replaces the old one despite equal output',
    );
    for (const name of ['a', 'b']) {
      const affected = await publication.registry.affected(realm, undefined, {
        url: realm + name + '.json',
        types: [],
        search_doc: { id: realm + name },
      });
      assert.deepEqual(
        affected,
        name === 'b' ? [owner.href] : [],
        'future changes follow the replacement watch: ' + name,
      );
    }
    await db.withWriteLock('lattice:index:' + realm, async (tx) =>
      publication.registry.markDirty(tx!, realm, [owner.href], 3),
    );
    const snapshot = async () => ({
      index: await db.execute(
        "SELECT generation,pristine_doc FROM boxel_index WHERE url=$1 AND type='instance'",
        { bind: [owner.href] },
      ),
      owner: await db.execute(
        'SELECT published_generation,input_generation,dirty_generation,attributes_generation FROM lattice_owners WHERE owner_url=$1',
        { bind: [owner.href] },
      ),
      watches: await db.execute(
        'SELECT query FROM lattice_query_watches WHERE owner_url=$1',
        { bind: [owner.href] },
      ),
      events: await db.execute(
        'SELECT id FROM lattice_publication_events ORDER BY id',
      ),
    });
    const before = await snapshot();
    await db.execute(`CREATE FUNCTION lattice_test_reject_confirmation() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'confirmation unavailable'; END $$`);
    await db.execute(`CREATE TRIGGER lattice_test_reject_confirmation BEFORE INSERT ON lattice_publication_events
      FOR EACH ROW EXECUTE FUNCTION lattice_test_reject_confirmation()`);
    next.resource.meta.publication!.validatedThrough = 3;
    next.resource.meta.publication!.watches[0].query.filter = {
      eq: { id: realm + 'c' },
    };
    const failed = await writer.createBatch(new URL(realm), network);
    await failed.updateEntry(owner, next);
    await assert.rejects(
      failed.done({ lattice: publication, latticeInputGeneration: 3 }),
      /confirmation unavailable/,
    );
    assert.deepEqual(
      await snapshot(),
      before,
      'failed validation leaves the prior output, watches, obligation and event log intact',
    );
  });

  test('server card publication preserves the published file channel and its catalogue', async function (assert) {
    await seed();
    const source = await writer.createBatch(
      new URL(realm),
      network,
      undefined,
      {
        splitPrerenderHtml: false,
      },
    );
    await source.updateEntry(owner, fileEntry('Published file'));
    await source.done();
    const before = await db.execute(
      "SELECT * FROM boxel_index WHERE url=$1 AND type='file'",
      { bind: [owner.href] },
    );
    const htmlBefore = await db.execute(
      "SELECT * FROM prerendered_html WHERE url=$1 AND type='file'",
      { bind: [owner.href] },
    );
    const catalogue = await readCatalogue();
    const batch = await writer.createBatch(new URL(realm), network);
    const card = entry(owner, 13, 2);
    card.displayNames = ['Updated day'];
    await batch.updateEntry(owner, card);
    // A leftover or separately staged file row must not be published just
    // because the card identity shares its URL. Changed card metadata forces
    // the full catalogue path, which must still use committed file values.
    await batch.updateEntry(owner, fileEntry('Unpublished file'));
    await batch.done({ lattice: publication, latticeInputGeneration: 2 });
    assert.deepEqual(
      await db.execute(
        "SELECT * FROM boxel_index WHERE url=$1 AND type='file'",
        {
          bind: [owner.href],
        },
      ),
      before,
    );
    assert.deepEqual(
      await db.execute(
        "SELECT * FROM prerendered_html WHERE url=$1 AND type='file'",
        {
          bind: [owner.href],
        },
      ),
      htmlBefore,
    );
    assert.deepEqual(
      (await readCatalogue()).value.files,
      catalogue.value.files,
    );
    assert.strictEqual(
      (await readCatalogue()).value.instances[0].display_name,
      'Updated day',
    );
  });

  test('fused materialization retains file and HTML publication', async function (assert) {
    await seed();
    const batch = await writer.createBatch(new URL(realm), network, undefined, {
      splitPrerenderHtml: false,
    });
    const card = entry(owner, 13, 1);
    card.isolatedHtml = '<article>Updated card</article>';
    await batch.updateEntry(owner, card);
    await batch.updateEntry(owner, fileEntry('Updated file'));
    await batch.done({ lattice: publication, latticeInputGeneration: 1 });
    const [file] = await db.execute(
      "SELECT generation,search_doc FROM boxel_index WHERE url=$1 AND type='file'",
      { bind: [owner.href] },
    );
    assert.strictEqual(Number(file.generation), 2);
    assert.strictEqual((file.search_doc as any).title, 'Updated file');
    const html = await db.execute(
      'SELECT type,isolated_html FROM prerendered_html WHERE url=$1 ORDER BY type',
      { bind: [owner.href] },
    );
    assert.deepEqual(html, [
      { type: 'file', isolated_html: '<article>Updated file</article>' },
      { type: 'instance', isolated_html: '<article>Updated card</article>' },
    ]);
    assert.strictEqual(
      (await readCatalogue()).value.files[0].display_name,
      'Updated file',
    );
  });

  test('a card value publication preserves the complete catalogue without realm-wide aggregation', async function (assert) {
    await seed();
    const before = await readCatalogue();
    const batch = await writer.createBatch(new URL(realm), network);
    await batch.updateEntry(owner, entry(owner, 13, 1));
    await batch.done({ lattice: publication, latticeInputGeneration: 1 });
    const after = await readCatalogue();
    assert.strictEqual(catalogueScans, 0);
    assert.deepEqual(
      after.value,
      before.value,
      'unrelated cards remain counted',
    );
    assert.strictEqual(Number(after.generation), 2);
    const [row] = await db.execute(
      'SELECT pristine_doc FROM boxel_index WHERE url=$1 AND type=$2',
      { bind: [owner.href, 'instance'] },
    );
    assert.strictEqual((row.pristine_doc as any).attributes.count, 13);
    assert.strictEqual(
      (row.pristine_doc as any).meta.publication.state,
      'ready',
    );
  });

  test('card publication can omit unused realm-wide statistics while normal batches retain them', async function (assert) {
    await seed();
    const execute = db.execute.bind(db);
    let counts = 0;
    db.execute = async (sql, opts) => {
      if (sql.includes('SELECT count(i.url) as total')) counts++;
      return execute(sql, opts);
    };
    try {
      const batch = await writer.createBatch(new URL(realm), network);
      await batch.updateEntry(owner, entry(owner, 13, 1));
      const result = await batch.done({
        lattice: publication,
        latticeInputGeneration: 1,
        countIndexEntries: false,
      });
      assert.strictEqual(result, undefined);
      assert.strictEqual(counts, 0);
      assert.strictEqual(Number((await readCatalogue()).generation), 2);
      const normal = await writer.createBatch(new URL(realm), network);
      const stats = await normal.done();
      assert.strictEqual(counts, 1);
      assert.strictEqual(stats.totalIndexEntries, 2);
    } finally {
      db.execute = execute;
    }
  });

  for (const scenario of ['display name', 'icon', 'type', 'untyped'] as const) {
    test(`a changed ${scenario} still recalculates the catalogue`, async function (assert) {
      await seed();
      const updated = entry(owner, 13, 1);
      if (scenario === 'display name') updated.displayNames = ['Zebra day'];
      if (scenario === 'icon') updated.iconHTML = '<span>zebra</span>';
      if (scenario === 'type') updated.types = [`${realm}other/Other`];
      if (scenario === 'untyped') updated.types = [];
      const batch = await writer.createBatch(new URL(realm), network);
      await batch.updateEntry(owner, updated);
      await batch.done({ lattice: publication, latticeInputGeneration: 1 });
      assert.strictEqual(catalogueScans, 2);
      const { instances } = (await readCatalogue()).value as any;
      const day = instances.find((item: any) => item.code_ref === codeRef);
      assert.strictEqual(
        day.total,
        scenario === 'type' || scenario === 'untyped' ? 1 : 2,
      );
      if (scenario === 'display name')
        assert.strictEqual(day.display_name, 'Zebra day');
      if (scenario === 'icon')
        assert.strictEqual(day.icon_html, '<span>zebra</span>');
      if (scenario === 'type') {
        assert.strictEqual(
          instances.find((item: any) => item.code_ref === `${realm}other/Other`)
            .total,
          1,
        );
      }
    });
  }

  test('new and deleted cards change the catalogue even during materialization', async function (assert) {
    await seed();
    const another = new URL('another.json', realm);
    const addition = await writer.createBatch(new URL(realm), network);
    await addition.updateEntry(another, entry(another, 1, 1));
    await addition.done({ lattice: publication, latticeInputGeneration: 1 });
    assert.strictEqual(catalogueScans, 2);
    assert.strictEqual(
      ((await readCatalogue()).value as any).instances[0].total,
      3,
    );
    catalogueScans = 0;
    const deletion = await writer.createBatch(new URL(realm), network);
    await deletion.invalidate([another]);
    await deletion.done({ lattice: publication, latticeInputGeneration: 2 });
    assert.strictEqual(catalogueScans, 2);
    assert.strictEqual(
      ((await readCatalogue()).value as any).instances[0].total,
      2,
    );
  });

  test('missing prior catalogue falls back to complete aggregation', async function (assert) {
    await seed();
    await db.execute('DELETE FROM realm_meta WHERE realm_url=$1', {
      bind: [realm],
    });
    const batch = await writer.createBatch(new URL(realm), network);
    await batch.updateEntry(owner, entry(owner, 13, 1));
    await batch.done({ lattice: publication, latticeInputGeneration: 1 });
    assert.strictEqual(catalogueScans, 2);
    assert.strictEqual(
      ((await readCatalogue()).value as any).instances[0].total,
      2,
    );
  });
});
