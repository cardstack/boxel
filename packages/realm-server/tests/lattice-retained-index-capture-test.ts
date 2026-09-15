import QUnit from 'qunit';
import type { PgAdapter } from '@cardstack/postgres';
import { param, type Querier } from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import {
  LatticeRetainedSnapshots,
  LATTICE_RETAINED_LINK_LIMIT,
  type LatticeIndexedSnapshotInput,
  type LatticeIndexedSnapshotCapture,
} from '@cardstack/runtime-common/lattice-retained-snapshots';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://retained-index.example/';
const ownerURL = realm + 'Dashboard/one';
const config = new LatticeRealmConfig([realm]);

module('Lattice | indexed retained capture', (hooks) => {
  let db: PgAdapter;
  let snapshots: LatticeRetainedSnapshots;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      snapshots = new LatticeRetainedSnapshots(config, (expr) =>
        db.withConnection((tx) => tx(expr)),
      );
    },
  });
  async function transaction(work: (tx: Querier) => Promise<void>) {
    await db.withConnection(async (tx) => {
      await tx(['BEGIN']);
      try {
        await work(tx);
        await tx(['COMMIT']);
      } catch (error) {
        await tx(['ROLLBACK']);
        throw error;
      }
    });
  }
  function event(
    inputs: LatticeIndexedSnapshotInput[],
    consumerGeneration = 6,
  ): LatticeIndexedSnapshotCapture {
    return {
      kind: 'capture-index',
      realmURL: realm,
      ownerURL,
      consumerGeneration,
      inputs,
    };
  }
  function link(input: LatticeIndexedSnapshotInput) {
    return {
      realmURL: realm,
      ownerURL: input.owner?.url ?? ownerURL,
      fieldPath: input.fieldPath,
      source: { realmURL: realm, url: input.sourceURL },
    };
  }
  async function source(
    name: string,
    generation = 5,
    amount = 7,
  ): Promise<LatticeIndexedSnapshotInput> {
    const sourceURL = realm + name;
    const [row] = await db.execute(
      `INSERT INTO boxel_index
      (realm_url,url,file_alias,type,generation,pristine_doc,is_deleted,has_error)
      VALUES ($1,$2,$2,'instance',$3,$4,FALSE,FALSE)
      ON CONFLICT (url,realm_url,type) DO UPDATE SET generation=EXCLUDED.generation,pristine_doc=EXCLUDED.pristine_doc
      RETURNING xmin::text || ':' || cmin::text || ':' || ctid::text AS version`,
      {
        bind: [
          realm,
          sourceURL + '.json',
          generation,
          JSON.stringify({
            id: './' + name,
            type: 'card',
            attributes: { amount, payload: 'source-only-content-'.repeat(100) },
            meta: { adoptsFrom: { module: './record', name: 'Record' } },
          }),
        ],
      },
    );
    return {
      fieldPath: 'records',
      sourceURL,
      rowVersion: String(row.version),
      indexGeneration: generation,
      validatedThrough: generation,
      definitionSeal: 'epoch-1',
    };
  }

  test('a bounded SQL batch copies complete bodies without returning them to Node', async (assert) => {
    const inputs: LatticeIndexedSnapshotInput[] = [];
    for (let i = 0; i < 200; i++) inputs.push(await source('Record/' + i));
    inputs.push({ ...inputs[0], fieldPath: 'other' });
    const calls: Array<{ expression: unknown; result: unknown }> = [];
    await transaction((tx) =>
      snapshots.recordChange(async (expression) => {
        const result = await tx(expression);
        calls.push({ expression, result });
        return result;
      }, event(inputs)),
    );
    assert.strictEqual(
      calls.length,
      7,
      'round trips are constant across 201 links',
    );
    assert.false(
      JSON.stringify(calls).includes('source-only-content'),
      'no input body is bound or returned by the capture adapter',
    );
    const [counts] = await db.execute(
      'SELECT (SELECT COUNT(*) FROM lattice_retained_snapshots) AS copies, (SELECT COUNT(*) FROM lattice_retained_bodies) AS bodies',
    );
    assert.strictEqual(Number(counts.copies), 201);
    assert.strictEqual(Number(counts.bodies), 200);
    const copy = (await snapshots.read({ link: link(inputs[0]) }))!;
    const [expected] = await db.execute(
      "SELECT jsonb_build_object('data', jsonb_set(pristine_doc,'{id}',to_jsonb($2::text)))::text AS document FROM boxel_index WHERE url=$1",
      { bind: [inputs[0].sourceURL + '.json', inputs[0].sourceURL] },
    );
    assert.strictEqual(
      copy.document,
      expected.document,
      'complete canonical source document, not a reduced projection',
    );
    await db.execute('DELETE FROM boxel_index');
    assert.strictEqual(
      (await snapshots.read({ link: link(inputs[0]) }))?.document,
      copy.document,
    );
  });

  test('disabled realms, empty input and opt-out execute no retention SQL', async (assert) => {
    const input = await source('Record/one');
    const noSQL: Querier = async () => {
      throw new Error('Unexpected SQL');
    };
    await new LatticeRetainedSnapshots(
      new LatticeRealmConfig(),
      noSQL,
    ).recordChange(noSQL, event([input]));
    await snapshots.recordChange(noSQL, event([]));
    await snapshots.recordChange(noSQL, event([{ ...input, snapshot: false }]));
    assert.ok(true);
  });

  test('nested owners share the bounded capture and their physical rows fence publication', async (assert) => {
    const parent = await source('Record/parent');
    const target = await source('Person/one');
    const nested = {
      ...target,
      fieldPath: 'person',
      owner: {
        url: parent.sourceURL,
        rowVersion: parent.rowVersion,
        indexGeneration: parent.indexGeneration,
      },
    };
    let calls = 0;
    await transaction((tx) =>
      snapshots.recordChange(
        async (expr) => {
          calls++;
          return tx(expr);
        },
        event([parent, nested]),
      ),
    );
    assert.strictEqual(
      calls,
      7,
      'nested owners add no per-owner or per-link SQL round trips',
    );
    assert.ok(await snapshots.read({ link: link(nested) }));
    assert.strictEqual(
      await snapshots.read({ link: { ...link(nested), ownerURL } }),
      undefined,
      'the nested field does not belong to the dashboard',
    );

    const changed = await source('Record/parent', 5, 9);
    await assert.rejects(
      transaction((tx) => snapshots.recordChange(tx, event([nested]))),
      /Retained input changed/,
    );
    await assert.rejects(
      transaction((tx) => snapshots.recordChange(tx, event([changed, nested]))),
      /Conflicting retained owner\/source receipts/,
    );
    await assert.rejects(
      transaction((tx) =>
        snapshots.recordChange(
          tx,
          event([
            {
              ...nested,
              owner: {
                ...nested.owner,
                url: 'https://foreign.example/Record/parent',
              },
            },
          ]),
        ),
      ),
      /outside its realm/,
    );
    await assert.rejects(
      transaction((tx) =>
        snapshots.recordChange(
          tx,
          event([
            { ...nested, owner: { ...nested.owner, indexGeneration: 7 } },
          ]),
        ),
      ),
      /owner is newer/,
    );
    assert.strictEqual(
      JSON.parse((await snapshots.read({ link: link(nested) }))!.document).data
        .attributes.amount,
      7,
      'rejected changes preserve the previously retained target',
    );
  });

  test('an owning relationship changed inside the publication transaction rejects its old receipt', async (assert) => {
    const target = await source('Person/one');
    await assert.rejects(
      transaction(async (tx) => {
        const [parent] = await tx([
          'INSERT INTO boxel_index(realm_url,url,file_alias,type,generation,pristine_doc,is_deleted,has_error) SELECT realm_url,',
          param(realm + 'Record/parent.json'),
          ',',
          param(realm + 'Record/parent.json'),
          ',type,generation,pristine_doc,FALSE,FALSE FROM boxel_index WHERE url=',
          param(target.sourceURL + '.json'),
          "RETURNING xmin::text || ':' || cmin::text || ':' || ctid::text AS receipt",
        ]);
        await tx([
          "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{relationships}','{}'::jsonb) WHERE url=",
          param(realm + 'Record/parent.json'),
        ]);
        await snapshots.recordChange(
          tx,
          event([
            {
              ...target,
              owner: {
                url: realm + 'Record/parent',
                rowVersion: String(parent.receipt),
                indexGeneration: 5,
              },
            },
          ]),
        );
      }),
      /Retained input changed/,
    );
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
  });

  test('newest plus pins, equal-version conflicts and consumer ordering match explicit capture', async (assert) => {
    const first = await source('Record/one');
    await transaction((tx) => snapshots.recordChange(tx, event([first])));
    const copy = (await snapshots.read({ link: link(first) }))!;
    await transaction((tx) =>
      snapshots.recordChange(tx, {
        kind: 'pin',
        link: link(first),
        consumerGeneration: 6,
        expected: copy.snapshot,
        pinned: true,
        note: 'Keep this',
      }),
    );
    const second = await source('Record/one', 6, 8);
    await transaction((tx) => snapshots.recordChange(tx, event([second], 7)));
    const third = await source('Record/one', 7, 9);
    await transaction((tx) => snapshots.recordChange(tx, event([third], 8)));
    assert.strictEqual(
      (await snapshots.read({ link: link(first), revision: 5 }))?.document,
      copy.document,
    );
    assert.strictEqual(
      await snapshots.read({ link: link(first), revision: 6 }),
      undefined,
    );
    assert.strictEqual(
      JSON.parse((await snapshots.read({ link: link(first) }))!.document).data
        .attributes.amount,
      9,
    );
    await assert.rejects(
      transaction((tx) => snapshots.recordChange(tx, event([third], 7))),
      /obsolete/,
    );
    const conflict = await source('Record/one', 7, 999);
    await assert.rejects(
      transaction((tx) => snapshots.recordChange(tx, event([conflict], 9))),
      /Conflicting/,
    );
    assert.strictEqual(
      JSON.parse((await snapshots.read({ link: link(first) }))!.document).data
        .attributes.amount,
      9,
    );
  });

  test('a stale physical receipt or inconsistent source receipt aborts the complete capture', async (assert) => {
    const one = await source('Record/one');
    const two = await source('Record/two');
    await source('Record/two', 5, 999);
    await assert.rejects(
      transaction((tx) => snapshots.recordChange(tx, event([one, two]))),
      /input changed/,
    );
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
    await assert.rejects(
      transaction((tx) =>
        snapshots.recordChange(
          tx,
          event([
            one,
            { ...one, fieldPath: 'other', definitionSeal: 'other-epoch' },
          ]),
        ),
      ),
      /Conflicting retained source/,
    );
    await assert.rejects(
      transaction((tx) =>
        snapshots.recordChange(
          tx,
          event([{ ...one, sourceURL: 'https://foreign.example/Record/one' }]),
        ),
      ),
      /outside its realm/,
    );
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
  });

  test('updates within one transaction are fenced even when xmin stays equal', async (assert) => {
    const input = await source('Record/one');
    await transaction(async (tx) => {
      const update = async (amount: number) =>
        (
          await tx([
            "UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,amount}',",
            param(String(amount)),
            '::jsonb) WHERE url=',
            param(input.sourceURL + '.json'),
            "RETURNING xmin::text || ':' || cmin::text || ':' || ctid::text AS version",
          ])
        )[0].version as string;
      const first = await update(8);
      const second = await update(9);
      assert.strictEqual(
        first.split(':')[0],
        second.split(':')[0],
        'xmin alone cannot distinguish these writes',
      );
      assert.notStrictEqual(first, second);
      await assert.rejects(
        snapshots.recordChange(tx, event([{ ...input, rowVersion: first }])),
        /input changed/,
      );
    });
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
  });

  test('oversized capture is rejected before SQL', async (assert) => {
    const input = await source('Record/one');
    const noSQL: Querier = async () => {
      throw new Error('Unexpected SQL');
    };
    await assert.rejects(
      snapshots.recordChange(
        noSQL,
        event(Array(LATTICE_RETAINED_LINK_LIMIT + 1).fill(input)),
      ),
      /exceeds link bound/,
    );
  });

  test('copy installation rolls back with the surrounding publication transaction', async (assert) => {
    const input = await source('Record/one');
    await assert.rejects(
      transaction(async (tx) => {
        await snapshots.recordChange(tx, event([input]));
        throw new Error('Later publication failed');
      }),
      /Later publication failed/,
    );
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_bodies'),
      [],
    );
    assert.deepEqual(
      await db.execute('SELECT digest FROM lattice_retained_snapshots'),
      [],
    );
  });
});
