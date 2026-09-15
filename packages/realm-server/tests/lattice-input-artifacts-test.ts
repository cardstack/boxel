import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import {
  IndexQueryEngine,
  IndexWriter,
  VirtualNetwork,
  param,
  rri,
  type DefinitionLookup,
  type InstanceEntry,
} from '@cardstack/runtime-common';
import { LatticeRealmConfig } from '@cardstack/runtime-common/lattice-config';
import {
  captureLatticeInputArtifacts,
  latticeInputArtifactReceipt,
} from '@cardstack/runtime-common/lattice-input-artifacts';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://lattice-artifacts.example/enabled/';
const ordinary = 'https://lattice-artifacts.example/ordinary/';

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let writer: IndexWriter;
  let engine: IndexQueryEngine;
  const network = new VirtualNetwork();
  const lookup = {
    async lookupDefinition() {
      throw new Error('Stored input reads must not execute definitions');
    },
  } as unknown as DefinitionLookup;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      writer = new IndexWriter(db, {
        lattice: new LatticeRealmConfig([realm]),
      });
      engine = new IndexQueryEngine(db, lookup, network);
    },
  });

  function entry(value: number, root = realm, name = 'card'): InstanceEntry {
    return {
      type: 'instance',
      lastModified: 1,
      resourceCreatedAt: 1,
      resource: {
        id: rri(root + name),
        type: 'card',
        attributes: { value },
        meta: { adoptsFrom: { module: rri(root + 'model'), name: 'Value' } },
      },
      searchData: { value },
      types: [root + 'model/Value'],
      displayNames: ['Value'],
      deps: new Set(),
    };
  }

  async function write(value: number, root = realm, name = 'card') {
    let batch = await writer.createBatch(new URL(root), network);
    await batch.updateEntry(
      new URL(root + name + '.json'),
      entry(value, root, name),
    );
    await batch.done();
  }

  async function read(token?: string, name = 'card') {
    let url = realm + name;
    return (
      await engine.getLatticeInputs(
        [new URL(url)],
        token ? new Map([[url, token]]) : new Map(),
        'authorized-test-context',
      )
    ).get(url);
  }

  async function artifacts() {
    return db.execute('SELECT * FROM lattice_input_artifacts ORDER BY url');
  }

  function value(result: Awaited<ReturnType<typeof read>>) {
    if (result?.entry.type !== 'instance')
      throw new Error('Expected a full input');
    return result.entry.instance.attributes?.value;
  }

  test('ordinary writes have no artifact trigger or capture; enabled publication is reusable', async (assert) => {
    let triggers = await db.execute(`
      SELECT t.tgname FROM pg_trigger t
      LEFT JOIN pg_constraint c ON c.oid=t.tgconstraint
      WHERE t.tgname='lattice_capture_input_artifact'
        OR c.conrelid='lattice_input_artifacts'::regclass`);
    assert.deepEqual(
      triggers,
      [],
      'neither capture nor foreign-key triggers run on ordinary writes',
    );
    await write(1, ordinary);
    assert.deepEqual(await artifacts(), [], 'off produces no derived artifact');
    await write(2);
    let first = await read();
    assert.strictEqual(value(first), 2);
    assert.ok(first?.token);
    assert.strictEqual((await read(first?.token))?.entry.type, 'lattice-reuse');
    assert.strictEqual((await artifacts()).length, 1);
    await write(3, ordinary);
    assert.strictEqual(
      (await read(first?.token))?.entry.type,
      'lattice-reuse',
      'ordinary realm work does not invalidate an unchanged input',
    );
  });

  test('an older writer cannot retain reuse by preserving generation and timestamps', async (assert) => {
    await write(1);
    let first = await read();
    let before = await artifacts();
    await db.execute(
      `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,value}','2') WHERE url=$1`,
      { bind: [realm + 'card.json'] },
    );
    assert.deepEqual(
      await artifacts(),
      before,
      'no trigger silently recaptures the old writer',
    );
    let changed = await read(first?.token);
    assert.strictEqual(value(changed), 2);
    assert.strictEqual(
      changed?.token,
      undefined,
      'stale receipt cannot advertise inventory',
    );
    await write(2);
    let repaired = await read();
    assert.ok(repaired?.token);
    assert.strictEqual(
      (await read(repaired?.token))?.entry.type,
      'lattice-reuse',
    );
  });

  test('a second update in one transaction invalidates the receipt and rollback restores the confirmed body', async (assert) => {
    await write(1);
    let first = await read();
    let before = await artifacts();
    await db.withConnection(async (tx) => {
      await tx(['BEGIN']);
      try {
        await tx([
          `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,value}','2') WHERE url=`,
          param(realm + 'card.json'),
        ]);
        await captureLatticeInputArtifacts(tx, realm, [realm + 'card.json']);
        let [captured] = await tx([
          `SELECT la.digest, (${latticeInputArtifactReceipt}) AS valid
          FROM boxel_index i JOIN lattice_input_artifacts la USING(realm_url,url,type)`,
        ]);
        assert.notEqual(
          captured.digest,
          before[0].digest,
          'capture and source write share the transaction',
        );
        await tx([
          `UPDATE boxel_index SET pristine_doc=jsonb_set(pristine_doc,'{attributes,value}','3') WHERE url=`,
          param(realm + 'card.json'),
        ]);
        let [second] = await tx([
          `SELECT la.row_xmin=i.xmin::text AS same_xmin,
          la.row_ctid=i.ctid::text AS same_ctid, (${latticeInputArtifactReceipt}) AS valid
          FROM boxel_index i JOIN lattice_input_artifacts la USING(realm_url,url,type)`,
        ]);
        assert.true(second.same_xmin);
        assert.false(second.same_ctid);
        assert.false(second.valid, 'same-transaction changes are also fenced');
      } finally {
        await tx(['ROLLBACK']);
      }
    });
    assert.deepEqual(await artifacts(), before);
    let restored = await read(first?.token);
    // PostgreSQL may change cmin's command-ID encoding on the original tuple
    // even when the update aborts. That physical change is a safe cache miss.
    // The old committed body and artifact must still be restored exactly.
    if (restored?.entry.type === 'lattice-reuse') {
      assert.strictEqual(restored.token, first?.token);
    } else {
      assert.strictEqual(value(restored), 1);
      assert.strictEqual(restored?.token, undefined);
    }
  });

  test('failure during writer capture rolls back the promoted source and generation', async (assert) => {
    await write(1);
    let first = await read();
    let before = await artifacts();
    let generation = await db.execute('SELECT * FROM realm_generations');
    await db.execute(
      `ALTER TABLE lattice_input_artifacts ADD CONSTRAINT reject_capture CHECK (realm_url <> '${realm}') NOT VALID`,
    );
    try {
      await assert.rejects(write(2), /reject_capture/);
      assert.strictEqual(value(await read()), 1);
      assert.deepEqual(await artifacts(), before);
      assert.deepEqual(
        await db.execute('SELECT * FROM realm_generations'),
        generation,
      );
      assert.strictEqual(
        (await read(first?.token))?.entry.type,
        'lattice-reuse',
      );
    } finally {
      await db.execute(
        'ALTER TABLE lattice_input_artifacts DROP CONSTRAINT reject_capture',
      );
    }
  });

  test('deletion and an index reset cannot inherit an old receipt at the same identity', async (assert) => {
    await write(1);
    let first = await read();
    await db.execute(
      'CREATE TABLE lattice_artifact_test_saved_index AS SELECT * FROM boxel_index',
    );
    try {
      await db.execute('TRUNCATE boxel_index');
      assert.strictEqual(await read(first?.token), undefined);
      assert.strictEqual(
        (await artifacts()).length,
        1,
        'an unvisited orphan is harmless without a matching source row',
      );
      await db.execute(
        'INSERT INTO boxel_index SELECT * FROM lattice_artifact_test_saved_index',
      );
      let restored = await read(first?.token);
      assert.strictEqual(value(restored), 1);
      assert.strictEqual(
        restored?.token,
        undefined,
        'even an identical restored body/generation needs a new receipt',
      );
      await write(1);
      let batch = await writer.createBatch(new URL(realm), network);
      await batch.invalidate([new URL(realm + 'card.json')]);
      await batch.done();
      assert.strictEqual(await read(first?.token), undefined);
      assert.deepEqual(
        await artifacts(),
        [],
        'enabled tombstone publication cleans up its artifact',
      );
    } finally {
      await db.execute('DROP TABLE lattice_artifact_test_saved_index');
    }
  });

  test('an index replacement in the capturing transaction cannot reuse the old table storage', async (assert) => {
    await write(1);
    let first = await read();
    await db.withConnection(async (tx) => {
      await tx(['BEGIN']);
      try {
        await tx([
          'CREATE TEMP TABLE reset_source ON COMMIT DROP AS SELECT * FROM boxel_index',
        ]);
        await tx(['TRUNCATE boxel_index']);
        await tx(['INSERT INTO boxel_index SELECT * FROM reset_source']);
        await captureLatticeInputArtifacts(tx, realm, [realm + 'card.json']);
        await tx([
          `UPDATE reset_source SET pristine_doc=jsonb_set(pristine_doc,'{attributes,value}','2')`,
        ]);
        await tx(['TRUNCATE boxel_index']);
        await tx(['INSERT INTO boxel_index SELECT * FROM reset_source']);
        let [row] = await tx([
          `SELECT la.row_xmin=i.xmin::text AS same_xmin,
          la.row_ctid=i.ctid::text AS same_ctid FROM boxel_index i
          JOIN lattice_input_artifacts la USING(realm_url,url,type)`,
        ]);
        assert.true(row.same_xmin, 'the transaction ID was reused');
        assert.true(
          row.same_ctid,
          'the replacement occupies the same tuple position',
        );
        await tx(['COMMIT']);
      } catch (error) {
        await tx(['ROLLBACK']);
        throw error;
      }
    });
    let replaced = await read(first?.token);
    assert.strictEqual(
      replaced?.entry.type,
      'instance',
      'storage replacement invalidates reuse',
    );
    if (replaced?.entry.type === 'instance')
      assert.strictEqual(value(replaced), 2);
    assert.strictEqual(replaced?.token, undefined);
  });

  test('legacy, expired and future receipts require full input reads', async (assert) => {
    for (let captured of ['NULL', '-1000000001', '99999999999999999999']) {
      await write(1);
      let first = await read();
      await db.execute(
        `UPDATE lattice_input_artifacts SET captured_xid=${captured === 'NULL' ? 'NULL' : `'${captured}'`}`,
      );
      let loaded = await read(first?.token);
      assert.strictEqual(value(loaded), 1, captured);
      assert.strictEqual(loaded?.token, undefined, captured);
    }
  });

  test('unchanged card identities retain their receipts across other enabled writes', async (assert) => {
    await write(1);
    let first = await read();
    let before = (await artifacts())[0];
    await write(2, realm, 'other');
    assert.deepEqual(
      (await artifacts()).find((row) => row.url === realm + 'card.json'),
      before,
    );
    assert.strictEqual((await read(first?.token))?.entry.type, 'lattice-reuse');
  });
});
