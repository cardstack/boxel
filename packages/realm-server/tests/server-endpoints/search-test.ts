import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import type {
  LooseSingleCardDocument,
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  archiveRealm,
  baseCardRef,
  rri,
  query,
  param,
  type Expression,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms.ts';
import {
  closeServer,
  createVirtualNetwork,
  setupDB,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
} from '../helpers/index.ts';
import { createJWT as createRealmServerJWT } from '../../utils/jwt.ts';
import { settlePrerenderHtmlJobs } from '../helpers/indexing.ts';
import type { RealmHttpServer as Server } from '../../server.ts';

module(`server-endpoints/${basename(import.meta.filename)}`, function (_hooks) {
  module('Realm Server Endpoints | /_federated-search', function (hooks) {
    let testRealm: Realm;
    let secondaryRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let testRealmHttpServer: Server;

    let ownerUserId = '@mango:localhost';

    // Two Person instances per realm: per-realm css dedup is exercised
    // within each realm (two renderings share one stylesheet), and the
    // federated merge dedups the per-realm css/html/item resources by
    // `(type, id)` across the combined `included`.
    let realmFileSystem: Record<string, LooseSingleCardDocument | string> = {
      'person.gts': `
        import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";

        export class Person extends CardDef {
          @field firstName = contains(StringField);
          static fitted = class Fitted extends Component<typeof this> {
            <template>
              Fitted Card Person: <@fields.firstName/>

              <style scoped>
                .border {
                  border: 1px solid red;
                }
              </style>
            </template>
          }
        }
      `,
      'john.json': {
        data: {
          type: 'card',
          attributes: { firstName: 'John' },
          meta: {
            adoptsFrom: { module: rri('./person'), name: 'Person' },
          },
        },
      },
      'jane.json': {
        data: {
          type: 'card',
          attributes: { firstName: 'Jane' },
          meta: {
            adoptsFrom: { module: rri('./person'), name: 'Person' },
          },
        },
      },
    };

    async function startSearchRealmServer({
      dbAdapter,
      publisher,
      runner,
    }: {
      dbAdapter: PgAdapter;
      publisher: QueuePublisher;
      runner: QueueRunner;
    }) {
      let virtualNetwork = createVirtualNetwork();
      let dir = dirSync();
      let testRealmURL = new URL('http://127.0.0.1:4444/test/');
      let secondaryRealmURL = new URL('http://127.0.0.1:4444/secondary/');
      let result = await runTestRealmServerWithRealms({
        virtualNetwork,
        realmsRootPath: join(dir.name, 'realm_server_1'),
        realms: [
          {
            realmURL: testRealmURL,
            fileSystem: realmFileSystem,
            permissions: {
              [ownerUserId]: ['read', 'write', 'realm-owner'],
            },
          },
          {
            realmURL: secondaryRealmURL,
            fileSystem: realmFileSystem,
            permissions: {
              [ownerUserId]: ['read', 'write', 'realm-owner'],
            },
          },
        ],
        dbAdapter,
        publisher,
        runner,
        matrixURL,
      });

      testRealmHttpServer = result.testRealmHttpServer;
      request = supertest(result.testRealmHttpServer);
      testRealm = result.realms.find(
        (realm) => realm.url === testRealmURL.href,
      )!;
      secondaryRealm = result.realms.find(
        (realm) => realm.url === secondaryRealmURL.href,
      )!;
    }

    async function stopSearchRealmServer() {
      testRealm.unsubscribe();
      secondaryRealm.unsubscribe();
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, publisher, runner) => {
        dbAdapter = _dbAdapter;
        await startSearchRealmServer({
          dbAdapter,
          publisher,
          runner,
        });
        // The entries' html relationships read prerendered_html, which the
        // fire-and-forget prerender_html jobs populate after the index
        // passes complete — settle both realms' HTML channels first.
        await settlePrerenderHtmlJobs(dbAdapter, testRealm.url);
        await settlePrerenderHtmlJobs(dbAdapter, secondaryRealm.url);
      },
      afterEach: async () => {
        await stopSearchRealmServer();
      },
    });

    function ownerToken() {
      return createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
    }

    // Anchor on the base CardDef ref: each realm's Person adopts from its
    // own realm's module, so a realm-specific anchor would only match that
    // realm's instances.
    function personFilter() {
      return {
        'item.on': baseCardRef,
      };
    }

    function postSearch(body: Record<string, unknown>) {
      let searchURL = new URL('/_federated-search', testRealm.url);
      return request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${ownerToken()}`)
        .send(body);
    }

    test('QUERY /_federated-search federates entry results across realms', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      });
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let json = response.body;
      assert.strictEqual(json.meta.page.total, 4, 'meta total is combined');
      assert.deepEqual(
        json.meta.htmlQuery,
        { eq: { format: 'fitted' } },
        'the applied default htmlQuery is echoed once on the combined doc',
      );
      let ids: string[] = json.data.map((entry: { id: string }) => entry.id);
      assert.deepEqual(
        ids,
        [
          `${testRealm.url}jane`,
          `${testRealm.url}john`,
          `${secondaryRealm.url}jane`,
          `${secondaryRealm.url}john`,
        ],
        'entries from both realms in realm order',
      );
      for (let entry of json.data) {
        assert.strictEqual(
          entry.relationships.html.data.length,
          1,
          `${entry.id} carries its fitted rendering`,
        );
      }
      // included is deduped by (type, id): each realm's two renderings share
      // one css resource, and nothing appears twice in the combined doc
      let identities = json.included.map(
        (r: { type: string; id: string }) => `${r.type}|${r.id}`,
      );
      assert.deepEqual(
        identities,
        [...new Set(identities)],
        'no duplicate (type, id) in the merged included',
      );
      // a rendering's deps carry the full transitive scoped-CSS set, so
      // assert the sharing property rather than a count: two same-realm
      // renderings of the same type reference identical stylesheets, all of
      // which travel in included
      let htmlOf = (id: string) =>
        json.included.find(
          (r: { type: string; id: string }) => r.type === 'html' && r.id === id,
        );
      let janeHtml = htmlOf(json.data[0].relationships.html.data[0].id);
      let johnHtml = htmlOf(json.data[1].relationships.html.data[0].id);
      assert.deepEqual(
        janeHtml.relationships.styles.data,
        johnHtml.relationships.styles.data,
        'same-realm renderings of the same type share their stylesheets',
      );
      assert.true(janeHtml.relationships.styles.data.length > 0);
      let cssIds = new Set(
        json.included
          .filter((r: { type: string }) => r.type === 'css')
          .map((r: { id: string }) => r.id),
      );
      for (let { id } of janeHtml.relationships.styles.data) {
        assert.true(cssIds.has(id), `referenced stylesheet ${id} is included`);
      }
    });

    // A federated search payload that names an archived realm must not
    // return hits. The mechanism is the enumeration filter in
    // fetchUserPermissions: once a realm is archived, the requester has
    // no permission for it per the filtered enumeration, so the
    // multi-realm-authorization middleware short-circuits the request
    // with 403 before handle-search runs. The handler itself does no
    // extra work; this test pins the contract end-to-end so a refactor
    // of the enumeration layer can't silently weaken it.
    test('archived realms in a federated search payload are refused at the auth boundary', async function (assert) {
      await archiveRealm(dbAdapter, new URL(secondaryRealm.url));

      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      });
      assert.strictEqual(
        response.status,
        403,
        'a request including an archived realm is forbidden',
      );
      assert.ok(
        String(response.body?.errors?.[0] ?? response.text).includes(
          secondaryRealm.url,
        ),
        'the forbidden response names the archived realm',
      );

      let activeOnly = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url],
      });
      assert.strictEqual(
        activeOnly.status,
        200,
        'the same request restricted to the active realm succeeds',
      );
      assert.strictEqual(
        activeOnly.body.meta.page.total,
        2,
        'active realms continue to search normally',
      );
    });

    test('cardUrls narrows results across the federation', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
        cardUrls: [`${testRealm.url}john.json`],
      });
      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        response.body.data.map((entry: { id: string }) => entry.id),
        [`${testRealm.url}john`],
        'only the requested card across both realms',
      );
    });

    test('cache/ETag segregates by query, fields, and htmlQuery', async function (assert) {
      let post = (body: Record<string, unknown>) =>
        postSearch(body)
          .set('x-boxel-job-id', '42.1')
          .set('x-boxel-consuming-realm', testRealm.url);
      let baseBody = {
        filter: personFilter(),
        realms: [testRealm.url, secondaryRealm.url],
      };

      let first = await post(baseBody);
      assert.strictEqual(first.status, 200);
      let baseEtag = first.headers['etag'];
      assert.true(Boolean(baseEtag), 'cacheable request carries an ETag');

      let repeat = await post(baseBody);
      assert.strictEqual(
        repeat.headers['etag'],
        baseEtag,
        'identical request → identical ETag',
      );

      let revalidated = await post(baseBody).set('If-None-Match', baseEtag);
      assert.strictEqual(
        revalidated.status,
        304,
        'If-None-Match on a cached entry → 304',
      );

      let differentFields = await post({
        ...baseBody,
        fields: { entry: ['item'] },
      });
      assert.notStrictEqual(
        differentFields.headers['etag'],
        baseEtag,
        'a different fieldset → a different ETag',
      );

      let differentHtmlQuery = await post({
        ...baseBody,
        filter: {
          ...personFilter(),
          eq: { htmlQuery: { eq: { format: 'embedded' } } },
        },
      });
      assert.notStrictEqual(
        differentHtmlQuery.headers['etag'],
        baseEtag,
        'a different htmlQuery → a different ETag',
      );

      // an inert htmlQuery (fieldset without html) does not key the cache:
      // equivalent bodies share one entry + ETag
      let itemFields = { entry: ['item'] };
      let inertA = await post({ ...baseBody, fields: itemFields });
      let inertB = await post({
        ...baseBody,
        filter: {
          ...personFilter(),
          eq: { htmlQuery: { eq: { format: 'embedded' } } },
        },
        fields: itemFields,
      });
      assert.strictEqual(
        inertB.headers['etag'],
        inertA.headers['etag'],
        'an inert htmlQuery does not split equivalent responses',
      );

      let uncached = await postSearch(baseBody);
      assert.strictEqual(
        uncached.headers['etag'],
        undefined,
        'non-indexer traffic carries no ETag',
      );
    });

    test('entries and html renderings carry meta.generation on the wire', async function (assert) {
      let response = await postSearch({
        filter: personFilter(),
        realms: [testRealm.url],
      });
      assert.strictEqual(response.status, 200);
      let json = response.body;
      for (let entry of json.data) {
        let generation = entry.meta?.generation;
        assert.strictEqual(
          typeof generation,
          'number',
          `${entry.id} carries meta.generation`,
        );
        assert.ok(generation > 0, `${entry.id} generation is positive`);
      }
      let htmlResources = (json.included ?? []).filter(
        (resource: { type: string }) => resource.type === 'html',
      );
      assert.ok(htmlResources.length > 0, 'the default fieldset returns html');
      for (let html of htmlResources) {
        let generation = html.meta?.generation;
        assert.strictEqual(
          typeof generation,
          'number',
          `${html.id} carries meta.generation`,
        );
        assert.ok(generation > 0, `${html.id} generation is positive`);
      }
    });

    test('the _search ETag advances when either the index or the prerendered-HTML channel does', async function (assert) {
      let cacheable = (body: Record<string, unknown>) =>
        postSearch(body)
          .set('x-boxel-job-id', '77.1')
          .set('x-boxel-consuming-realm', testRealm.url);
      let body = { filter: personFilter(), realms: [testRealm.url] };
      let realmURL = new URL(testRealm.url).href;

      let base = (await cacheable(body)).headers['etag'];
      assert.true(Boolean(base), 'cacheable request carries an ETag');

      // Publish HTML at a higher generation than any existing row: the realm's
      // prerendered-HTML channel advances, so a cached 304 must not pin the
      // older result.
      await query(dbAdapter, [
        `INSERT INTO prerendered_html (url, file_alias, realm_url, type, generation) VALUES (`,
        param(`${testRealm.url}__gen_probe__`),
        `,`,
        param(`${testRealm.url}__gen_probe__`),
        `,`,
        param(realmURL),
        `,`,
        param('instance'),
        `,`,
        param(999999),
        `)`,
      ] as Expression);
      let afterHtml = (await cacheable(body)).headers['etag'];
      assert.notStrictEqual(
        afterHtml,
        base,
        'a newer prerendered-HTML generation → a new ETag',
      );

      // Advance the index channel: the realm's authoritative current generation.
      await query(dbAdapter, [
        `UPDATE realm_generations SET current_generation = 999999 WHERE realm_url =`,
        param(realmURL),
      ] as Expression);
      let afterIndex = (await cacheable(body)).headers['etag'];
      assert.notStrictEqual(
        afterIndex,
        afterHtml,
        'a newer index generation → a new ETag',
      );
    });

    test('page/realms bounds are not enforced server-side', async function (assert) {
      // The page-size and realms caps live at the card `@context` surface, not
      // the server — so the trusted host (and any other caller) can exceed
      // them. An oversized item-leg page runs as asked rather than 400ing.
      let response = await postSearch({
        filter: personFilter(),
        fields: { entry: ['item'] },
        realms: [testRealm.url, secondaryRealm.url],
        page: { size: 1000 },
      });
      assert.strictEqual(
        response.status,
        200,
        'an oversized item-leg page is not rejected server-side',
      );
      assert.strictEqual(
        response.body.meta.page.total,
        4,
        'all matching rows are returned',
      );
    });
  });
});
