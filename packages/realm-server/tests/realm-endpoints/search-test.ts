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
  connectionTenantsDuring,
  createJWT,
  definitionCacheReads,
  indexReads,
  realmConfigCardJSON,
  setupPermissionedRealmCached,
  testRealmURLFor,
} from '../helpers/index.ts';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset.ts';
import {
  setPolicySearchScopeSink,
  type PolicySearchScopeEvent,
} from '@cardstack/runtime-common/card-operations';
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

    test('the index reads a realm’s own search does are charged to that realm', async function (assert) {
      let { result: response, statements } = await connectionTenantsDuring(
        dbAdapter,
        () => postSearch({ filter: personFilter() }),
      );
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let reads = indexReads(statements);
      assert.true(reads.length > 0, 'the search read the index');
      assert.deepEqual(
        reads
          .map(({ tenant, shared }) => JSON.stringify({ tenant, shared }))
          .filter((r, i, all) => all.indexOf(r) === i),
        [JSON.stringify({ tenant: realmHref, shared: false })],
        'every index read is charged to the realm itself and held to its share',
      );
      let lookups = definitionCacheReads(statements);
      assert.true(lookups.length > 0, 'the search looked up card definitions');
      assert.deepEqual(
        lookups
          .map(({ tenant, shared }) => JSON.stringify({ tenant, shared }))
          .filter((r, i, all) => all.indexOf(r) === i),
        [JSON.stringify({ tenant: realmHref, shared: true })],
        'definition lookups, which searches of other realms share, are ordered as the realm but run as shared work',
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

    test('the item-leg page size is bounded server-side', async function (assert) {
      // The server bounds the live item leg for every caller, as a pair: a
      // request naming no page takes the default, and one naming a size is
      // honored up to the absolute maximum and clamped to it above. (The card
      // `@context` cap is a separate, lower client-side limit that still
      // rejects.) Lower both for the test so the two-card realm exercises every
      // branch.
      setSearchBoundsForTests({
        serverMaxPageSize: 1,
        serverAbsoluteMaxPageSize: 2,
      });
      try {
        // Naming no page takes the default; the true match count still rides
        // meta.page.total so a caller can paginate.
        let unpaged = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
        });
        assert.strictEqual(unpaged.status, 200);
        assert.strictEqual(
          unpaged.body.data.length,
          1,
          'a request naming no page gets the default',
        );
        assert.strictEqual(
          unpaged.body.meta.page.total,
          2,
          'the true match count is preserved',
        );

        // Naming a size above the default is the opt-in — honored, rather than
        // clamped back to the default.
        let optedIn = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
          page: { size: 2 },
        });
        assert.strictEqual(optedIn.status, 200);
        assert.strictEqual(
          optedIn.body.data.length,
          2,
          'a page above the default but within the maximum is honored',
        );

        // Above the absolute maximum it is clamped rather than rejected, so
        // every leg applying this bound agrees on the page.
        let over = await postSearch({
          filter: personFilter(),
          fields: { entry: ['item'] },
          page: { size: 5 },
        });
        assert.strictEqual(
          over.status,
          200,
          'an over-maximum item-leg page is clamped, not rejected',
        );
        assert.strictEqual(
          over.body.data.length,
          2,
          'clamped to the maximum, not to the default',
        );
        assert.strictEqual(
          over.body.meta.page.total,
          2,
          'and the true match count is still reported',
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

  // A realm's own search answers a verified user it doesn't let read it the
  // way a federated search does: with the rows their grants admit, and so
  // with none from a realm that names no policy, whose answer is the one a
  // realm gives when its policy grants them nothing.
  module(
    'Realm-specific Endpoints | _search by a caller who may not read the realm',
    function (hooks) {
      const OWNER = '@owner:localhost';
      const READER = '@reader:localhost';
      const STRANGER = '@stranger:localhost';

      let testRealm: Realm;
      let request: SuperTest<Test>;
      let realmHref: string;
      let realmPath: string;

      setupCatalogTestSubset(hooks);

      setupPermissionedRealmCached(hooks, {
        realmURL: testRealmURLFor('private-search/'),
        permissions: {
          [OWNER]: ['read', 'write', 'realm-owner'],
          [READER]: ['read'],
        },
        fileSystem: {
          'person.gts': `
            import { contains, field, CardDef } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";
            import { operation } from "@cardstack/base/operations";

            export class Person extends CardDef {
              @field firstName = contains(StringField);

              @operation static listPeople = {
                base: 'query',
                query: { filter: { type: () => Person } },
              };
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
        },
        onRealmSetup(args) {
          testRealm = args.testRealm;
          request = args.request;
          realmHref = new URL(testRealm.url).href;
          realmPath = new URL(testRealm.url).pathname;
        },
      });

      // The token carries the permissions the realm's ACL grants `user`, as
      // a session the realm issued would.
      function search(
        user?: string,
        permissions: ('read' | 'write')[] = [],
        body: Record<string, unknown> = {
          filter: {
            'item.on': { module: `${realmHref}person`, name: 'Person' },
          },
        },
      ) {
        let req = request
          .post(`${realmPath}_search`)
          .set('Accept', 'application/vnd.card+json')
          .set('X-HTTP-Method-Override', 'QUERY');
        if (user) {
          req = req.set(
            'Authorization',
            `Bearer ${createJWT(testRealm, user, permissions)}`,
          );
        }
        return req.send(body);
      }

      function namedSearch(
        user: string,
        query: { operation: string; on: { module: string; name: string } },
        permissions: ('read' | 'write')[] = [],
      ) {
        return search(user, permissions, query);
      }

      // Points the realm at a policy that lets anyone read a person they were
      // handed and grants no search at all.
      async function nameAPolicyGrantingNoSearch() {
        await testRealm.write(
          'policies/policy.json',
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                rules: [
                  {
                    targetType: { module: '../person', name: 'Person' },
                    grants: [{ operation: 'read' }],
                  },
                ],
              },
              meta: {
                adoptsFrom: {
                  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
                  name: 'RealmPolicy',
                },
              },
            },
          }),
        );
        await testRealm.write(
          'realm.json',
          realmConfigCardJSON({ policy: `${realmHref}policies/policy` }),
        );
        await testRealm.indexing();
      }

      test('a realm with no policy answers a verified non-reader with no rows, as a realm whose policy grants them nothing does', async function (assert) {
        let noPolicy = await search(STRANGER);
        assert.strictEqual(noPolicy.status, 200, 'HTTP 200 status');
        assert.deepEqual(noPolicy.body.data, [], 'no rows');
        assert.strictEqual(noPolicy.body.meta.page.total, 0);
        assert.deepEqual(
          noPolicy.body.meta.policyScopedRealms,
          [realmHref],
          'marked policy-scoped',
        );

        await nameAPolicyGrantingNoSearch();
        assert.deepEqual(
          await testRealm.getRealmPolicy(),
          { card: `${realmHref}policies/policy` },
          'the realm now names a policy',
        );
        let grantsNothing = await search(STRANGER);
        assert.strictEqual(grantsNothing.status, 200);
        assert.strictEqual(
          noPolicy.text,
          grantsNothing.text,
          'the two answers are byte for byte alike',
        );
      });

      test('a named query from a verified non-reader is answered with no rows without its declaration being read', async function (assert) {
        let person = { module: `${realmHref}person`, name: 'Person' };
        let declared = await namedSearch(STRANGER, {
          operation: 'listPeople',
          on: person,
        });
        assert.strictEqual(declared.status, 200, 'HTTP 200 status');
        assert.deepEqual(declared.body.data, [], 'no rows');
        assert.deepEqual(
          declared.body.meta.policyScopedRealms,
          [realmHref],
          'marked policy-scoped',
        );

        let undeclared = await namedSearch(STRANGER, {
          operation: 'everything',
          on: person,
        });
        assert.strictEqual(
          undeclared.text,
          declared.text,
          'an operation the type does not declare is answered byte for byte as the declared one is',
        );

        let missingType = await namedSearch(STRANGER, {
          operation: 'listPeople',
          on: { module: `${realmHref}no-such-module`, name: 'Nothing' },
        });
        assert.strictEqual(
          missingType.text,
          declared.text,
          'and so is a type the realm does not hold',
        );

        let reader = await namedSearch(
          READER,
          { operation: 'listPeople', on: person },
          ['read'],
        );
        assert.deepEqual(
          reader.body.data.map((entry: { id: string }) => entry.id),
          [`${realmHref}john`],
          'a reader is answered with the rows the declaration resolves to',
        );
      });

      test('a search of a realm with no policy records no policy consultation', async function (assert) {
        let person = { module: `${realmHref}person`, name: 'Person' };
        let recorded: PolicySearchScopeEvent[] = [];
        setPolicySearchScopeSink((event) => recorded.push(event));
        try {
          let adHoc = await search(STRANGER);
          let named = await namedSearch(STRANGER, {
            operation: 'listPeople',
            on: person,
          });
          assert.strictEqual(adHoc.status, 200);
          assert.strictEqual(named.status, 200);
          assert.deepEqual(
            recorded,
            [],
            'neither search records a policy-search-scope event',
          );

          await nameAPolicyGrantingNoSearch();
          let consulted = await search(STRANGER);
          assert.strictEqual(consulted.status, 200);
          assert.deepEqual(
            recorded.map((event) => event.realmURL),
            [realmHref],
            'the same search records one once the realm names a policy',
          );
        } finally {
          setPolicySearchScopeSink(undefined);
        }
      });

      test('a request that authenticated nobody is told to authenticate', async function (assert) {
        let response = await search();
        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('a reader gets the rows the realm holds', async function (assert) {
        let response = await search(READER, ['read']);
        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.deepEqual(
          response.body.data.map((entry: { id: string }) => entry.id),
          [`${realmHref}john`],
        );
        assert.strictEqual(
          response.body.meta.policyScopedRealms,
          undefined,
          'not marked policy-scoped',
        );
      });

      test('the card+json read still refuses a verified non-reader', async function (assert) {
        let response = await request
          .get(`${realmPath}john`)
          .set('Accept', 'application/vnd.card+json')
          .set('Authorization', `Bearer ${createJWT(testRealm, STRANGER)}`);
        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });
    },
  );
});
