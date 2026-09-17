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
import { LatticeWorkSuperseded } from '@cardstack/runtime-common/lattice-work';
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
  fields: { amount: 'number', group: 'string', id: 'string' },
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
      if (sql.includes('octet_length(i.pristine_doc::text) AS bytes'))
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

  test('a registered materialization without provenance cannot masquerade as an ordinary input', async (assert) => {
    const url = await materializedCard('feeder', 2);
    await db.execute(
      "UPDATE boxel_index SET pristine_doc=pristine_doc #- '{meta,publication}' WHERE url=$1",
      { bind: [url] },
    );
    await assert.rejects((await open()).read([url]), /has no provenance/);
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
    await assert.rejects(input.read([url]), /changed during read/);
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
        /failed, future or oversized/,
        'an unknown target cannot disguise the other input failure as decline',
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
