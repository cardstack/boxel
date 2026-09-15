import QUnit from 'qunit';
import { PgAdapter } from '@cardstack/postgres';
import {
  Deferred,
  param,
  query,
  rri,
  type LooseSingleCardDocument,
  type Querier,
} from '@cardstack/runtime-common';
import {
  captureLatticeRenderInput,
  withLatticeRenderAuthority,
} from '@cardstack/runtime-common/lattice-render-authority';
import { validateLatticeRenderCheckpoint } from '@cardstack/runtime-common/lattice-render-checkpoint';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realmURL = 'http://lattice-render.example/';
const id = `${realmURL}Day/one`;
const ownerURL = `${id}.json`;
const lock = `lattice:index:${realmURL}`;

function document(count = 7, generation = 2): LooseSingleCardDocument {
  return {
    data: {
      id,
      type: 'card',
      attributes: { count },
      meta: {
        adoptsFrom: { module: rri('../day'), name: 'Day' },
        publication: {
          version: 1,
          state: 'ready',
          computedFields: ['count'],
          queryFields: [],
          watches: [],
          validatedThrough: generation - 1,
          outputRevision: generation,
          definitionRevision: 'code-1',
        },
      },
    },
  };
}

module('Lattice | native render authority', function (hooks) {
  let db: PgAdapter;
  let jobId: number;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      await query(db, [
        'INSERT INTO realm_generations (realm_url, current_generation, loader_epoch) VALUES (',
        param(realmURL),
        ", 2, 'code-1')",
      ]);
      await query(db, [
        'INSERT INTO lattice_owners (realm_url, owner_url, published_generation, input_generation, definition_revision) VALUES (',
        param(realmURL),
        ',',
        param(ownerURL),
        ", 2, 1, 'code-1')",
      ]);
      await query(db, [
        'INSERT INTO boxel_index (url, file_alias, realm_url, type, generation, pristine_doc, is_deleted, has_error) VALUES (',
        param(ownerURL),
        ',',
        param(id),
        ',',
        param(realmURL),
        ", 'instance', 2,",
        param(JSON.stringify(document().data)),
        ', FALSE, FALSE)',
      ]);
      await query(db, [
        'INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation, isolated_html, is_deleted) VALUES (',
        param(ownerURL),
        ',',
        param(id),
        ',',
        param(realmURL),
        ", 'instance', 1, '<p>Previously published</p>', FALSE)",
      ]);
      let [job] = await query(db, [
        "INSERT INTO jobs (job_type, concurrency_group, priority, timeout, args) VALUES ('prerender_html',",
        param(`prerender-html:${realmURL}`),
        ", 1, 60, '{}') RETURNING id",
      ]);
      jobId = Number(job.id);
    },
  });

  async function capture() {
    let input = await captureLatticeRenderInput(db, realmURL, id);
    if (input.status !== 'ready')
      throw new Error(`Unexpected capture: ${input.status}`);
    let receipt = await validateLatticeRenderCheckpoint(input.checkpoint, {
      id,
      realmURL,
      loaderEpoch: input.authority.definitionRevision,
    });
    return { input, receipt };
  }

  async function commit(tx: Querier) {
    await tx([
      'UPDATE prerendered_html SET isolated_html =',
      param('<p>New publication</p>'),
      'WHERE url =',
      param(ownerURL),
    ]);
    await tx(["UPDATE jobs SET status = 'resolved' WHERE id =", param(jobId)]);
    return 'published';
  }

  async function state() {
    let [html] = await query(db, [
      'SELECT isolated_html FROM prerendered_html WHERE url =',
      param(ownerURL),
    ]);
    let [job] = await query(db, [
      'SELECT status FROM jobs WHERE id =',
      param(jobId),
    ]);
    return { html: html.isolated_html, job: job.status };
  }

  test('captures only published input and atomically commits the artifact and its pending work', async function (assert) {
    let { input, receipt } = await capture();
    assert.strictEqual(input.checkpoint.document.data.attributes?.count, 7);
    assert.strictEqual(input.authority.realmGeneration, 2);
    assert.deepEqual(
      await withLatticeRenderAuthority(db, input, receipt, commit),
      { published: true, value: 'published' },
    );
    assert.deepEqual(await state(), {
      html: '<p>New publication</p>',
      job: 'resolved',
    });
  });

  test('an input superseded during rendering leaves the previous HTML and durable job intact; retry captures current data', async function (assert) {
    let { input, receipt } = await capture();
    await db.withWriteLock(lock, async (tx) => {
      await tx!([
        'UPDATE realm_generations SET current_generation = 3 WHERE realm_url =',
        param(realmURL),
      ]);
      await tx!([
        'UPDATE lattice_owners SET published_generation = 3, input_generation = 2 WHERE owner_url =',
        param(ownerURL),
      ]);
      await tx!([
        'UPDATE boxel_index SET generation = 3, pristine_doc =',
        param(JSON.stringify(document(8, 3).data)),
        'WHERE url =',
        param(ownerURL),
      ]);
    });
    assert.deepEqual(
      await withLatticeRenderAuthority(db, input, receipt, commit),
      { published: false, reason: 'superseded' },
    );
    assert.deepEqual(await state(), {
      html: '<p>Previously published</p>',
      job: 'unfulfilled',
    });
    let retry = await capture();
    assert.strictEqual(
      retry.input.checkpoint.document.data.attributes?.count,
      8,
    );
    assert.true(
      (await withLatticeRenderAuthority(db, retry.input, retry.receipt, commit))
        .published,
    );
    assert.strictEqual((await state()).job, 'resolved');
  });

  test('source indexing, reverse matching and owner dirtiness each block capture and publication', async function (assert) {
    let { input, receipt } = await capture();
    for (let phase of ['source', 'matching', 'owner']) {
      if (phase === 'source')
        await query(db, [
          "INSERT INTO jobs (job_type, concurrency_group, priority, timeout, args) VALUES ('incremental-index',",
          param(`indexing:${realmURL}`),
          ", 1, 60, '{}')",
        ]);
      if (phase === 'matching')
        await query(db, [
          'INSERT INTO lattice_pending_generations (realm_url, generation, definition_revision) VALUES (',
          param(realmURL),
          ", 3, 'code-1')",
        ]);
      if (phase === 'owner')
        await query(db, [
          'UPDATE lattice_owners SET dirty_generation = 3 WHERE owner_url =',
          param(ownerURL),
        ]);
      assert.deepEqual(
        await captureLatticeRenderInput(db, realmURL, id),
        { status: 'pending' },
        `${phase} capture`,
      );
      assert.deepEqual(
        await withLatticeRenderAuthority(db, input, receipt, commit),
        { published: false, reason: 'pending' },
        `${phase} commit`,
      );
      if (phase === 'source')
        await query(db, [
          "UPDATE jobs SET status = 'resolved' WHERE concurrency_group =",
          param(`indexing:${realmURL}`),
        ]);
      if (phase === 'matching')
        await query(db, [
          'DELETE FROM lattice_pending_generations WHERE realm_url =',
          param(realmURL),
        ]);
      if (phase === 'owner')
        await query(db, [
          'UPDATE lattice_owners SET dirty_generation = NULL WHERE owner_url =',
          param(ownerURL),
        ]);
    }
    assert.deepEqual(await state(), {
      html: '<p>Previously published</p>',
      job: 'unfulfilled',
    });
  });

  test('a definition change and change-back cannot revive an old render; retired owners cannot publish', async function (assert) {
    let { input, receipt } = await capture();
    await query(db, [
      "UPDATE realm_generations SET current_generation = 3, loader_epoch = 'code-2' WHERE realm_url =",
      param(realmURL),
    ]);
    assert.deepEqual(
      await withLatticeRenderAuthority(db, input, receipt, commit),
      { published: false, reason: 'pending' },
    );
    await query(db, [
      "UPDATE realm_generations SET current_generation = 4, loader_epoch = 'code-1' WHERE realm_url =",
      param(realmURL),
    ]);
    assert.deepEqual(
      await withLatticeRenderAuthority(db, input, receipt, commit),
      { published: false, reason: 'superseded' },
    );
    await query(db, [
      'UPDATE lattice_owners SET retired = TRUE WHERE owner_url =',
      param(ownerURL),
    ]);
    assert.deepEqual(
      await withLatticeRenderAuthority(db, input, receipt, commit),
      { published: false, reason: 'retired' },
    );
    assert.deepEqual(await state(), {
      html: '<p>Previously published</p>',
      job: 'unfulfilled',
    });
  });

  test('changed render receipts and failed commit callbacks cannot publish or clear pending work', async function (assert) {
    let { input, receipt } = await capture();
    await assert.rejects(
      withLatticeRenderAuthority(
        db,
        input,
        { ...receipt, documentHash: 'changed' },
        commit,
      ),
      /did not consume/,
    );
    await assert.rejects(
      withLatticeRenderAuthority(db, input, receipt, async (tx) => {
        await commit(tx);
        throw new Error('crash before commit');
      }),
      /crash before commit/,
    );
    assert.deepEqual(await state(), {
      html: '<p>Previously published</p>',
      job: 'unfulfilled',
    });
  });

  test('a concurrent index writer cannot slip between validation and artifact commit', async function (assert) {
    let { input, receipt } = await capture();
    let other = new PgAdapter();
    let entered = new Deferred<void>(),
      release = new Deferred<void>();
    let order: string[] = [];
    let publishing = withLatticeRenderAuthority(
      db,
      input,
      receipt,
      async (tx) => {
        entered.fulfill();
        await release.promise;
        await commit(tx);
        order.push('artifact');
      },
    );
    await entered.promise;
    let updating = other.withWriteLock(lock, async (tx) => {
      order.push('index');
      await tx!([
        'UPDATE realm_generations SET current_generation = 3 WHERE realm_url =',
        param(realmURL),
      ]);
    });
    try {
      let blocked = false,
        deadline = Date.now() + 3000;
      while (!blocked && Date.now() < deadline) {
        let [row] = await query(db, [
          "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())) AS blocked",
        ]);
        blocked = row.blocked === true;
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.true(
        blocked,
        'Postgres reports the competing writer waiting on the lock',
      );
      release.fulfill();
      assert.true((await publishing).published);
      await updating;
      assert.deepEqual(order, ['artifact', 'index']);
    } finally {
      release.fulfill();
      await Promise.allSettled([publishing, updating]);
      await other.close();
    }
  });
});
