import { createHash } from 'node:crypto';
import {
  configureLatticeTrace,
  startLatticeTrace,
} from '@cardstack/runtime-common/lattice-trace';
import { LatticeRetainedSnapshots } from '@cardstack/runtime-common/lattice-retained-snapshots';
import { basename } from 'node:path';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import {
  VirtualNetwork,
  internalKeyFor,
  rri,
  type Definition,
} from '@cardstack/runtime-common';
import {
  LatticeMaterializationInputs,
  LatticeUnknownLinkInput,
} from '../lib/lattice-materialization-inputs.ts';
import {
  LatticeInputsPending,
  LatticeWorkSuperseded,
} from '@cardstack/runtime-common/lattice-work';
import type { Filter } from '@cardstack/runtime-common/query';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-inputs.example/';
const actor = '@reader:example.com';
const codeRef = { module: rri(realm + 'record'), name: 'Record' };
const definition: Definition = {
  type: 'card-def',
  displayName: 'Record',
  codeRef,
  fields: {
    amount: 'number',
    group: 'string',
    members: 'strings',
    id: 'string',
  },
  fieldDefs: {
    number: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      serializerName: 'number',
      fieldOrCard: { module: rri(realm + 'number'), name: 'Number' },
    },
    string: {
      type: 'contains',
      isPrimitive: true,
      isComputed: false,
      nativeCodec: { kind: 'primitive', scalar: 'string' },
      fieldOrCard: { module: rri(realm + 'string'), name: 'String' },
    },
    strings: {
      type: 'containsMany',
      isPrimitive: true,
      isComputed: false,
      nativeCodec: { kind: 'primitive', scalar: 'string' },
      fieldOrCard: { module: rri(realm + 'string'), name: 'String' },
    },
  },
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let network: VirtualNetwork;
  let lookups: number;
  let lookupRefs: string[];
  let statements: string[];
  async function card(name: string, amount: number, group = 'A') {
    let url = realm + name + '.json';
    await db.execute(
      `INSERT INTO boxel_index(url,file_alias,realm_url,type,generation,is_deleted,has_error,pristine_doc,search_doc,types)
      VALUES($1,$1,$2,'instance',5,FALSE,FALSE,$3,$4,$5)`,
      {
        bind: [
          url,
          realm,
          JSON.stringify({
            type: 'card',
            id: url.slice(0, -5),
            attributes: { amount, group },
            meta: { adoptsFrom: codeRef },
          }),
          JSON.stringify({ id: url.slice(0, -5), amount, group }),
          JSON.stringify([internalKeyFor(codeRef, undefined, network)]),
        ],
      },
    );
    return url;
  }
  async function materializedCard(
    name: string,
    amount: number,
    generation = 5,
    validatedThrough = generation - 1,
  ) {
    const url = await card(name, amount);
    await db.execute(
      `UPDATE boxel_index SET generation=$3,
      pristine_doc=jsonb_set(pristine_doc,'{meta,publication}',$2::jsonb) WHERE url=$1`,
      {
        bind: [
          url,
          JSON.stringify({
            version: 1,
            state: 'ready',
            outputRevision: generation,
            validatedThrough: validatedThrough,
            definitionRevision: 'epoch-1',
            computedFields: ['amount'],
            queryFields: [],
          }),
          generation,
        ],
      },
    );
    await db.execute(
      `INSERT INTO lattice_owners(realm_url,owner_url,published_generation,input_generation,dirty_generation,definition_revision,retired)
      VALUES($1,$2,$3,$4,NULL,'epoch-1',FALSE)`,
      { bind: [realm, url, generation, validatedThrough] },
    );
    return url;
  }
  const open = (signal?: AbortSignal, generation = 5) =>
    LatticeMaterializationInputs.open({
      signal,
      db,
      network,
      realmURL: realm,
      actor,
      generation,
      loaderEpoch: 'epoch-1',
      lookup: {
        async lookupDefinition(ref) {
          lookups++;
          lookupRefs.push(JSON.stringify(ref));
          return definition;
        },
      },
    });
  async function publish(check: (tx: any) => Promise<void>) {
    await db.withWriteLock('lattice:index:' + realm, async (tx) => {
      if (!tx) throw new Error('Missing transaction');
      await check(tx);
    });
  }
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      network = new VirtualNetwork();
      lookups = 0;
      lookupRefs = [];
      statements = [];
      await db.execute(
        'INSERT INTO realm_generations(realm_url,current_generation,loader_epoch) VALUES($1,5,$2)',
        { bind: [realm, 'epoch-1'] },
      );
      await db.execute('INSERT INTO realm_metadata(url) VALUES($1)', {
        bind: [realm],
      });
      await db.execute(
        'INSERT INTO realm_user_permissions(realm_url,username,read,write,realm_owner) VALUES($1,$2,TRUE,FALSE,FALSE)',
        { bind: [realm, actor] },
      );
      // Observe the actual SQL projection without replacing PostgreSQL behavior.
      const execute = db.execute.bind(db);
      db.execute = async (sql, opts) => {
        statements.push(sql);
        return execute(sql, opts);
      };
    },
  });

  test('input tracing distinguishes body fetch from same-frame reuse without changing data', async (assert) => {
    await card('one', 11);
    const input = await open();
    const events: Record<string, any>[] = [];
    configureLatticeTrace({
      identity: 'test',
      hash: (s) => createHash('sha256').update(s).digest('hex'),
      write: (e) => events.push(e),
    });
    try {
      input.trace = startLatticeTrace('input', 'native');
      const query = {
        filter: { on: codeRef, eq: { group: 'A' } },
        page: { size: 10 },
      };
      const one = await input.query('first', query);
      const two = await input.query('second', query);
      assert.deepEqual(two.cards, one.cards);
      assert.deepEqual(
        events.filter((e) => e.event === 'input-cache').map((e) => e.missing),
        [1, 0],
      );
      assert.strictEqual(
        events.filter((e) => e.event === 'input-bodies').length,
        1,
      );
      const memberships = events.filter((e) => e.event === 'membership');
      assert.strictEqual(memberships.length, 2);
      assert.strictEqual(
        memberships[0].membershipHash,
        memberships[1].membershipHash,
      );
      assert.true(
        events.some((e) => e.event === 'input-receipts' && e.items[0].version),
      );
      assert.false(JSON.stringify(events).includes('"amount":11'));
    } finally {
      configureLatticeTrace();
    }
  });

  test('query fields read published data with ordinary filtering, sorting and paging', async (assert) => {
    await card('one', 1);
    await card('three', 3);
    await card('two', 2);
    await card('other', 4, 'B');
    const input = await open();
    const query = {
      filter: { on: codeRef, eq: { group: 'A' } },
      sort: [{ on: codeRef, by: 'amount', direction: 'desc' as const }],
      page: { size: 2 },
    };
    const result = await input.query('records', query);
    assert.deepEqual(
      result.cards.map((c) => c.resource.attributes?.amount),
      [3, 2],
    );
    assert.strictEqual(result.meta.page.total, 3);
    assert.true(lookups > 0, 'only indexed schema metadata is consulted');
    const check = input.seal();
    // Three matches, a page of two: the watch is the filter plus the page's
    // cutoff, so a record that cannot reach the page never dirties the owner.
    assert.deepEqual(check.watches, [
      {
        fieldPath: 'records',
        query: {
          ...query,
          filter: {
            every: [
              query.filter,
              { on: codeRef, range: { amount: { gte: 2 } } },
            ],
          },
        },
      },
    ]);
    await publish(check.assertCurrent);
    const selects = statements.filter((s) => s.startsWith('SELECT'));
    assert.true(
      selects.some((s) => /^SELECT i\.url AS url[ ,]/.test(s)),
      'membership projects identities',
    );
    assert.false(
      selects.some((s) => /SELECT\s+i\.\*/.test(s)),
      'no wide row projection',
    );
    assert.false(
      selects.some((s) => /ANY_VALUE\(i.pristine_doc\)/.test(s)),
      'membership does not deserialize bodies',
    );
  });

  test('a projection predicate slices each member where the row is read', async (assert) => {
    const lines = (mine: number) => [
      { player: 'me', pa: mine },
      { player: 'them', pa: 9 },
    ];
    const boxed = async (name: string, mine: number) => {
      const url = await card(name, mine);
      await db.execute(
        `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,lines}',$2::jsonb) WHERE url=$1`,
        { bind: [url, JSON.stringify(lines(mine))] },
      );
      return url;
    };
    const one = await boxed('one', 1);
    const two = await boxed('two', 2);
    await card('bare', 3);
    const input = await open();
    const query = {
      filter: { on: codeRef, eq: { group: 'A' } },
      page: { size: 10 },
    };
    const where = { lines: { player: 'me' } };
    const result = await input.query('records', query, { where });
    const byURL = new Map(
      result.cards.map((c) => [c.url, c.resource.attributes]),
    );
    assert.deepEqual(
      byURL.get(one)?.lines,
      [{ player: 'me', pa: 1 }],
      'sliced to the predicate',
    );
    assert.deepEqual(byURL.get(two)?.lines, [{ player: 'me', pa: 2 }]);
    assert.strictEqual(
      byURL.get(realm + 'bare.json')?.lines,
      undefined,
      'a card without the collection is left alone',
    );
    const bodies = statements.filter((s) => /AS body/.test(s));
    assert.true(bodies.length > 0, 'bodies were read');
    assert.true(
      bodies.every((s) =>
        /jsonb_array_elements\(i\.pristine_doc->'attributes'->'lines'\)/.test(
          s,
        ),
      ),
      'the slice is taken in SQL',
    );
    // The same card read whole by another root is the whole row, at the
    // same version, from a separate store; a sliced read after a whole one
    // slices in Node instead of re-reading.
    const [whole] = await input.read([one]);
    assert.deepEqual(whole.resource.attributes?.lines, lines(1));
    const bodiesBefore = statements.filter((s) => /AS body/.test(s)).length;
    const again = await input.read([two]);
    assert.deepEqual(
      again[0].resource.attributes?.lines,
      lines(2),
      'whole after sliced re-reads the row',
    );
    assert.strictEqual(
      statements.filter((s) => /AS body/.test(s)).length,
      bodiesBefore + 1,
    );
    const check = input.seal();
    assert.deepEqual(
      check.projections,
      { records: where },
      'the predicate rides with the watch',
    );
    await publish(check.assertCurrent);
  });

  test('native query preparation reuses the input definitions and retains linked identities', async (assert) => {
    const url = await card('one', 1);
    const input = await open();
    await input.query('records', {
      filter: { on: codeRef, eq: { group: 'A' } },
      sort: [{ on: codeRef, by: 'amount', direction: 'desc' }],
      page: { size: 10 },
    });
    const before = [...lookupRefs];
    const receipt = await input.sealWithQueries();
    assert.true(before.length > 0);
    assert.false(
      lookupRefs.slice(before.length).some((ref) => before.includes(ref)),
      'preparation does not reread any previously resolved schema',
    );
    assert.deepEqual(receipt.queryPreparation?.manifest, [
      ...receipt.watches,
      {
        fieldPath: '@lattice/inputs',
        query: {
          realms: [realm],
          filter: { in: { id: [url.slice(0, -5)] } },
        },
      },
    ]);
    await publish(receipt.assertCurrent);
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','2') WHERE url=$1",
      { bind: [url] },
    );
    await assert.rejects(
      publish(receipt.assertCurrent),
      /input changed before publication/,
    );
    await assert.rejects(input.sealWithQueries(), /incomplete|sealed/i);
  });

  test('native preparation cannot seal an input frame overtaken by code changes', async (assert) => {
    const input = await open();
    await input.query('records', {
      filter: { on: codeRef, eq: { group: 'A' } },
      page: { size: 10 },
    });
    await db.execute(
      "UPDATE realm_generations SET loader_epoch='epoch-2' WHERE realm_url=$1",
      { bind: [realm] },
    );
    await assert.rejects(
      input.sealWithQueries(),
      /generation or read authority changed/,
    );
    assert.throws(() => input.seal(), /incomplete/);
  });

  test('retention orders feeder validation separately from an unchanged output generation', async (assert) => {
    const url = await materializedCard('feeder', 7);
    const snapshots = new LatticeRetainedSnapshots(
      new LatticeRealmConfig([realm]),
      (expr) => db.withConnection((tx) => tx(expr)),
    );
    const link = {
      realmURL: realm,
      ownerURL: realm + 'consumer',
      fieldPath: 'records',
      source: { realmURL: realm, url: url.slice(0, -5) },
    };
    const capture = async (generation: number) => {
      const frame = await open(undefined, generation);
      await frame.query('records', {
        filter: { on: codeRef, eq: { group: 'A' } },
        page: { size: 10 },
      });
      const receipt = frame.seal();
      await publish(async (tx) => {
        await receipt.assertCurrent(tx);
        await snapshots.recordChange(tx, {
          kind: 'capture-index',
          realmURL: realm,
          ownerURL: link.ownerURL,
          consumerGeneration: generation + 1,
          inputs: receipt.retainedInputs,
        });
      });
      return (await snapshots.read({ link }))!;
    };
    const first = await capture(5);
    assert.strictEqual(first.snapshot.validatedThrough, 5);
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,validatedThrough}','6') WHERE url=$1",
      { bind: [url] },
    );
    await db.execute(
      'UPDATE lattice_owners SET input_generation=6 WHERE owner_url=$1',
      { bind: [url] },
    );
    await db.execute(
      'UPDATE realm_generations SET current_generation=6 WHERE realm_url=$1',
      { bind: [realm] },
    );
    const next = await capture(6);
    assert.strictEqual(next.snapshot.validatedThrough, 6);
    const data = JSON.parse(next.document).data;
    assert.strictEqual(
      data.meta.publication.outputRevision,
      5,
      'equal-output cutoff keeps the previous output version',
    );
    assert.strictEqual(data.meta.publication.validatedThrough, 6);
    assert.deepEqual(
      data.attributes,
      JSON.parse(first.document).data.attributes,
    );
  });

  test('identity reads do not consult a module and returned data cannot mutate the snapshot', async (assert) => {
    const url = await card('one', 1);
    const input = await open();
    const first = await input.read([url]);
    first[0].resource.attributes!.amount = 99;
    const again = await input.read([url]);
    assert.strictEqual(again[0].resource.attributes?.amount, 1);
    assert.strictEqual(lookups, 0);
    assert.strictEqual(
      statements.filter((s) => s.includes('END AS body')).length,
      1,
      'the second read reuses the value already resident in this input frame',
    );
    await publish(input.seal().assertCurrent);
  });

  test('supersession during a header read prevents body loading and publication', async (assert) => {
    const url = await card('one', 1);
    const controller = new AbortController();
    const reason = new LatticeWorkSuperseded('newer input');
    const input = await open(controller.signal);
    const execute = db.execute.bind(db);
    // Keep real SQL/results. Abort at the boundary where the header query
    // returns, before the reader can request or deserialize the card body.
    db.execute = async (sql, opts) => {
      const result = await execute(sql, opts);
      if (/octet_length\(\(\s*i\.pristine_doc\s*\)::text\) AS bytes/.test(sql))
        controller.abort(reason);
      return result;
    };
    await assert.rejects(
      input.read([url]),
      (error: unknown) => error === reason,
    );
    assert.true(controller.signal.aborted, 'the real header read was reached');
    assert.false(
      statements.some((sql) => sql.includes('END AS body')),
      'no JSON body query is issued after cancellation',
    );
    assert.throws(() => input.seal(), /superseded/i);
  });

  test('a changed input row rejects publication even before its realm generation advances', async (assert) => {
    const url = await card('one', 1),
      input = await open();
    await input.read([url]);
    const check = input.seal();
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','2') WHERE url=$1",
      { bind: [url] },
    );
    await assert.rejects(
      publish(check.assertCurrent),
      /input changed before publication/,
    );
  });

  test('a newly matching card invalidates an empty membership through its publication generation', async (assert) => {
    const input = await open();
    const found = await input.query('records', {
      filter: { on: codeRef, eq: { group: 'A' } },
      page: { size: 10 },
    });
    assert.strictEqual(found.cards.length, 0);
    const check = input.seal();
    await card('new', 3);
    await db.execute(
      'UPDATE realm_generations SET current_generation=6 WHERE realm_url=$1',
      { bind: [realm] },
    );
    await assert.rejects(
      publish(check.assertCurrent),
      /generation or read authority changed/,
    );
  });

  test('unmatched source changes prevent a materialization from consuming feeders as current', async (assert) => {
    const input = await open();
    await db.execute(
      'INSERT INTO lattice_pending_generations(realm_url,generation,definition_revision) VALUES($1,5,$2)',
      { bind: [realm, 'epoch-1'] },
    );
    await assert.rejects(input.read([]), /matching is pending/);
    assert.throws(
      () => input.seal(),
      /incomplete/,
      'catching the read failure cannot publish an empty list',
    );
  });

  for (const [name, sql] of [
    [
      'permission revocation',
      'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1',
    ],
    [
      'realm archival',
      'UPDATE realm_metadata SET archived_at=NOW() WHERE url=$1',
    ],
    [
      'module epoch invalidation',
      "UPDATE realm_generations SET loader_epoch='epoch-2' WHERE realm_url=$1",
    ],
  ])
    test(name + ' rejects pending publication', async (assert) => {
      const url = await card('one', 1),
        input = await open();
      await input.read([url]);
      const check = input.seal();
      await db.execute(sql, { bind: [realm] });
      await assert.rejects(
        publish(check.assertCurrent),
        /generation or read authority changed/,
      );
    });

  test('materialized card data can be consumed but a later dirty mark invalidates the dependent', async (assert) => {
    const url = await materializedCard('feeder', 2);
    const input = await open();
    const cards = await input.read([url]);
    assert.strictEqual(cards[0].resource.attributes?.amount, 2);
    const check = input.seal();
    await publish(check.assertCurrent);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    await assert.rejects(
      publish(check.assertCurrent),
      /feeder freshness changed/,
    );
    await assert.rejects((await open()).read([url]), /feeder is not current/);
  });

  test('a stale frame reads a feeder re-registered pending with its last body; a bodiless stub still blocks', async (assert) => {
    // An owner re-indexed as a source is re-registered pending, with its
    // publication (and output revision) intact.
    const url = await materializedCard('feeder', 2);
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,state}','"pending"') WHERE url=$1`,
      { bind: [url] },
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    await assert.rejects(
      (await open()).read([url]),
      /feeder is not current/,
      'an ordinary frame waits for the feeder',
    );
    const staleFrame = () =>
      LatticeMaterializationInputs.open({
        db,
        network,
        realmURL: realm,
        actor,
        generation: 5,
        loaderEpoch: 'epoch-1',
        stale: true,
        lookup: {
          async lookupDefinition() {
            return definition;
          },
        },
      });
    const stale = await staleFrame();
    const cards = await stale.read([url]);
    assert.strictEqual(
      cards[0].resource.attributes?.amount,
      2,
      'the body the feeder last published, through its pending state',
    );
    const found = await stale.query('records', {
      filter: { on: codeRef, eq: { group: 'A' } },
      page: { size: 10 },
    });
    assert.strictEqual(found.cards.length, 1, 'and by query');
    // A registration stub (no output revision) has no body to read.
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=(pristine_doc #- '{meta,publication,outputRevision}') WHERE url=$1`,
      { bind: [url] },
    );
    await assert.rejects(
      (await staleFrame()).read([url]),
      /feeder is not current/,
      'a stub with no output revision blocks a stale attempt',
    );
  });

  for (const registered of [true, false]) {
    test(`a never-published query input yields without a failure (registered=${registered})`, async (assert) => {
      const url = await materializedCard('stub', 2);
      await db.execute(
        `UPDATE boxel_index SET pristine_doc=(pristine_doc #- '{meta,publication,outputRevision}') WHERE url=$1`,
        { bind: [url] },
      );
      if (!registered)
        await db.execute('DELETE FROM lattice_owners WHERE owner_url=$1', {
          bind: [url],
        });
      try {
        await (
          await open()
        ).query('feeders', { filter: { type: codeRef }, page: { size: 10 } });
        assert.ok(false, 'a stub cannot be consumed');
      } catch (error) {
        assert.true(
          error instanceof LatticeInputsPending,
          'deferred scheduling outcome, not a computation failure',
        );
      }
    });
  }

  test('an intermediate query can publish its captured membership when a later stub arrives', async (assert) => {
    const url = await materializedCard('captured', 2);
    const staleFrame = () =>
      LatticeMaterializationInputs.open({
        db,
        network,
        realmURL: realm,
        actor,
        generation: 5,
        loaderEpoch: 'epoch-1',
        stale: true,
        lookup: {
          async lookupDefinition() {
            return definition;
          },
        },
      });
    const input = await staleFrame();
    const result = await input.query('records', {
      filter: { type: codeRef },
      page: { size: 10 },
    });
    assert.deepEqual(
      result.cards.map((row) => row.resource.attributes?.amount),
      [2],
    );
    const receipt = input.seal();
    const next = await materializedCard('new-stub', 3, 6, 5);
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=pristine_doc #- '{meta,publication,outputRevision}' WHERE url=$1",
      { bind: [next] },
    );
    await db.execute(
      'UPDATE realm_generations SET current_generation=6 WHERE realm_url=$1',
      { bind: [realm] },
    );
    await publish(receipt.assertCurrent);
    assert.ok(
      true,
      'a newer entrant does not veto a complete captured intermediate result',
    );
    await assert.rejects(
      (await staleFrame()).query('records', {
        filter: { type: codeRef },
        page: { size: 10 },
      }),
      (error: unknown) => error instanceof LatticeInputsPending,
      'a new attempt still cannot consume the bodiless input',
    );
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','9') WHERE url=$1",
      { bind: [url] },
    );
    await assert.rejects(
      publish(receipt.assertCurrent),
      /input changed before publication/,
      'captured input row revisions still fence publication',
    );
  });

  const openIntermediate = () =>
    LatticeMaterializationInputs.open({
      db,
      network,
      realmURL: realm,
      actor,
      generation: 5,
      loaderEpoch: 'epoch-1',
      stale: true,
      lookup: {
        async lookupDefinition() {
          return definition;
        },
      },
    });
  async function advanceFeeder(url: string) {
    await db.execute(
      `UPDATE boxel_index SET generation=6,
      pristine_doc=jsonb_set(jsonb_set(pristine_doc,'{attributes,amount}','9'),
        '{meta,publication,outputRevision}','6') WHERE url=$1`,
      { bind: [url] },
    );
    await db.execute(
      'UPDATE realm_generations SET current_generation=6 WHERE realm_url=$1',
      { bind: [realm] },
    );
    await db.execute(
      'UPDATE lattice_owners SET published_generation=6,input_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
  }

  test('intermediate results retain the exact captured bytes as feeders publish newer values', async (assert) => {
    const url = await materializedCard('advancing', 2);
    const input = await openIntermediate();
    const values = await input.query('records', {
      filter: { type: codeRef },
      page: { size: 10 },
    });
    // Caller mutation cannot alter the immutable publication receipt.
    values.cards[0].resource.attributes!.amount = 100;
    const receipt = input.seal();
    await advanceFeeder(url);
    const snapshots = new LatticeRetainedSnapshots(
      new LatticeRealmConfig([realm]),
      (expr) => db.withConnection((tx) => tx(expr)),
    );
    const link = {
      realmURL: realm,
      ownerURL: realm + 'consumer',
      fieldPath: 'records',
      source: { realmURL: realm, url: url.slice(0, -5) },
    };
    await publish(async (tx) => {
      await receipt.assertCurrent(tx);
      await snapshots.recordChange(tx, {
        kind: 'capture-index',
        realmURL: realm,
        ownerURL: link.ownerURL,
        consumerGeneration: 7,
        inputs: receipt.retainedInputs,
        capturedInputs: receipt.capturedInputs,
      });
    });
    const retained = (await snapshots.read({ link }))!;
    assert.strictEqual(
      JSON.parse(retained.document).data.attributes.amount,
      2,
      'neither the newer row nor the mutated caller value is retained',
    );
    assert.strictEqual(
      JSON.parse(retained.document).data.meta.publication.outputRevision,
      5,
    );
    assert.strictEqual(
      retained.snapshot.validatedThrough,
      5,
      'no claim to have consumed the new value',
    );
  });

  for (const mutation of [
    'deleted',
    'failed',
    'retired',
    'definition',
    'permission',
    'epoch',
    'missing',
  ] as const) {
    test(`intermediate advancing inputs still reject ${mutation}`, async (assert) => {
      const url = await materializedCard('advancing', 2);
      const input = await openIntermediate();
      await input.read([url]);
      const receipt = input.seal();
      await advanceFeeder(url);
      switch (mutation) {
        case 'deleted':
          await db.execute(
            'UPDATE boxel_index SET is_deleted=TRUE WHERE url=$1',
            { bind: [url] },
          );
          break;
        case 'failed':
          await db.execute(
            'UPDATE boxel_index SET has_error=TRUE WHERE url=$1',
            { bind: [url] },
          );
          break;
        case 'retired':
          await db.execute(
            'UPDATE lattice_owners SET retired=TRUE WHERE owner_url=$1',
            { bind: [url] },
          );
          break;
        case 'definition':
          await db.execute(
            "UPDATE lattice_owners SET definition_revision='changed' WHERE owner_url=$1",
            { bind: [url] },
          );
          break;
        case 'permission':
          await db.execute(
            'UPDATE realm_user_permissions SET read=FALSE WHERE realm_url=$1',
            { bind: [realm] },
          );
          break;
        case 'epoch':
          await db.execute(
            "UPDATE realm_generations SET loader_epoch='changed' WHERE realm_url=$1",
            { bind: [realm] },
          );
          break;
        case 'missing':
          await db.execute('DELETE FROM boxel_index WHERE url=$1', {
            bind: [url],
          });
          break;
      }
      await assert.rejects(publish(receipt.assertCurrent), /changed/);
    });
  }

  test('intermediate plain sources remain exact and fresh frames still reject advancing feeders', async (assert) => {
    const source = await card('source', 2);
    const input = await openIntermediate();
    await input.read([source]);
    const receipt = input.seal();
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','9') WHERE url=$1",
      { bind: [source] },
    );
    await assert.rejects(
      publish(receipt.assertCurrent),
      /input changed before publication/,
    );
    const feeder = await materializedCard('feeder', 2);
    const fresh = await open();
    await fresh.read([feeder]);
    const exact = fresh.seal();
    await advanceFeeder(feeder);
    await assert.rejects(publish(exact.assertCurrent), /changed/);
  });

  test('an intermediate projection retains the complete captured source and enforces its byte bound', async (assert) => {
    const url = await materializedCard('projected', 2);
    const lines = [
      { player: 'me', pa: 1 },
      { player: 'them', pa: 9 },
    ];
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,lines}',$2::jsonb) WHERE url=$1",
      { bind: [url, JSON.stringify(lines)] },
    );
    const input = await openIntermediate();
    const result = await input.query(
      'records',
      { filter: { type: codeRef }, page: { size: 10 } },
      { where: { lines: { player: 'me' } } },
    );
    assert.deepEqual(
      result.cards[0].resource.attributes!.lines,
      [lines[0]],
      'evaluator sees only the projection',
    );
    const receipt = input.seal();
    assert.deepEqual(
      JSON.parse(receipt.capturedInputs[0].document).attributes.lines,
      lines,
      'retention sees the complete original',
    );
    await advanceFeeder(url);
    await publish(receipt.assertCurrent);
    const oldLimit = LatticeMaterializationInputs.MAX_CARD_BYTES;
    LatticeMaterializationInputs.MAX_CARD_BYTES = 1;
    try {
      // Read at generation six with the same original shape to reach the budget check.
      await db.execute('UPDATE boxel_index SET generation=5 WHERE url=$1', {
        bind: [url],
      });
      await assert.rejects(
        (await openIntermediate()).query(
          'records',
          { filter: { type: codeRef }, page: { size: 10 } },
          { where: { lines: { player: 'me' } } },
        ),
        /oversized/,
      );
    } finally {
      LatticeMaterializationInputs.MAX_CARD_BYTES = oldLimit;
    }
  });

  test('intermediate equal-output confirmation does not discard completed arithmetic', async (assert) => {
    const url = await materializedCard('same', 2);
    const input = await openIntermediate();
    await input.read([url]);
    const receipt = input.seal();
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,validatedThrough}','5') WHERE url=$1",
      { bind: [url] },
    );
    await publish(receipt.assertCurrent);
    assert.ok(
      true,
      'same data with newer validation is still a valid intermediate input',
    );
  });

  test('an input newer than its captured frame defers rather than recording a computation failure', async (assert) => {
    const url = await card('advanced', 2);
    const input = await open();
    await db.execute('UPDATE boxel_index SET generation=6 WHERE url=$1', {
      bind: [url],
    });
    await assert.rejects(
      input.read([url]),
      (error: unknown) => error instanceof LatticeInputsPending,
      'the next wave needs a new frame',
    );
    assert.throws(
      () => input.seal(),
      /incomplete/,
      'no partial result can publish',
    );
  });

  test('a stale frame reads a dirty feeder at its last published body', async (assert) => {
    const url = await materializedCard('feeder', 2);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    await assert.rejects(
      (await open()).read([url]),
      /feeder is not current/,
      'an ordinary frame waits for the feeder',
    );
    const stale = await LatticeMaterializationInputs.open({
      db,
      network,
      realmURL: realm,
      actor,
      generation: 5,
      loaderEpoch: 'epoch-1',
      stale: true,
      lookup: {
        async lookupDefinition() {
          return definition;
        },
      },
    });
    const cards = await stale.read([url]);
    assert.strictEqual(
      cards[0].resource.attributes?.amount,
      2,
      'the value the feeder last published',
    );
    // A query over the feeder's type is answered the same way, where an
    // ordinary frame refuses to evaluate membership over stale computeds.
    await assert.rejects(
      (await open()).query('feeders', {
        filter: { type: codeRef },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
    );
    const result = await stale.query('feeders', {
      filter: { type: codeRef },
      page: { size: 10 },
    });
    assert.deepEqual(
      result.cards.map((card) => card.resource.attributes?.amount),
      [2],
    );
    const check = stale.seal();
    await publish(check.assertCurrent);
    // The feeder moving on before publication does not fence a stale
    // attempt either: its owner keeps the obligation that covers it.
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=6 WHERE owner_url=$1',
      { bind: [url] },
    );
    await publish(check.assertCurrent);
    // Nor does a matching backlog or a generation that moved on: the stale
    // attempt is the one that must land while source keeps arriving.
    await db.execute(
      "INSERT INTO lattice_pending_generations(realm_url, generation, definition_revision) VALUES ($1, 6, 'epoch-1')",
      { bind: [realm] },
    );
    await assert.rejects(
      open(),
      /matching is pending/,
      'an ordinary frame waits',
    );
    await publish(check.assertCurrent);
    // Under a stream a dirty feeder's owner row is re-registered pending on
    // every tick (its published generation moves past its index row, its
    // input generation reads 0); the index row is still the last ready
    // publication and a stale frame still reads it, by card and by query.
    await db.execute(
      'UPDATE lattice_owners SET published_generation=9, input_generation=0, dirty_generation=9 WHERE owner_url=$1',
      { bind: [url] },
    );
    const again = await LatticeMaterializationInputs.open({
      db,
      network,
      realmURL: realm,
      actor,
      generation: 5,
      loaderEpoch: 'epoch-1',
      stale: true,
      lookup: {
        async lookupDefinition() {
          return definition;
        },
      },
    });
    assert.strictEqual(
      (await again.read([url]))[0].resource.attributes?.amount,
      2,
    );
    assert.deepEqual(
      (
        await again.query('feeders', {
          filter: { type: codeRef },
          page: { size: 10 },
        })
      ).cards.map((card) => card.resource.attributes?.amount),
      [2],
    );
    await publish(again.seal().assertCurrent);
    await db.execute(
      'UPDATE realm_generations SET current_generation = current_generation + 1 WHERE realm_url=$1',
      { bind: [realm] },
    );
    await publish(check.assertCurrent);
  });

  test('BXL consumes fresh computed data from older publications without rebuilding the feeders', async (assert) => {
    await materializedCard('first', 20, 3, 5);
    await materializedCard('second', 30, 4);
    const input = await open();
    const result = await input.query('feeders', {
      filter: { type: codeRef },
      page: { size: 10 },
    });
    assert.deepEqual(
      result.cards.map((c) => c.generation),
      [3, 4],
    );
    assert.strictEqual(
      lookups,
      1,
      'type validation consults only the indexed definition DTO',
    );
    const worker = new LatticeBxlWorker();
    try {
      const computed = await worker.evaluate(
        {
          version: 1,
          definition: {
            module: realm + 'dashboard',
            name: 'Dashboard',
            revision: 'epoch-1',
          },
          field: 'total',
          expression: '[.feeders[] | .amount] | add',
          input: {
            object: { feeders: { array: { object: { amount: 'number' } } } },
          },
          output: 'number',
        },
        [
          {
            id: realm + 'dashboard',
            revision: 'generation-5',
            json: JSON.stringify({
              feeders: result.cards.map((c) => ({
                amount: c.resource.attributes!.amount,
              })),
            }),
          },
        ],
      );
      assert.strictEqual(computed.artifacts[0].value, 50);
      await publish(input.seal().assertCurrent);
      const owners = await db.execute(
        'SELECT published_generation FROM lattice_owners ORDER BY owner_url',
      );
      assert.deepEqual(
        owners.map((o) => Number(o.published_generation)),
        [3, 4],
        'consuming the computed values did not republish or rebuild either feeder',
      );
    } finally {
      await worker.close();
    }
  });

  test('retained output cannot claim validation beyond the current input frame', async (assert) => {
    const url = await materializedCard('future-validation', 20, 3, 6);
    await assert.rejects((await open()).read([url]), /feeder is not current/);
    await assert.rejects(
      (await open()).query('future', {
        filter: { type: codeRef },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
    );
  });

  test('relationships remain card references instead of fetching a linked graph', async (assert) => {
    const url = await card('linked', 2);
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{relationships}',$2::jsonb) WHERE url=$1`,
      {
        bind: [
          url,
          JSON.stringify({ child: { links: { self: './not-indexed' } } }),
        ],
      },
    );
    const input = await open();
    const [value] = await input.read([url]);
    assert.deepEqual(value.resource.relationships?.child, {
      links: { self: './not-indexed' },
    });
    assert.strictEqual(lookups, 0);
    await publish(input.seal().assertCurrent);
  });

  test('malformed materialization metadata cannot be reused as a fresh computation', async (assert) => {
    const url = await materializedCard('feeder', 2);
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,computedFields}','null') WHERE url=$1`,
      { bind: [url] },
    );
    const input = await open();
    await assert.rejects(input.read([url]), /invalid provenance/);
    assert.throws(() => input.seal(), /incomplete/);
  });

  test('an explicitly retired owner can become an ordinary indexed input', async (assert) => {
    const url = await materializedCard('folded', 12);
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=pristine_doc #- '{meta,publication}' WHERE url=$1",
      { bind: [url] },
    );
    await db.execute(
      'UPDATE lattice_owners SET retired=TRUE WHERE owner_url=$1',
      { bind: [url] },
    );
    const input = await open();
    assert.strictEqual(
      (await input.read([url]))[0].resource.attributes?.amount,
      12,
    );
    await publish(input.seal().assertCurrent);
    const next = await open();
    await next.read([url]);
    const receipt = next.seal();
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}','13') WHERE url=$1",
      { bind: [url] },
    );
    await assert.rejects(
      publish(receipt.assertCurrent),
      /input changed before publication/,
      'ordinary source fence remains',
    );
  });

  test('a registered materialization without provenance cannot masquerade as an ordinary input', async (assert) => {
    const url = await materializedCard('feeder', 2);
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=pristine_doc #- '{meta,publication}' WHERE url=$1",
      { bind: [url] },
    );
    await assert.rejects((await open()).read([url]), /has no provenance/);
  });

  async function sourceProof(
    url: string,
    fields: Record<string, string> = { group: 'string' },
  ) {
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,sourceFields}',$2::jsonb) WHERE url=$1`,
      { bind: [url, JSON.stringify(fields)] },
    );
  }

  test('readiness follows index and owner changes without a realm fingerprint or wide-body scan', async (assert) => {
    const a = await materializedCard('a', 2);
    await sourceProof(a);
    await card('b', 3, 'B');
    const read = async (group: string) => {
      const input = await open();
      const result = await input.query('records', {
        filter: { on: codeRef, eq: { group } },
        page: { size: 10 },
      });
      return { input, result };
    };
    const first = await read('A');
    assert.deepEqual(
      first.result.cards.map((c) => c.resource.attributes?.amount),
      [2],
    );
    const second = await read('B');
    assert.deepEqual(
      second.result.cards.map((c) => c.resource.attributes?.amount),
      [3],
    );
    await publish(first.input.seal().assertCurrent);
    await publish(second.input.seal().assertCurrent);
    assert.false(
      statements.some((sql) => sql.includes('string_agg(owner_url')),
      'no realm-wide cache fingerprint',
    );
    assert.false(
      statements.some((sql) =>
        sql.includes('SELECT 1 FROM lattice_owners o LEFT JOIN boxel_index i'),
      ),
      'readiness does not fetch full indexed bodies',
    );
    const [compact] = await db.execute(
      'SELECT pristine_doc,search_doc FROM lattice_input_readiness WHERE url=$1',
      { bind: [a] },
    );
    assert.notOk(
      (compact.pristine_doc as any).attributes,
      'no card attributes duplicated in readiness',
    );
    assert.notOk(
      (compact.search_doc as any).amount,
      'computed values are not source partition evidence',
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [a] },
    );
    assert.strictEqual(
      (await read('B')).result.cards.length,
      1,
      'unrelated partition still runs',
    );
    await assert.rejects(read('A'), /unsettled materialized inputs/);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=NULL WHERE owner_url=$1',
      { bind: [a] },
    );
    assert.strictEqual(
      (await read('A')).result.cards.length,
      1,
      'settling releases the partition',
    );
    // No owner column or realm generation changes: the old guard cache could
    // incorrectly reuse a pass. The index-owned facts must change immediately.
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=pristine_doc #- '{meta,publication,outputRevision}' WHERE url=$1",
      { bind: [a] },
    );
    await assert.rejects(
      read('A'),
      /unsettled materialized inputs/,
      'index-only stub transition is visible',
    );
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{meta,publication,outputRevision}','5') WHERE url=$1",
      { bind: [a] },
    );
    assert.strictEqual((await read('A')).result.cards.length, 1);
    await db.execute('DELETE FROM boxel_index WHERE url=$1', { bind: [a] });
    assert.deepEqual(
      await db.execute('SELECT url FROM lattice_input_readiness WHERE url=$1', {
        bind: [a],
      }),
      [],
    );
    await assert.rejects(
      read('B'),
      /unsettled materialized inputs/,
      'unknown missing type is conservative',
    );
  });

  test('ordinary cards do not create readiness artifacts', async (assert) => {
    await card('ordinary', 5);
    assert.deepEqual(
      await db.execute('SELECT url FROM lattice_input_readiness'),
      [],
    );
  });

  test('source partitions release a consumer while another partition remains dirty', async (assert) => {
    const unrelated = await materializedCard('other', 2);
    await sourceProof(unrelated);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [unrelated] },
    );
    await card('mine', 3, 'B');
    const input = await open();
    const result = await input.query('records', {
      filter: { on: codeRef, eq: { group: 'B' } },
      page: { size: 10 },
    });
    assert.deepEqual(
      result.cards.map((c) => c.resource.attributes?.amount),
      [3],
    );
    await publish(input.seal().assertCurrent);
    await assert.rejects(
      (await open()).query('records', {
        filter: { on: codeRef, eq: { group: 'A' } },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
      'the relevant consumer defers',
    );
  });

  test('new unregistered stubs only withhold consumers in their source partition', async (assert) => {
    const stub = await materializedCard('stub', 2);
    await sourceProof(stub);
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=pristine_doc #- '{meta,publication,outputRevision}' WHERE url=$1`,
      { bind: [stub] },
    );
    await db.execute('DELETE FROM lattice_owners WHERE owner_url=$1', {
      bind: [stub],
    });
    const input = await open();
    const result = await input.query('other', {
      filter: { on: codeRef, eq: { group: 'B' } },
      page: { size: 10 },
    });
    assert.strictEqual(result.cards.length, 0);
    await publish(input.seal().assertCurrent);
    await assert.rejects(
      (await open()).query('mine', {
        filter: { on: codeRef, eq: { group: 'A' } },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
    );
  });

  for (const [name, filter] of Object.entries<Filter>({
    'OR with an unknown computed branch': {
      on: codeRef,
      any: [{ eq: { group: 'B' } }, { range: { amount: { gt: 10 } } }],
    },
    NOT: { on: codeRef, not: { eq: { group: 'A' } } },
    'computed field also listed as source': {
      on: codeRef,
      eq: { amount: 'large' },
    },
  }))
    test('source pruning preserves ' + name, async (assert) => {
      const url = await materializedCard('feeder', 2);
      await sourceProof(url, { group: 'string', amount: 'string' });
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
        { bind: [url] },
      );
      await assert.rejects(
        (await open()).query('records', { filter, page: { size: 10 } }),
        /unsettled materialized inputs/,
      );
    });

  test('string-array source membership and OR use the same conservative scope', async (assert) => {
    const url = await materializedCard('feeder', 2);
    await sourceProof(url, { group: 'string', members: 'strings' });
    await db.execute(
      `UPDATE boxel_index SET search_doc=jsonb_set(search_doc,'{members}','["alice","bob"]') WHERE url=$1`,
      { bind: [url] },
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    const input = await open();
    const absent = await input.query('other', {
      filter: {
        on: codeRef,
        any: [{ eq: { members: 'charlie' } }, { in: { group: ['B', 'C'] } }],
      },
      page: { size: 10 },
    });
    assert.strictEqual(absent.cards.length, 0);
    await publish(input.seal().assertCurrent);
    await assert.rejects(
      (await open()).query('mine', {
        filter: {
          on: codeRef,
          any: [
            { eq: { group: 'B' } },
            { in: { members: ['charlie', 'bob'] } },
          ],
        },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
    );
    await sourceProof(url, { group: 'strings' });
    await assert.rejects(
      (await open()).query('mismatch', {
        filter: { on: codeRef, eq: { group: 'B' } },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
      'different schema arity cannot authorize exclusion',
    );
  });

  test('source partition receipts still reject code changes and entrants before ordinary publication', async (assert) => {
    const url = await materializedCard('feeder', 2);
    await sourceProof(url);
    const input = await open();
    await input.query('other', {
      filter: { on: codeRef, eq: { group: 'B' } },
      page: { size: 10 },
    });
    const receipt = input.seal();
    await db.execute(
      `UPDATE boxel_index SET search_doc=jsonb_set(search_doc,'{group}','"B"') WHERE url=$1`,
      { bind: [url] },
    );
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    await assert.rejects(
      publish(receipt.assertCurrent),
      /unsettled materialized inputs/,
    );
    await db.execute(
      `UPDATE boxel_index SET search_doc=jsonb_set(search_doc,'{group}','"A"') WHERE url=$1`,
      { bind: [url] },
    );
    await db.execute(
      `UPDATE lattice_owners SET definition_revision='obsolete' WHERE owner_url=$1`,
      { bind: [url] },
    );
    await assert.rejects(
      (await open()).query('other', {
        filter: { on: codeRef, eq: { group: 'B' } },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
      'obsolete code cannot authorize exclusion',
    );
  });

  test('a dirty nonmatching feeder cannot turn into a confirmed empty query result', async (assert) => {
    const url = await materializedCard('feeder', 2);
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    const input = await open();
    await assert.rejects(
      input.query('large', {
        filter: { on: codeRef, range: { amount: { gt: 10 } } },
        page: { size: 10 },
      }),
      /unsettled materialized inputs/,
    );
    assert.throws(() => input.seal(), /incomplete/);
  });

  test('a nonmatching feeder dirtied during computation invalidates even an empty membership receipt', async (assert) => {
    const url = await materializedCard('feeder', 2);
    const input = await open();
    const found = await input.query('large', {
      filter: { on: codeRef, range: { amount: { gt: 10 } } },
      page: { size: 10 },
    });
    assert.strictEqual(found.cards.length, 0);
    const check = input.seal();
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    await assert.rejects(
      publish(check.assertCurrent),
      /unsettled materialized inputs/,
    );
  });

  test('a dirty unrelated card type does not block reuse of a typed query', async (assert) => {
    await card('first', 1);
    const url = await materializedCard('unrelated', 2);
    const otherType = { module: rri(realm + 'different'), name: 'Different' };
    await db.execute('UPDATE boxel_index SET types=$2 WHERE url=$1', {
      bind: [
        url,
        JSON.stringify([internalKeyFor(otherType, undefined, network)]),
      ],
    });
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    const input = await open();
    const found = await input.query('records', {
      filter: { type: codeRef },
      page: { size: 10 },
    });
    assert.strictEqual(found.cards.length, 1);
    await publish(input.seal().assertCurrent);
    await assert.rejects(
      (await open()).query('all', { page: { size: 10 } }),
      /unsettled materialized inputs/,
      'an untyped query cannot make that exclusion',
    );
  });

  test('nested positive type predicates exclude an unrelated dirty materialization', async (assert) => {
    await card('first', 1);
    const url = await materializedCard('unrelated', 2);
    const otherType = { module: rri(realm + 'different'), name: 'Different' };
    await db.execute('UPDATE boxel_index SET types=$2 WHERE url=$1', {
      bind: [
        url,
        JSON.stringify([internalKeyFor(otherType, undefined, network)]),
      ],
    });
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      {
        bind: [url],
      },
    );
    const input = await open();
    const found = await input.query('records', {
      filter: {
        every: [
          { on: codeRef, eq: { group: 'A' } },
          {
            any: [
              { on: codeRef, range: { amount: { gt: 0 } } },
              { type: codeRef },
            ],
          },
        ],
      },
      page: { size: 10 },
    });
    assert.strictEqual(found.cards.length, 1);
    await publish(input.seal().assertCurrent);
  });

  for (const [name, filter] of Object.entries<Filter>({
    'a negative type predicate': { not: { type: codeRef } },
    'an OR with an untyped branch': {
      any: [{ type: codeRef }, { eq: { id: realm + 'missing' } }],
    },
    'an OR with a second positive type': {
      any: [
        { on: codeRef, range: { amount: { gt: 10 } } },
        {
          on: { module: rri(realm + 'different'), name: 'Different' },
          range: { amount: { gt: 10 } },
        },
      ],
    },
  })) {
    test(name + ' cannot hide an unsettled possible input', async (assert) => {
      const url = await materializedCard('unrelated', 2);
      const otherType = { module: rri(realm + 'different'), name: 'Different' };
      await db.execute('UPDATE boxel_index SET types=$2 WHERE url=$1', {
        bind: [
          url,
          JSON.stringify([internalKeyFor(otherType, undefined, network)]),
        ],
      });
      await db.execute(
        'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
        {
          bind: [url],
        },
      );
      await assert.rejects(
        (await open()).query('records', { filter, page: { size: 10 } }),
        /unsettled materialized inputs/,
      );
    });
  }

  test('a composite query rechecks dirty nonmatches before publication', async (assert) => {
    const url = await materializedCard('feeder', 2);
    const input = await open();
    const found = await input.query('large', {
      filter: {
        every: [
          { on: codeRef, eq: { group: 'A' } },
          { on: codeRef, range: { amount: { gt: 10 } } },
        ],
      },
      page: { size: 10 },
    });
    assert.strictEqual(found.cards.length, 0);
    const receipt = input.seal();
    await db.execute(
      'UPDATE lattice_owners SET dirty_generation=5 WHERE owner_url=$1',
      { bind: [url] },
    );
    await assert.rejects(
      publish(receipt.assertCurrent),
      /unsettled materialized inputs/,
    );
  });

  test('editing a query object during its read cannot change the persisted invalidation predicate', async (assert) => {
    await card('first', 1, 'A');
    await card('second', 2, 'B');
    const input = await open();
    const query = {
      filter: { on: codeRef, eq: { group: 'A' } },
      page: { size: 10 },
    };
    const pending = input.query('records', query);
    query.filter.eq.group = 'B';
    const result = await pending;
    assert.deepEqual(
      result.cards.map((c) => c.resource.attributes?.group),
      ['A'],
    );
    const check = input.seal();
    assert.deepEqual(check.watches[0].query.filter, {
      on: codeRef,
      eq: { group: 'A' },
    });
    await publish(check.assertCurrent);
  });

  test('a row growing after the size check is rejected before its larger body is transferred', async (assert) => {
    const url = await card('growing', 1);
    const execute = db.execute.bind(db);
    let changed = false;
    db.execute = async (sql, options) => {
      const rows = await execute(sql, options);
      if (!changed && sql.includes('AS owner_version')) {
        changed = true;
        await execute(
          "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,large}',to_jsonb(repeat('x',1048577))) WHERE url=$1",
          { bind: [url] },
        );
      }
      if (sql.includes('END AS body')) {
        assert.strictEqual(
          rows[0].body,
          null,
          'the changed document stays in PostgreSQL',
        );
      }
      return rows;
    };
    const input = await open();
    await assert.rejects(
      input.read([url]),
      (error: unknown) =>
        error instanceof LatticeInputsPending &&
        /changed during read/.test(error.message),
      'a concurrent publication withholds the frame without charging a computation failure',
    );
    assert.true(changed);
    assert.throws(() => input.seal(), /incomplete/);
  });

  test('failed or missing inputs cannot become confirmed empty values', async (assert) => {
    const url = await card('failed', 2);
    await db.execute('UPDATE boxel_index SET has_error=TRUE WHERE url=$1', {
      bind: [url],
    });
    const input = await open();
    await assert.rejects(
      input.query('records', { filter: { type: codeRef }, page: { size: 10 } }),
      /failed, future or oversized/,
    );
    assert.throws(() => input.seal(), /incomplete/);
    await assert.rejects(
      (await open()).read([realm + 'missing.json']),
      /Missing Lattice card input/,
    );
  });

  test('confirmed deleted links retain a revision receipt and strict reads remain strict', async (assert) => {
    const url = await card('deleted', 5);
    await db.execute(
      'UPDATE boxel_index SET is_deleted=TRUE,pristine_doc=NULL WHERE url=$1',
      {
        bind: [url],
      },
    );
    const frame = await open();
    statements.length = 0;
    assert.deepEqual(await frame.readLinks([url]), [
      { url, generation: 5, resource: null },
    ]);
    assert.false(
      statements.some((sql) => sql.includes('END AS body')),
      'no tombstone body is loaded',
    );
    const sealed = frame.seal();
    assert.deepEqual(
      sealed.identities,
      [url.slice(0, -5)],
      'restoration remains a dependency',
    );
    await publish(sealed.assertCurrent);

    const strict = await open();
    await strict.readLinks([url]);
    await assert.rejects(strict.read([url]), /failed, future or oversized/);
    assert.throws(
      () => strict.seal(),
      /incomplete/,
      'link tolerance cannot leak into required roots',
    );
    await db.execute('UPDATE boxel_index SET is_deleted=FALSE WHERE url=$1', {
      bind: [url],
    });
    await assert.rejects(
      publish(sealed.assertCurrent),
      /changed before publication/,
      'restoration invalidates a captured deletion even without a generation bump',
    );
  });

  test('projected link absence never disguises unknown, failed, future or foreign inputs', async (assert) => {
    const unknown = await open();
    await assert.rejects(
      unknown.readLinks([realm + 'unknown.json']),
      (error: unknown) => error instanceof LatticeUnknownLinkInput,
    );
    assert.throws(() => unknown.seal(), /incomplete/);
    await assert.rejects(
      (await open()).read([realm + 'unknown.json']),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Missing Lattice card input' &&
        !(error instanceof LatticeUnknownLinkInput),
      'strict root reads do not decline',
    );
    await assert.rejects(
      (await open()).readLinks(['https://foreign.example/one.json']),
      /canonical card URL/,
    );
    const url = await card('failed-link', 5);
    for (const state of [
      { deleted: false, failed: true, generation: 5 },
      { deleted: true, failed: true, generation: 5 },
      { deleted: true, failed: false, generation: 6 },
    ]) {
      await db.execute(
        'UPDATE boxel_index SET is_deleted=$2,has_error=$3,generation=$4 WHERE url=$1',
        {
          bind: [url, state.deleted, state.failed, state.generation],
        },
      );
      const frame = await open();
      await assert.rejects(
        frame.readLinks([url, realm + 'unknown.json']),
        state.generation > 5
          ? (error: unknown) => error instanceof LatticeInputsPending
          : /failed, future or oversized/,
        'an unknown target cannot disguise a failed or advanced input as decline',
      );
      assert.throws(() => frame.seal(), /incomplete/);
    }
  });

  test('deleted projected links still consume the input-card budget', async (assert) => {
    const url = await card('bounded-deleted', 1);
    await db.execute('UPDATE boxel_index SET is_deleted=TRUE WHERE url=$1', {
      bind: [url],
    });
    const oldLimit = LatticeMaterializationInputs.MAX_CARDS;
    LatticeMaterializationInputs.MAX_CARDS = 1;
    try {
      const frame = await open();
      await frame.readLinks([url]);
      await assert.rejects(
        frame.readLinks([realm + 'next.json']),
        /frame exceeds card bound/,
      );
      assert.throws(() => frame.seal(), /incomplete/);
    } finally {
      LatticeMaterializationInputs.MAX_CARDS = oldLimit;
    }
  });

  test('oversized data is rejected before its body reaches Node', async (assert) => {
    const url = await card('large', 1);
    await db.execute(
      // over LatticeMaterializationInputs.MAX_CARD_BYTES
      "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,large}',to_jsonb(repeat('x',4194305))) WHERE url=$1",
      { bind: [url] },
    );
    statements.length = 0;
    await assert.rejects((await open()).read([url]), /oversized/);
    assert.false(
      statements.some((s) => s.includes('END AS body')),
      'no body transfer',
    );
  });

  test('cross-realm and unbounded queries are rejected without widening input authority', async (assert) => {
    await assert.rejects(
      (await open()).query('records', {
        realm: 'https://other.example/',
        page: { size: 10 },
      }),
      /authorized realm/,
    );
    await assert.rejects((await open()).query('records', {}), /bounded page/);
    await assert.rejects(
      (await open()).read(['https://other.example/a.json']),
      /canonical card URL/,
    );
  });
});
