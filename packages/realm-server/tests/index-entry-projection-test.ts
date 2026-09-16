import { basename } from 'path';
import QUnit from 'qunit';
const { module, test } = QUnit;
import type { PgAdapter } from '@cardstack/postgres';
import {
  CachingDefinitionLookup,
  IndexQueryEngine,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import { setupDB } from './helpers/index.ts';

const realmURL = 'https://json-reads.example/';
const cardURL = new URL('person.json', realmURL);
const aliasURL = new URL('person', realmURL);
const fileURL = new URL('photo.png', realmURL);
const largeValue = 'unused output '.repeat(80_000);
const screenshots = {
  card: {
    specHash: 'spec',
    objectKey: 'object',
    contentType: 'image/png',
    width: 320,
    height: 200,
    deviceScaleFactor: 1,
  },
};
const omittedHtml = {
  headHtml: null,
  atomHtml: null,
  embeddedHtml: null,
  fittedHtml: null,
  markdown: null,
};

module(basename(import.meta.filename), function (hooks) {
  let db: PgAdapter;
  let engine: IndexQueryEngine;
  setupDB(hooks, {
    beforeEach: async (adapter) => {
      db = adapter;
      let network = new VirtualNetwork();
      // These direct row reads never resolve definitions or prerender.
      let lookup = new CachingDefinitionLookup(
        db,
        undefined!,
        network,
        () => '',
      );
      engine = new IndexQueryEngine(db, lookup, network);
      for (let suffix of ['', '_working']) {
        for (let [url, alias, type] of [
          [cardURL.href, aliasURL.href, 'instance'],
          [fileURL.href, fileURL.href, 'file'],
        ]) {
          await db.execute(
            `INSERT INTO boxel_index${suffix}
              (url, file_alias, type, realm_url, generation, pristine_doc,
               search_doc, deps, types, display_names, icon_html,
               last_modified, resource_created_at, indexed_at)
             VALUES ($1, $2, $3, $4, 7, $5, $6, $7, $8, $9, $10, 12, 10, 15)`,
            {
              bind: [
                url,
                alias,
                type,
                realmURL,
                JSON.stringify({
                  id: alias,
                  type: type === 'file' ? 'file-meta' : 'card',
                  attributes: { name: 'Example' },
                  meta: {
                    adoptsFrom: { module: `${realmURL}person`, name: 'Person' },
                  },
                }),
                JSON.stringify(
                  type === 'file'
                    ? { width: 320, height: 200, contentType: 'image/png' }
                    : { cardTitle: 'Example', expandedGraph: largeValue },
                ),
                JSON.stringify([`${realmURL}person.gts`]),
                JSON.stringify([`${realmURL}person/Person`]),
                JSON.stringify(['Example']),
                largeValue,
              ],
            },
          );
          await db.execute(
            `INSERT INTO prerendered_html${suffix}
              (url, realm_url, type, file_alias, generation, isolated_html, head_html,
               atom_html, embedded_html, fitted_html, markdown, screenshots)
             VALUES ($1, $2, $3, $7, 7, $4::text, $4::text, $4::text, $5, $5, $4::text, $6)`,
            {
              bind: [
                url,
                realmURL,
                type,
                largeValue,
                JSON.stringify({ Person: largeValue }),
                JSON.stringify(screenshots),
                alias,
              ],
            },
          );
        }
      }
    },
  });

  for (let useWorkInProgressIndex of [false, true]) {
    test(`data-only instance and file reads preserve JSON metadata (working=${useWorkInProgressIndex})`, async function (assert) {
      let opts = { useWorkInProgressIndex };
      let full = await engine.getInstance(cardURL, opts);
      if (!full) {
        throw new Error('Expected fixture card');
      }
      let narrow = await engine.getInstance(aliasURL, {
        ...opts,
        dataOnly: true,
      });
      assert.ok(full?.isolatedHtml, 'fixture has large rendered output');
      assert.deepEqual(
        narrow,
        {
          ...full,
          ...omittedHtml,
          isolatedHtml: null,
          searchDoc: null,
        },
        'only unused fields differ; timestamps, dependencies and screenshots survive',
      );
      let batch = await engine.getInstances([cardURL, aliasURL, aliasURL], {
        ...opts,
        dataOnly: true,
      });
      assert.strictEqual(
        batch.size,
        2,
        'canonical and alias lookups are retained',
      );
      assert.deepEqual(batch.get(cardURL.href), narrow);
      assert.deepEqual(batch.get(aliasURL.href), narrow);

      let fullFile = await engine.getFile(fileURL, opts);
      if (!fullFile) {
        throw new Error('Expected fixture file');
      }
      let file = await engine.getFile(fileURL, { ...opts, dataOnly: true });
      assert.deepEqual(
        file,
        {
          ...fullFile,
          ...omittedHtml,
          isolatedHtml: null,
          iconHtml: null,
        },
        'file search attributes and screenshots survive',
      );
      assert.deepEqual(file?.searchDoc, {
        width: 320,
        height: 200,
        contentType: 'image/png',
      });
      assert.deepEqual(
        (
          await engine.getFiles([fileURL], {
            ...opts,
            dataOnly: true,
          })
        ).get(fileURL.href),
        file,
      );
      assert.ok(
        JSON.stringify(narrow).length < JSON.stringify(full).length / 100,
        'unused multi-megabyte fields do not enter the JSON assembly result',
      );
    });
  }

  test('error presentation and source/render error precedence are preserved', async function (assert) {
    for (let [sourceError, renderGeneration] of [
      [false, 7],
      [true, 7],
      [false, 6],
    ] as const) {
      await db.execute(
        `UPDATE boxel_index SET has_error = $1, error_doc = $2 WHERE url = $3`,
        {
          bind: [
            sourceError,
            sourceError ? JSON.stringify({ message: 'source failed' }) : null,
            cardURL.href,
          ],
        },
      );
      await db.execute(
        `UPDATE prerendered_html SET error_doc = $1, generation = $2 WHERE url = $3`,
        {
          bind: [
            JSON.stringify({ message: 'render failed' }),
            renderGeneration,
            cardURL.href,
          ],
        },
      );
      let full = await engine.getInstance(cardURL);
      if (!full) {
        throw new Error('Expected fixture card');
      }
      let narrow = await engine.getInstance(cardURL, { dataOnly: true });
      let expectedError = sourceError || renderGeneration === 7;
      assert.strictEqual(
        narrow?.type,
        expectedError ? 'instance-error' : 'instance',
      );
      assert.deepEqual(
        narrow,
        {
          ...full,
          ...omittedHtml,
          ...(!expectedError ? { isolatedHtml: null, searchDoc: null } : {}),
        },
        'current errors keep the last-known-good HTML, title and dependencies',
      );
      assert.deepEqual(
        (await engine.getInstances([aliasURL], { dataOnly: true })).get(
          aliasURL.href,
        ),
        narrow,
      );
    }
  });

  test('missing renderings, deleted rows and file errors retain their existing semantics', async function (assert) {
    await db.execute('DELETE FROM prerendered_html');
    let card = await engine.getInstance(cardURL, { dataOnly: true });
    assert.strictEqual(card?.type, 'instance');
    assert.strictEqual(card?.screenshots, null);
    assert.ok(await engine.getFile(fileURL, { dataOnly: true }));
    await db.execute(
      'UPDATE boxel_index SET has_error = TRUE WHERE type = $1',
      { bind: ['file'] },
    );
    assert.strictEqual(
      await engine.getFile(fileURL, { dataOnly: true }),
      undefined,
    );
    assert.strictEqual(
      (await engine.getFiles([fileURL], { dataOnly: true })).size,
      0,
    );
    await db.execute('UPDATE boxel_index SET is_deleted = TRUE');
    assert.strictEqual(
      await engine.getInstance(aliasURL, { dataOnly: true }),
      undefined,
    );
    assert.strictEqual(
      (await engine.getInstances([cardURL], { dataOnly: true })).size,
      0,
    );
    assert.strictEqual(
      await engine.getInstance(new URL('missing', realmURL), {
        dataOnly: true,
      }),
      undefined,
    );
  });
});
