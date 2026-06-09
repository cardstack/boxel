import { module, test } from 'qunit';
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
  asExpressions,
  baseCardRef,
  insert,
  insertPermissions,
  param,
  query,
  rri,
  type Expression,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';
import type { PgAdapter } from '@cardstack/postgres';
import { stringify } from 'qs';
import { resetCatalogRealms } from '../../handlers/handle-fetch-catalog-realms';
import {
  closeServer,
  createVirtualNetwork,
  setupDB,
  matrixURL,
  realmSecretSeed,
  runTestRealmServerWithRealms,
} from '../helpers';
import { createJWT as createRealmServerJWT } from '../../utils/jwt';
import type { RealmHttpServer as Server } from '../../server';

module(`server-endpoints/${basename(__filename)}`, function (_hooks) {
  module('Realm Server Endpoints | /_federated-search', function (hooks) {
    let testRealm: Realm;
    let secondaryRealm: Realm;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let testRealmHttpServer: Server;

    let ownerUserId = '@mango:localhost';

    let realmFileSystem: Record<string, LooseSingleCardDocument> = {
      'test-card.json': {
        data: {
          type: 'card',
          attributes: {
            cardInfo: {
              name: 'Shared Card',
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('https://cardstack.com/base/card-api'),
              name: 'CardDef',
            },
          },
        },
      },
      'other-card.json': {
        data: {
          type: 'card',
          attributes: {
            cardInfo: {
              name: 'Other Card',
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('https://cardstack.com/base/card-api'),
              name: 'CardDef',
            },
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
      },
      afterEach: async () => {
        await stopSearchRealmServer();
      },
    });

    test('QUERY /_federated-search federates results across realms', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Shared Card',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let searchResponse = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url, secondaryRealm.url] });

      assert.strictEqual(searchResponse.status, 200, 'HTTP 200 status');
      let results = searchResponse.body;
      assert.strictEqual(
        results.data.length,
        2,
        'returns results from both realms',
      );
      assert.strictEqual(results.meta.page.total, 2, 'meta total is combined');
      let ids: string[] = results.data.map((entry: { id: string }) => entry.id);
      assert.deepEqual(
        ids,
        [`${testRealm.url}test-card`, `${secondaryRealm.url}test-card`],
        'results are ordered deterministically and exclude non-matching cards',
      );
    });

    test('QUERY /_federated-search supports query body', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Shared Card',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(response.body.data.length, 1, 'found one card');
    });

    // Verifies the per-batch search cache (CS-11115 Phase 2 + CS-11133
    // cross-realm expansion) hits at the HTTP handler boundary.
    // Counts populates by spying on each realm's `search` method —
    // a cache hit short-circuits before `searchRealms` reaches the
    // realm, so spy invocations are the unambiguous tell.
    test('QUERY /_federated-search caches cross-realm reads under one jobId and bypasses other jobs', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let primaryCalls = 0;
      let secondaryCalls = 0;
      // Capture the original prototype method references (unbound), so
      // the `finally` cleanup can `delete` the per-instance spy and
      // restore prototype lookup — assigning the bound wrapper back
      // would leave a permanent own-property masking the prototype.
      let primaryProto = testRealm.search;
      let secondaryProto = secondaryRealm.search;
      (testRealm as unknown as { search: typeof testRealm.search }).search =
        function (
          this: typeof testRealm,
          ...args: Parameters<typeof testRealm.search>
        ) {
          primaryCalls++;
          return primaryProto.apply(this, args);
        };
      (
        secondaryRealm as unknown as { search: typeof secondaryRealm.search }
      ).search = function (
        this: typeof secondaryRealm,
        ...args: Parameters<typeof secondaryRealm.search>
      ) {
        secondaryCalls++;
        return secondaryProto.apply(this, args);
      };

      try {
        let query: Query = {
          filter: {
            on: baseCardRef,
            eq: { cardTitle: 'Shared Card' },
          },
        };
        let searchURL = new URL('/_federated-search', testRealm.url);
        let post = (jobId: string) =>
          request
            .post(`${searchURL.pathname}${searchURL.search}`)
            .set('Accept', 'application/vnd.card+json')
            .set('Content-Type', 'application/json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${realmServerToken}`)
            .set('x-boxel-job-id', jobId)
            .set('x-boxel-consuming-realm', testRealm.url)
            .send({ ...query, realms: [testRealm.url, secondaryRealm.url] });

        let first = await post('42.1');
        assert.strictEqual(first.status, 200, 'first request: HTTP 200');
        assert.strictEqual(
          first.body.data.length,
          2,
          'first request returns both realms’ results',
        );
        assert.strictEqual(
          primaryCalls,
          1,
          'first request hit testRealm exactly once',
        );
        assert.strictEqual(
          secondaryCalls,
          1,
          'first request hit secondaryRealm exactly once',
        );

        let second = await post('42.1');
        assert.strictEqual(second.status, 200, 'second request: HTTP 200');
        assert.strictEqual(
          second.body.data.length,
          2,
          'second request returns the cached result',
        );
        assert.strictEqual(
          primaryCalls,
          1,
          'second request was a cache hit (testRealm not re-queried)',
        );
        assert.strictEqual(
          secondaryCalls,
          1,
          'second request was a cache hit (secondaryRealm not re-queried)',
        );

        // A different jobId is a different batch — fresh populate.
        let third = await post('43.1');
        assert.strictEqual(third.status, 200, 'third request: HTTP 200');
        assert.strictEqual(
          primaryCalls,
          2,
          'different jobId re-queried testRealm',
        );
        assert.strictEqual(
          secondaryCalls,
          2,
          'different jobId re-queried secondaryRealm',
        );
      } finally {
        delete (testRealm as unknown as { search?: unknown }).search;
        delete (secondaryRealm as unknown as { search?: unknown }).search;
      }
    });

    // The request members that change the response body fold into the
    // job-scoped cache key: the resolved prefer-HTML spec (only when the caller
    // explicitly asks to render), `dataOnly`, and a non-empty `cardUrls`. A
    // request differing on any of them gets a distinct entry + ETag; one that
    // matches an earlier key hits the cache. A plain query (no `render`) and an
    // empty `cardUrls` are the same live request and share an entry.
    test('QUERY /_federated-search cache key segregates entries by render / dataOnly / cardUrls', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let primaryCalls = 0;
      let primaryProto = testRealm.search;
      (testRealm as unknown as { search: typeof testRealm.search }).search =
        function (
          this: typeof testRealm,
          ...args: Parameters<typeof testRealm.search>
        ) {
          primaryCalls++;
          return primaryProto.apply(this, args);
        };

      try {
        let query: Query = {
          filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
        };
        let searchURL = new URL('/_federated-search', testRealm.url);
        let post = (body: Record<string, unknown>) =>
          request
            .post(`${searchURL.pathname}${searchURL.search}`)
            .set('Accept', 'application/vnd.card+json')
            .set('Content-Type', 'application/json')
            .set('X-HTTP-Method-Override', 'QUERY')
            .set('Authorization', `Bearer ${realmServerToken}`)
            .set('x-boxel-job-id', '42.1')
            .set('x-boxel-consuming-realm', testRealm.url)
            .send({ ...query, realms: [testRealm.url], ...body });

        let etags = new Set<string>();

        // 1. Plain query (no render) → the live document.
        let first = await post({});
        assert.strictEqual(first.status, 200, 'plain query: HTTP 200');
        assert.strictEqual(primaryCalls, 1, 'plain query populated');
        etags.add(first.headers['etag']);

        // 2. Identical plain query — same key → cache hit, same ETag.
        let firstRepeat = await post({});
        assert.strictEqual(
          primaryCalls,
          1,
          'identical plain query was a cache hit',
        );
        assert.strictEqual(
          firstRepeat.headers['etag'],
          first.headers['etag'],
          'identical request → identical ETag',
        );

        // 3. An empty `cardUrls` is a no-op filter and carries no render, so it
        // is the same live request as the plain query → cache hit, same ETag.
        let emptyCardUrls = await post({ cardUrls: [] });
        assert.strictEqual(
          primaryCalls,
          1,
          'empty cardUrls matched the plain-query key (cache hit)',
        );
        assert.strictEqual(
          emptyCardUrls.headers['etag'],
          first.headers['etag'],
          'empty cardUrls → same ETag as the plain query',
        );

        // 4. An explicit `render` is prefer-HTML — a different response body
        // from the live plain query — so it gets a distinct entry.
        let fitted = await post({ render: { format: 'fitted' } });
        assert.strictEqual(
          primaryCalls,
          2,
          'explicit render fired a fresh populate (distinct from the live entry)',
        );
        etags.add(fitted.headers['etag']);

        // 5. A different render.format → distinct entry.
        let embedded = await post({ render: { format: 'embedded' } });
        assert.strictEqual(
          primaryCalls,
          3,
          'different render.format fired a fresh populate',
        );
        etags.add(embedded.headers['etag']);

        // 6. A render.renderType → distinct entry.
        let withRenderType = await post({
          render: {
            format: 'fitted',
            renderType: { module: `${testRealm.url}author`, name: 'Author' },
          },
        });
        assert.strictEqual(
          primaryCalls,
          4,
          'different render.renderType fired a fresh populate',
        );
        etags.add(withRenderType.headers['etag']);

        // 7. `dataOnly` → distinct entry (live-only mode).
        let dataOnly = await post({ dataOnly: true });
        assert.strictEqual(primaryCalls, 5, 'dataOnly fired a fresh populate');
        etags.add(dataOnly.headers['etag']);

        // 8. A non-empty `cardUrls` → distinct entry.
        let withCardUrls = await post({
          cardUrls: [`${testRealm.url}test-card`],
        });
        assert.strictEqual(
          primaryCalls,
          6,
          'different cardUrls fired a fresh populate',
        );
        etags.add(withCardUrls.headers['etag']);

        assert.strictEqual(
          etags.size,
          6,
          'each distinct request shape produced a distinct ETag',
        );
      } finally {
        delete (testRealm as unknown as { search?: unknown }).search;
      }
    });

    // The centerpiece mixed-index test: index normally, then null the HTML for
    // one row so the index holds "some rows have HTML, some don't yet" — the
    // steady-state HTML-channel lag. A prefer-HTML search must emit a
    // `rendered-html` + identity-only `card` for the HTML row and a full live
    // `card` for the nulled row, all in one `data` array.
    test('QUERY /_federated-search prefer-HTML emits rendered-html + identity-only card for HTML rows and a full live card for HTML-absent rows', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
      let htmlUrl = `${testRealm.url}other-card`; // keeps its prerendered HTML
      let liveUrl = `${testRealm.url}test-card`; // HTML nulled → live fallback

      // Manufacture the mixed index by nulling the fitted HTML for one row. The
      // index `url` column is the instance's file URL (`.json`), so the WHERE
      // targets that even though results address the card by its identity URL.
      await query(dbAdapter, [
        `UPDATE boxel_index SET fitted_html = NULL WHERE url =`,
        param(`${liveUrl}.json`),
        `AND realm_url =`,
        param(testRealm.url),
      ] as Expression);

      let searchURL = new URL('/_federated-search', testRealm.url);
      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        // No filter → every card in the realm (both fixtures), so the response
        // spans an HTML-backed row and the HTML-nulled fallback row.
        .send({
          realms: [testRealm.url],
          render: { format: 'fitted' },
        });

      assert.strictEqual(response.status, 200, 'HTTP 200');
      let data = response.body.data as any[];
      let included = (response.body.included ?? []) as any[];
      let byId = new Map<string, any>(data.map((r) => [r.id, r]));

      assert.ok(byId.has(htmlUrl), 'the HTML-backed card is in data');
      assert.ok(byId.has(liveUrl), 'the HTML-absent card is in data');

      // HTML-backed row → identity-only card + rendered-html (+ its css).
      let htmlCard = byId.get(htmlUrl);
      assert.strictEqual(
        htmlCard.type,
        'card',
        'HTML row data entry is a card',
      );
      assert.notOk(
        htmlCard.attributes,
        'the HTML-backed card is identity-only (no attributes)',
      );
      assert.true(htmlCard.meta?.identityOnly, 'marked meta.identityOnly');
      assert.deepEqual(
        htmlCard.relationships?.['rendered-html']?.data,
        { type: 'rendered-html', id: htmlUrl },
        'the card links to its rendered-html by the shared id',
      );
      assert.strictEqual(
        htmlCard.links?.self,
        htmlUrl,
        'links.self is the hydration target',
      );

      let rendered = included.find(
        (r) => r.type === 'rendered-html' && r.id === htmlUrl,
      );
      assert.ok(rendered, 'a rendered-html for the HTML row rides in included');
      assert.strictEqual(
        typeof rendered.attributes.html,
        'string',
        'rendered-html carries an html string',
      );
      assert.ok(
        rendered.attributes.html.length > 0,
        'the prerendered html is non-empty',
      );

      // HTML-absent row → full live card, nothing in included for it.
      let liveCard = byId.get(liveUrl);
      assert.strictEqual(
        liveCard.type,
        'card',
        'live row data entry is a card',
      );
      assert.ok(
        liveCard.attributes,
        'the HTML-absent card is a full live card (attributes present)',
      );
      assert.notOk(
        liveCard.meta?.identityOnly,
        'the live fallback card is not identity-only',
      );
      assert.notOk(
        included.find((r) => r.type === 'rendered-html' && r.id === liveUrl),
        'no rendered-html is emitted for the live fallback row',
      );
    });

    test('QUERY /_federated-search dataOnly returns the live document, identical to a plain query', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
      let searchURL = new URL('/_federated-search', testRealm.url);
      let post = (body: Record<string, unknown>) =>
        request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .send({ realms: [testRealm.url], ...body });

      let plain = await post({});
      let dataOnly = await post({ dataOnly: true });
      assert.strictEqual(plain.status, 200, 'plain: HTTP 200');
      assert.strictEqual(dataOnly.status, 200, 'dataOnly: HTTP 200');
      assert.ok(
        (dataOnly.body.data as any[]).length > 0,
        'the realm returns results (the parity check is not vacuous)',
      );
      assert.deepEqual(
        dataOnly.body,
        plain.body,
        'dataOnly is byte-identical to a plain (no-render) live query',
      );
      assert.notOk(
        (dataOnly.body.included ?? []).some(
          (r: any) => r.type === 'rendered-html' || r.type === 'css',
        ),
        'dataOnly emits no rendered-html / css',
      );
      assert.ok(
        (dataOnly.body.data as any[]).every(
          (r) => r.type !== 'card' || r.attributes,
        ),
        'every dataOnly card is a full live card',
      );
    });

    test('QUERY /_federated-search emits an ETag on cacheable responses', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
      };
      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .set('x-boxel-job-id', '42.1')
        .set('x-boxel-consuming-realm', testRealm.url)
        .send({ ...query, realms: [testRealm.url, secondaryRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let etag = response.headers['etag'];
      assert.ok(etag, 'ETag header is present on cacheable responses');
      assert.ok(
        /^W\/"42\.1-[0-9a-f]+"$/.test(etag),
        `ETag is weak-form quoted "<jobId>-<digest>": ${etag}`,
      );
    });

    test('QUERY /_federated-search does not emit ETag on non-cacheable requests', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
      };
      let searchURL = new URL('/_federated-search', testRealm.url);

      // No x-boxel-job-id / x-boxel-consuming-realm — user-facing call.
      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.notOk(
        response.headers['etag'],
        'non-indexer callers do not see an ETag header',
      );
    });

    test('QUERY /_federated-search returns 304 when If-None-Match matches and cache is warm', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
      };
      let searchURL = new URL('/_federated-search', testRealm.url);
      let post = (opts: { ifNoneMatch?: string } = {}) => {
        let r = request
          .post(`${searchURL.pathname}${searchURL.search}`)
          .set('Accept', 'application/vnd.card+json')
          .set('Content-Type', 'application/json')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Authorization', `Bearer ${realmServerToken}`)
          .set('x-boxel-job-id', '42.1')
          .set('x-boxel-consuming-realm', testRealm.url);
        if (opts.ifNoneMatch) {
          r = r.set('If-None-Match', opts.ifNoneMatch);
        }
        return r.send({ ...query, realms: [testRealm.url] });
      };

      let primer = await post();
      assert.strictEqual(primer.status, 200, 'primer: HTTP 200');
      let etag = primer.headers['etag'];
      assert.ok(etag, 'primer carries an ETag');

      let revalidation = await post({ ifNoneMatch: etag });
      assert.strictEqual(
        revalidation.status,
        304,
        'matching If-None-Match returns 304 Not Modified',
      );
      assert.strictEqual(revalidation.text, '', '304 response has no body');
      assert.strictEqual(
        revalidation.headers['etag'],
        etag,
        '304 echoes the same ETag header',
      );
    });

    test('QUERY /_federated-search returns 200 fresh when If-None-Match is from a previous jobId', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
      };
      let searchURL = new URL('/_federated-search', testRealm.url);

      let priorBatch = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .set('x-boxel-job-id', '42.1')
        .set('x-boxel-consuming-realm', testRealm.url)
        .send({ ...query, realms: [testRealm.url] });
      let staleEtag = priorBatch.headers['etag'];
      assert.ok(staleEtag, 'prior batch carries an ETag');

      // New jobId — fresh entry. Caller mistakenly sends the old
      // batch's ETag. Expected: ignored, 200 with a fresh ETag.
      let nextBatch = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .set('x-boxel-job-id', '43.1')
        .set('x-boxel-consuming-realm', testRealm.url)
        .set('If-None-Match', staleEtag)
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(
        nextBatch.status,
        200,
        'stale ETag does not match → fresh body',
      );
      assert.notStrictEqual(
        nextBatch.headers['etag'],
        staleEtag,
        'fresh ETag for the new jobId',
      );
      assert.ok(nextBatch.body.data, 'body carries fresh search results');
    });

    test('QUERY /_federated-search ignores If-None-Match without job headers', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: { on: baseCardRef, eq: { cardTitle: 'Shared Card' } },
      };
      let searchURL = new URL('/_federated-search', testRealm.url);

      // Pretend to be a user-facing caller (no job headers) but try
      // to slip in an `If-None-Match`. Expected: bypassed entirely.
      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .set('If-None-Match', 'W/"anything-goes"')
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(
        response.status,
        200,
        'user-facing caller is served fresh, never 304',
      );
      assert.notOk(
        response.headers['etag'],
        'no ETag emitted to non-indexer callers',
      );
      assert.ok(response.body.data, 'response carries the body');
    });

    test('GET /_federated-search returns 400 for unsupported method', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Shared Card',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);
      searchURL.searchParams.append('realms', testRealm.url);
      searchURL.searchParams.set('query', stringify(query, { encode: false }));

      let response = await request
        .get(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Authorization', `Bearer ${realmServerToken}`);

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes('method must be QUERY'),
        'response explains unsupported method',
      );
    });

    test('QUERY /_federated-search returns 403 when user lacks read access', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: '@rando:localhost', sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.ok(
        response.body.errors?.[0]?.includes(testRealm.url),
        'response lists realms without access',
      );
    });

    test('QUERY /_federated-search returns 401 when unauthenticated user requests non-public realm', async function (assert) {
      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({ ...query, realms: [testRealm.url] });

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
      assert.ok(
        response.body.errors?.[0]?.includes(testRealm.url),
        'response lists realms requiring auth',
      );
    });

    test('QUERY /_federated-search returns 400 for invalid query', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );

      let searchURL = new URL('/_federated-search', testRealm.url);

      let response = await request
        .post(`${searchURL.pathname}${searchURL.search}`)
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ realms: [testRealm.url], invalid: 'query structure' });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
    });

    test('QUERY /_federated-search returns 404 when a realm URL is not in the registry', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: { cardTitle: 'Shared Card' },
        },
      };
      let unknownURL = 'http://127.0.0.1:4444/never-heard-of/';

      let response = await request
        .post('/_federated-search')
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...query, realms: [testRealm.url, unknownURL] });

      assert.strictEqual(response.status, 404, 'HTTP 404 status');
      assert.ok(
        response.body.errors?.[0]?.includes('Realms not found'),
        'response uses the "Realms not found" framing',
      );
      assert.ok(
        response.body.errors?.[0]?.includes(unknownURL),
        'response names the unknown URL',
      );
    });

    // Regression test for CS-11238. Under Phase 3 lazy-mount semantics
    // source realms live in realm_registry but only get pushed into
    // realms[] on first per-realm request. The middleware used to 404
    // federated requests for any URL not in realms[]; the fix
    // confirms registry presence and lets the handler lazy-mount on
    // demand. Inserting a registry row + permissions for a URL that
    // is NOT in realms[] models exactly that pre-first-hit state.
    //
    // We deliberately stop short of asserting the lazy-mount succeeds
    // end-to-end — the handler's lazy-mount may or may not produce a
    // usable Realm in this test fixture, and that's the handler's
    // concern. What this test pins down is the middleware contract:
    // a known-to-the-registry URL must not be rejected as "Realms not
    // found", and a non-readable / unknown URL is still rejected
    // upstream of the handler.
    test('QUERY /_federated-search does not 404 a registry-only (not-yet-mounted) realm (CS-11238)', async function (assert) {
      let realmServerToken = createRealmServerJWT(
        { user: ownerUserId, sessionRoom: 'session-room-test' },
        realmSecretSeed,
      );
      let registryOnlyURL = 'http://127.0.0.1:4444/registry-only/';

      // Seed: registry row + read permissions for ownerUserId. The
      // disk_id points at a directory the lazy-mount won't actually
      // be able to read — irrelevant here because we're asserting the
      // middleware's pre-handler verdict.
      let { nameExpressions, valueExpressions } = asExpressions({
        url: registryOnlyURL,
        kind: 'source',
        disk_id: 'registry-only-ghost',
        owner_username: 'mango',
        source_url: null,
        last_published_at: null,
        pinned: false,
      });
      await query(
        dbAdapter,
        insert('realm_registry', nameExpressions, valueExpressions),
      );
      await insertPermissions(dbAdapter, new URL(registryOnlyURL), {
        [ownerUserId]: ['read'],
      });

      let cardsQuery: Query = {
        filter: {
          on: baseCardRef,
          eq: { cardTitle: 'Shared Card' },
        },
      };

      let response = await request
        .post('/_federated-search')
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Authorization', `Bearer ${realmServerToken}`)
        .send({ ...cardsQuery, realms: [testRealm.url, registryOnlyURL] });

      assert.notStrictEqual(
        response.status,
        404,
        'registry-only realm is not rejected as "not found"',
      );
      let errorMessage: string =
        (response.body && Array.isArray(response.body.errors)
          ? response.body.errors.join(' ')
          : '') || '';
      assert.notOk(
        errorMessage.includes('Realms not found'),
        'response body does not carry the "Realms not found" error',
      );
    });

    test('QUERY /_federated-search returns 400 when realms param is missing', async function (assert) {
      let query: Query = {
        filter: {
          on: baseCardRef,
          eq: {
            cardTitle: 'Test Card',
          },
        },
      };

      let response = await request
        .post('/_federated-search')
        .set('Accept', 'application/vnd.card+json')
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send(query);

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.ok(
        response.body.errors?.[0]?.includes(
          'realms must be supplied in request body',
        ),
        'response explains missing realms in request body',
      );
    });
  });
});
