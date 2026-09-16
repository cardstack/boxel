import QUnit from 'qunit';
import { basename } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import { IndexWriter, VirtualNetwork } from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const { module, test } = QUnit;
const realm = 'https://index-resume.example/';
const names = ['source.gts', 'bridge.gts', 'dependent.json'];
const dependencies = [[], ['source'], ['bridge']];

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
    },
  });

  for (const completed of [[0], [1], [0, 1]]) {
    test(`resuming ${completed.map((i) => names[i]).join(' and ')} still visits unfinished dependents`, async function (assert) {
      for (const [i, name] of names.entries()) {
        await db.execute(
          `INSERT INTO boxel_index
            (url,file_alias,type,realm_url,generation,is_deleted,deps)
           VALUES ($1,$2,'file',$3,0,false,$4)`,
          {
            bind: [
              realm + name,
              realm + name.replace(/\.(gts|json)$/, ''),
              realm,
              JSON.stringify(dependencies[i].map((dep) => realm + dep)),
            ],
          },
        );
      }
      const writer = new IndexWriter(db);
      const network = new VirtualNetwork();
      const job = {
        jobId: 42,
        reservationId: 1,
        priority: 10,
        queueWaitMs: null,
      };
      const first = await writer.createBatch(new URL(realm), network, job);
      await first.invalidate([new URL(realm + names[0])]);
      assert.deepEqual(
        first.invalidations.sort(),
        names.map((n) => realm + n).sort(),
      );
      const entry = (i: number) => ({
        type: 'file' as const,
        lastModified: 1,
        resourceCreatedAt: 1,
        searchData: { title: `current ${names[i]}` },
        deps: new Set(dependencies[i].map((dep) => realm + dep)),
      });
      for (const i of completed) {
        await first.updateEntry(new URL(realm + names[i]), entry(i));
      }
      await first.flushWriteBuffer();
      // The first attempt stops before publication. Resume the same durable
      // job with a new reservation, exactly as after a worker replacement.
      const retry = await writer.createBatch(new URL(realm), network, {
        ...job,
        reservationId: 2,
      });
      assert.strictEqual(retry.resumedRows.size, completed.length);
      await retry.invalidate([new URL(realm + names[0])]);
      assert.deepEqual(
        retry.invalidations.sort(),
        names.map((name) => realm + name).sort(),
        'completed work does not hide unfinished downstream work',
      );
      for (const [i, name] of names.entries()) {
        const url = realm + name;
        if (retry.invalidations.includes(url) && !retry.resumedRows.has(url)) {
          await retry.updateEntry(new URL(url), entry(i));
        }
      }
      await retry.done();
      const rows = await db.execute(
        'SELECT url,is_deleted,search_doc FROM boxel_index WHERE realm_url=$1 ORDER BY url',
        { bind: [realm] },
      );
      assert.strictEqual(rows.length, names.length);
      for (const row of rows) {
        assert.false(Boolean(row.is_deleted), `${row.url} survives recovery`);
        assert.strictEqual(
          (row.search_doc as { title?: string } | null)?.title,
          `current ${String(row.url).slice(realm.length)}`,
          'all outputs are current after publication',
        );
      }
    });
  }
});
