import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import {
  rri,
  setSearchBoundsForTests,
  resetSearchBoundsForTests,
  type Realm,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from '../helpers/index.ts';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('Realm-specific Endpoints | _search', function (hooks) {
    let testRealm: Realm;
    let dbAdapter: PgAdapter;
    let request: SuperTest<Test>;
    let realmHref: string;
    let searchPath: string;
    let personKey: string;
    let johnId: string;
    let janeId: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      dbAdapter: PgAdapter;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      dbAdapter = args.dbAdapter;
      request = args.request;
      let realmURL = new URL(testRealm.url);
      realmHref = realmURL.href;
      searchPath = `${realmURL.pathname.replace(/\/$/, '')}/_search`;
      personKey = `${realmHref}person/Person`;
      johnId = `${realmHref}john`;
      janeId = `${realmHref}jane`;
    }

    setupPermissionedRealmCached(hooks, {
      realmURL: testRealmURLFor('test/'),
      permissions: { '*': ['read'] },
      fileSystem: {
        'person.gts': `
          import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                Fitted Card Person: <@fields.firstName/>
              </template>
            }
          }
        `,
        'john.json': {
          data: {
            attributes: { firstName: 'John' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        },
        'jane.json': {
          data: {
            attributes: { firstName: 'Jane' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        },
      },
      onRealmSetup,
    });

    function postSearch(body: Record<string, unknown>) {
      return request
        .post(searchPath)
        .set('Accept', 'application/vnd.card+json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send(body);
    }

    function personFilter(extraEq: Record<string, unknown> = {}) {
      return {
        'item.on': { module: `${realmHref}person`, name: 'Person' },
        ...(Object.keys(extraEq).length > 0 ? { eq: extraEq } : {}),
      };
    }

    test('default fieldset: html-backed entries with the default htmlQuery echoed', async function (assert) {
      let response = await postSearch({ filter: personFilter() });
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let json = response.body;
      assert.strictEqual(json.meta.page.total, 2);
      assert.deepEqual(
        json.meta.htmlQuery,
        { eq: { format: 'fitted' } },
        'the applied default htmlQuery is echoed once at the document level',
      );
      let htmlId = `${johnId}#fitted#${personKey}`;
      let entry = json.data.find((e: { id: string }) => e.id === johnId);
      assert.deepEqual(entry.relationships.html, {
        data: [{ type: 'html', id: htmlId }],
      });
      assert.strictEqual(entry.relationships.item, undefined);
      let html = json.included.find(
        (r: { type: string; id: string }) =>
          r.type === 'html' && r.id === htmlId,
      );
      assert.strictEqual(html.attributes.format, 'fitted');
      assert.deepEqual(html.attributes.renderType, {
        module: `${realmHref}person`,
        name: 'Person',
      });
      assert.true(
        html.attributes.html
          .replace(/\s+/g, ' ')
          .includes('Fitted Card Person: John'),
      );
    });

    test('a disjunctive htmlQuery returns several renderings per entry', async function (assert) {
      let response = await postSearch({
        filter: personFilter({
          htmlQuery: {
            any: [{ eq: { format: 'fitted' } }, { eq: { format: 'embedded' } }],
          },
        }),
      });
      assert.strictEqual(response.status, 200);
      let entry = response.body.data.find(
        (e: { id: string }) => e.id === johnId,
      );
      let ids = entry.relationships.html.data.map(
        (member: { id: string }) => member.id,
      );
      assert.deepEqual(
        [...ids].sort(),
        [
          `${johnId}#embedded#${personKey}`,
          `${johnId}#fitted#${personKey}`,
        ].sort(),
      );
      for (let id of ids) {
        assert.true(
          response.body.included.some(
            (r: { type: string; id: string }) =>
              r.type === 'html' && r.id === id,
          ),
          `rendering ${id} is included`,
        );
      }
    });

    test('fields[entry]=item: full serializations, htmlQuery inert', async function (assert) {
      let response = await postSearch({
        filter: personFilter({ htmlQuery: { eq: { format: 'embedded' } } }),
        fields: { entry: ['item'] },
      });
      assert.strictEqual(response.status, 200);
      let json = response.body;
      assert.strictEqual(
        json.meta.htmlQuery,
        undefined,
        'no echo when the html branch is not in play',
      );
      let entry = json.data.find((e: { id: string }) => e.id === johnId);
      assert.strictEqual(entry.relationships.html, undefined);
      assert.deepEqual(entry.relationships.item, {
        data: { type: 'card', id: johnId },
      });
      let item = json.included.find(
        (r: { type: string; id: string }) =>
          r.type === 'card' && r.id === johnId,
      );
      assert.strictEqual(item.attributes.firstName, 'John');
      assert.strictEqual(item.meta.sparseFields, undefined);
      assert.false(
        json.included.some((r: { type: string }) => r.type === 'html'),
      );
    });

    test('fields[entry]=item.<field>: sparse items carry meta.sparseFields', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        fields: { entry: ['item.firstName'] },
      });
      assert.strictEqual(response.status, 200);
      let item = response.body.included.find(
        (r: { type: string; id: string }) =>
          r.type === 'card' && r.id === johnId,
      );
      assert.deepEqual(item.attributes, { firstName: 'John' });
      assert.deepEqual(item.meta.sparseFields, ['firstName']);
    });

    test('fields[entry]=html,item: both branches on every entry', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        fields: { entry: ['html', 'item'] },
      });
      assert.strictEqual(response.status, 200);
      let entry = response.body.data.find(
        (e: { id: string }) => e.id === johnId,
      );
      assert.deepEqual(entry.relationships.html, {
        data: [{ type: 'html', id: `${johnId}#fitted#${personKey}` }],
      });
      assert.deepEqual(entry.relationships.item, {
        data: { type: 'card', id: johnId },
      });
    });

    test('mixed index: fallback per the fieldset', async function (assert) {
      // Renderings live on prerendered_html; clearing the column there makes
      // the rendering absent.
      await dbAdapter.execute(
        `UPDATE prerendered_html SET fitted_html = NULL WHERE url = '${janeId}.json'`,
      );
      // default mode: the fallback row carries item and omits html
      let response = await postSearch({ filter: personFilter() });
      let jane = response.body.data.find(
        (e: { id: string }) => e.id === janeId,
      );
      assert.strictEqual(jane.relationships.html, undefined);
      assert.deepEqual(jane.relationships.item, {
        data: { type: 'card', id: janeId },
      });
      // a pinned html branch keeps membership visible with an empty array
      let pinned = await postSearch({
        filter: personFilter(),
        fields: { entry: ['html'] },
      });
      let pinnedJane = pinned.body.data.find(
        (e: { id: string }) => e.id === janeId,
      );
      assert.deepEqual(
        pinnedJane.relationships.html,
        { data: [] },
        'matched, no rendering yet',
      );
      assert.strictEqual(pinnedJane.relationships.item, undefined);
    });

    test('rejects malformed requests', async function (assert) {
      let badHtmlQuery = await postSearch({
        filter: personFilter({ htmlQuery: { eq: {} } }),
      });
      assert.strictEqual(badHtmlQuery.status, 400);
      assert.true(
        badHtmlQuery.body.errors[0].message.includes('unconstrained'),
      );

      let badMember = await postSearch({ render: {} });
      assert.strictEqual(badMember.status, 400);
      assert.true(
        badMember.body.errors[0].message.includes('unknown member "render"'),
      );

      let get = await request
        .get(searchPath)
        .set('Accept', 'application/vnd.card+json');
      assert.strictEqual(get.status, 400);
      assert.true(get.body.errors[0].message.includes('method must be QUERY'));
    });

    test('the item-leg page size is capped server-side', async function (assert) {
      // The server enforces a hard page ceiling on the live item leg for every
      // caller (the card `@context` cap is a separate, lower client-side
      // limit). Lower the ceiling for the test so the two-card realm exercises
      // both branches.
      setSearchBoundsForTests({ serverMaxPageSize: 1 });
      try {
        // An explicit item-leg page over the ceiling is rejected.
        let over = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
          page: { size: 2 },
        });
        assert.strictEqual(
          over.status,
          400,
          'an over-ceiling item-leg page is rejected',
        );

        // An absent page is clamped to the ceiling; the true match count still
        // rides meta.page.total so a caller can paginate.
        let clamped = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
        });
        assert.strictEqual(clamped.status, 200);
        assert.strictEqual(
          clamped.body.data.length,
          1,
          'the returned page is clamped to the ceiling',
        );
        assert.strictEqual(
          clamped.body.meta.page.total,
          2,
          'the true match count is preserved',
        );
      } finally {
        resetSearchBoundsForTests();
      }
    });

    test('the prerendered (html) leg is exempt from the page ceiling', async function (assert) {
      // The ceiling bounds the live item leg only. The default/html fieldset is
      // the cheap precomputed path and runs as asked even below the ceiling.
      setSearchBoundsForTests({ serverMaxPageSize: 1 });
      try {
        let response = await postSearch({
          filter: personFilter(),
          page: { size: 2 },
        });
        assert.strictEqual(
          response.status,
          200,
          'an oversized html-leg page is not rejected',
        );
        assert.strictEqual(response.body.data.length, 2);
      } finally {
        resetSearchBoundsForTests();
      }
    });
  });
});
