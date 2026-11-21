import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';

import { SupportedMimeType } from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  createJWT,
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

const OWNER = '@owner:localhost';

module(basename(import.meta.filename), function () {
  // A card computing over a linked JSON Lines log, the way a social app's network
  // card totals its reactions. Its render reads the log through the realm's
  // file meta, not the log's extract, so the count has to be there whichever
  // pass renders the card: the one that indexes the log, a later one that
  // re-indexes the card alone, and one where the index holds no usable row
  // for the log and the realm answers from the file on disk.
  module('a card that totals a linked JSON Lines log', function (hooks) {
    let realm: Realm;
    let request: RealmRequest;
    let dbAdapter: PgAdapter;

    function trackerSource(label: string) {
      return JSON.stringify({
        data: {
          attributes: { label },
          relationships: { log: { links: { self: '../events.jsonl' } } },
          meta: { adoptsFrom: { module: '../totals', name: 'Totals' } },
        },
      });
    }

    setupPermissionedRealmCached(hooks, {
      permissions: {
        [OWNER]: ['read', 'write', 'realm-owner'],
        '*': ['read'],
      },
      fileSystem: {
        'totals.gts': `
          import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
          import NumberField from "@cardstack/base/number";
          import StringField from "@cardstack/base/string";
          import { JSONLFile } from "@cardstack/base/jsonl-file-def";
          export class Totals extends CardDef {
            @field label = contains(StringField);
            @field log = linksTo(JSONLFile);
            @field total = contains(NumberField, {
              computeVia: function (this: Totals) {
                return (this.log as { lineCount?: number } | undefined)?.lineCount ?? 0;
              },
            });
            static isolated = class extends Component<typeof this> {
              <template><p><@fields.total /></p></template>
            }
          }
        `,
        'events.jsonl': '{"n":1}\n{"n":2}\n{"n":3}\n',
        'Totals/1.json': trackerSource('first'),
      },
      onRealmSetup(args) {
        realm = args.testRealm;
        dbAdapter = args.dbAdapter;
        request = withRealmPath(args.request, new URL(realm.url));
      },
    });

    async function append(line: string) {
      let response = await (request as unknown as SuperTest<Test>)
        .post('/_operations')
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .set(
          'Authorization',
          `Bearer ${createJWT(realm, OWNER, ['read', 'write', 'realm-owner'])}`,
        )
        .send(
          JSON.stringify({
            'boxel:operations': [
              {
                op: 'invoke',
                'boxel:name': 'appendLine',
                href: 'events.jsonl',
                data: { line },
              },
            ],
          }),
        );
      return response.status;
    }

    async function total(): Promise<unknown> {
      let response = await (request as unknown as SuperTest<Test>)
        .get('/Totals/1')
        .set('Accept', 'application/vnd.card+json');
      return response.body?.data?.attributes?.total;
    }

    // The card's own indexed value, which is what a re-index of the card
    // alone rewrites.
    async function indexedTotal(): Promise<unknown> {
      let [row] = (await dbAdapter.execute(
        `SELECT search_doc->'total' AS n FROM boxel_index WHERE url LIKE '%/Totals/1.json' AND type = 'instance'`,
      )) as { n: unknown }[];
      return row?.n;
    }

    async function reindexCardAlone(label: string) {
      await realm.write('Totals/1.json', trackerSource(label));
      await realm.indexing();
    }

    test('the card and the log indexed in the same pass', async function (assert) {
      await realm.indexing();
      assert.strictEqual(
        await total(),
        3,
        'the lines the log was written with',
      );
      assert.strictEqual(await indexedTotal(), 3, "the card's row agrees");

      assert.strictEqual(await append('{"n":4}'), 200);
      await realm.indexing();
      assert.strictEqual(await total(), 4, 'the append and the card, one pass');
      assert.strictEqual(await indexedTotal(), 4, "the card's row agrees");
    });

    test('the card re-indexed alone after the log', async function (assert) {
      await realm.indexing();
      assert.strictEqual(await append('{"n":4}'), 200);
      assert.strictEqual(await append('{"n":5}'), 200);
      await realm.indexing();

      await reindexCardAlone('second');
      assert.strictEqual(await total(), 5, 'the card alone reads the count');
      assert.strictEqual(await indexedTotal(), 5, "the card's row agrees");
    });

    // An errored row is not served, so the realm answers the log's file meta
    // from the file on disk, which carried no line count.
    async function errorTheLogRow() {
      await realm.indexing();
      assertAppended(await append('{"n":4}'));
      await realm.indexing();
      await dbAdapter.execute(
        `UPDATE boxel_index SET has_error = TRUE, error_doc = '{"message":"injected"}'::jsonb WHERE url LIKE '%/events.jsonl' AND type = 'file'`,
      );
    }
    function assertAppended(status: number) {
      if (status !== 200) {
        throw new Error(`append answered ${status}`);
      }
    }

    test("the log's file meta from disk counts its lines while its row is unusable", async function (assert) {
      await errorTheLogRow();
      let response = await (request as unknown as SuperTest<Test>)
        .get('/events.jsonl')
        .set('Accept', SupportedMimeType.FileMeta);
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.body?.data?.attributes?.lineCount,
        4,
        "the file meta from disk counts the log's lines",
      );
    });
  });
});
