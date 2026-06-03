import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import supertest from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import {
  existsSync,
  ensureDirSync,
  copySync,
  pathExistsSync,
  readJsonSync,
  writeJsonSync,
  removeSync,
} from 'fs-extra';
import { basename, join } from 'path';
import type { RealmHttpServer as Server } from '../server';
import { dirSync, type DirResult } from 'tmp';
import type { Realm, VirtualNetwork } from '@cardstack/runtime-common';
import {
  DEFAULT_PERMISSIONS,
  type QueuePublisher,
  type QueueRunner,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupDB,
  setupPermissionedRealmCached,
  runTestRealmServer,
  closeServer,
  createVirtualNetwork,
  fixtureDir,
  realmSecretSeed,
  grafanaSecret,
  matrixURL,
  waitUntil,
} from './helpers';
import { createJWT as createRealmServerJWT } from '../utils/jwt';

const testRealm2URL = 'http://127.0.0.1:4445/test/';

module(basename(__filename), function () {
  module('publish and unpublish realm tests', function (hooks) {
    let testRealmHttpServer: Server;
    let testRealm: Realm;
    let testRealmServer: Awaited<
      ReturnType<typeof runTestRealmServer>
    >['testRealmServer'];
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let request: SuperTest<Test>;
    let testRealmDir: string;
    let virtualNetwork: VirtualNetwork;
    let ownerUserId = '@mango:localhost';

    let dir: DirResult;

    setupPermissionedRealmCached(hooks, {
      fixture: 'simple',
      permissions: {
        '*': ['read', 'write'],
      },
      onRealmSetup: async () => {},
    });

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(fixtureDir('simple'), dir.name);
    });

    async function startRealmServer(
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) {
      virtualNetwork = createVirtualNetwork();
      ({
        testRealm: testRealm,
        testRealmServer: testRealmServer,
        testRealmHttpServer: testRealmHttpServer,
      } = await runTestRealmServer({
        virtualNetwork,
        testRealmDir,
        realmsRootPath: join(dir.name, 'realm_server_3'),
        realmURL: new URL(testRealm2URL),
        dbAdapter,
        publisher,
        runner,
        matrixURL,
        permissions: {
          '*': ['read', 'write'],
          [ownerUserId]: DEFAULT_PERMISSIONS,
        },
        domainsForPublishedRealms: {
          boxelSpace: 'localhost',
          boxelSite: 'localhost:4445',
        },
      }));
      request = supertest(testRealmHttpServer);
    }

    setupDB(hooks, {
      beforeEach: async (_dbAdapter, _publisher, _runner) => {
        dbAdapter = _dbAdapter;
        publisher = _publisher;
        runner = _runner;
        testRealmDir = join(dir.name, 'realm_server_3', 'test');
        ensureDirSync(testRealmDir);
        copySync(fixtureDir('simple'), testRealmDir);
        await startRealmServer(dbAdapter, publisher, runner);
      },
      afterEach: async () => {
        await closeServer(testRealmHttpServer);
      },
    });

    test('POST /_publish-realm cannot publish a realm that is not publishable', async function (assert) {
      let response = await request
        .post('/_publish-realm')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .set(
          'Authorization',
          `Bearer ${createRealmServerJWT(
            { user: ownerUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        )
        .send(
          JSON.stringify({
            sourceRealmURL: testRealm.url,
            publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
          }),
        );

      assert.strictEqual(response.status, 422, 'HTTP 422 status');
      assert.strictEqual(
        response.text,
        `{"errors":["Realm ${testRealm.url} is not publishable"]}`,
        'Error message says realm is not publishable',
      );

      let publishedDir = join(dir.name, 'realm_server_3', '_published');
      assert.false(pathExistsSync(publishedDir));
    });

    module('with a publishable source realm', function (hooks) {
      let sourceRealmUrlString: string;

      hooks.beforeEach(async () => {
        let endpoint = `test-realm-${uuidv4()}`;
        let createSourceRealmResponse = await request
          .post('/_create-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              data: {
                type: 'realm',
                attributes: {
                  name: 'Test Realm',
                  endpoint,
                },
              },
            }),
          );

        sourceRealmUrlString = createSourceRealmResponse.body.data.id;

        // Make the published realm public so reading _info doesn’t need a token
        await dbAdapter.execute(`
          INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
          VALUES ('${sourceRealmUrlString}', '*', true, true, true)
        `);
      });

      test('POST /_publish-realm can publish realm successfully', async function (assert) {
        let response = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );

        assert.strictEqual(response.status, 202, 'HTTP 202 status');
        assert.strictEqual(response.body.data.type, 'published_realm');
        assert.ok(response.body.data.id, 'published realm has an ID');
        assert.strictEqual(
          response.body.data.attributes.sourceRealmURL,
          sourceRealmUrlString,
          'source realm URL is correct',
        );
        assert.ok(
          response.body.data.attributes.publishedRealmURL,
          'published realm URL is present',
        );
        assert.ok(
          response.body.data.attributes.lastPublishedAt,
          'last published at timestamp is present',
        );
        assert.strictEqual(
          response.body.data.attributes.status,
          'pending',
          'status is pending — client should poll _readiness-check',
        );

        // Phase 3: publish only writes registry + NOTIFY + enqueues
        // an indexing job. Drive a reconcile pass to mount the new
        // published realm, then wait for the from-scratch-index job
        // to populate boxel_index before asserting on it below.
        let publishedRealmURLEarly =
          response.body.data.attributes.publishedRealmURL;
        await testRealmServer.testingOnlyReconcile();
        await waitUntil(
          async () => {
            let rows = await dbAdapter.execute(
              `SELECT 1 FROM boxel_index WHERE realm_url = $1 LIMIT 1`,
              { bind: [publishedRealmURLEarly] },
            );
            return rows.length > 0 ? rows : undefined;
          },
          {
            timeout: 30_000,
            interval: 100,
            timeoutMessage:
              'boxel_index entries for published realm did not appear',
          },
        );

        // Verify that the correct directory within _published was created
        let publishedRealmId = response.body.data.id;
        let publishedDir = join(dir.name, 'realm_server_3', '_published');
        let publishedRealmPath = join(publishedDir, publishedRealmId);

        assert.ok(existsSync(publishedDir), '_published directory exists');
        assert.ok(
          existsSync(publishedRealmPath),
          'published realm directory exists',
        );
        assert.ok(
          existsSync(join(publishedRealmPath, 'index.json')),
          'published realm has index.json',
        );

        // CS-10053: publishable is in realm_metadata, not the sidecar.
        let publishedRealmURL = response.body.data.attributes.publishedRealmURL;
        let metaRows = (await dbAdapter.execute(
          `SELECT publishable FROM realm_metadata WHERE url = '${publishedRealmURL}'`,
        )) as { publishable: boolean | null }[];
        assert.deepEqual(
          metaRows,
          [{ publishable: false }],
          'realm_metadata for published realm has publishable: false',
        );

        // Verify that boxel_index entries exist for the published realm
        let indexResults = await dbAdapter.execute(
          `SELECT * FROM boxel_index WHERE realm_url = '${publishedRealmURL}'`,
        );
        assert.ok(
          indexResults.length > 0,
          'boxel_index should contain entries for published realm',
        );
        assert.strictEqual(
          indexResults[0].realm_url,
          publishedRealmURL,
          'index entries should reference the published realm URL',
        );

        // Verify that head_html in the published realm references the
        // published URL, not the source realm URL (the fullIndex after
        // publish re-renders templates so og:url uses the correct URL)
        let instanceWithHead = indexResults.find(
          (r) => r.type === 'instance' && r.head_html,
        );
        assert.ok(
          instanceWithHead,
          'boxel_index should contain an instance row with head_html for the published realm',
        );
        let headHtml = (instanceWithHead as any).head_html as string;
        assert.ok(
          headHtml.includes(publishedRealmURL),
          `head_html should reference published realm URL, got: ${headHtml}`,
        );
        assert.notOk(
          headHtml.includes(sourceRealmUrlString),
          `head_html should not reference source realm URL, got: ${headHtml}`,
        );

        let catalogResponse = await request
          .get('/_catalog-realms')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(
          catalogResponse.status,
          200,
          'catalog realms HTTP 200 status',
        );
        let catalogRealmIds = catalogResponse.body.data.map(
          (item: { id: string }) => item.id,
        );
        assert.false(
          catalogRealmIds.includes(publishedRealmURL),
          'catalog realms should not include the published realm',
        );

        let sourceRealmPath = new URL(sourceRealmUrlString).pathname;
        let sourceRealmInfoPath = `${sourceRealmPath}_info`;

        let sourceRealmInfoResponse = await request
          .post(sourceRealmInfoPath)
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(
          sourceRealmInfoResponse.status,
          200,
          'source realm info HTTP 200 status',
        );
        assert.ok(
          sourceRealmInfoResponse.body.data.attributes.lastPublishedAt,
          'source realm has lastPublishedAt field',
        );

        // For source realm, lastPublishedAt should be an object
        let sourceLastPublishedAt =
          sourceRealmInfoResponse.body.data.attributes.lastPublishedAt;
        assert.strictEqual(
          typeof sourceLastPublishedAt,
          'object',
          'source realm lastPublishedAt is an object',
        );

        // Verify the object contains the published realm URL
        assert.ok(
          sourceLastPublishedAt[publishedRealmURL],
          'source realm lastPublishedAt contains published realm URL',
        );

        // Test that published realm info includes lastPublishedAt as a string
        let publishedRealmInfoResponse = await request
          .post('/test-realm/_info')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set('Host', new URL(publishedRealmURL).host)
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          );

        assert.strictEqual(
          publishedRealmInfoResponse.status,
          200,
          'published realm info HTTP 200 status',
        );
        assert.ok(
          publishedRealmInfoResponse.body.data.attributes.lastPublishedAt,
          'published realm has lastPublishedAt field',
        );

        // For published realm, lastPublishedAt should be a string
        let publishedLastPublishedAt =
          publishedRealmInfoResponse.body.data.attributes.lastPublishedAt;
        assert.strictEqual(
          typeof publishedLastPublishedAt,
          'string',
          'published realm lastPublishedAt is a string',
        );

        // Verify the timestamp matches what was returned from the publish response
        assert.strictEqual(
          publishedLastPublishedAt,
          response.body.data.attributes.lastPublishedAt,
          'published realm lastPublishedAt matches publish response timestamp',
        );
      });

      // A published realm lives on a different domain than the server
      // that hosts it (here the published realm is on
      // testuser.localhost:4445 while the server's own URL is
      // 127.0.0.1:4445). The grafana reindex handler gates on registry
      // membership rather than the server's origin, so a hosted realm on
      // any domain — published ones included — can be reindexed.
      test('can reindex a published realm via grafana endpoint even though it is on a different domain', async function (assert) {
        let publishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );
        assert.strictEqual(publishResponse.status, 202, 'HTTP 202 status');
        let publishedRealmURL =
          publishResponse.body.data.attributes.publishedRealmURL;
        assert.notStrictEqual(
          new URL(publishedRealmURL).origin,
          new URL(testRealm2URL).origin,
          'published realm is on a different origin than the server',
        );

        // Drive a reconcile pass so the freshly-published realm is in the
        // reconciler's registry view and reindex's lookupOrMount can
        // resolve it.
        await testRealmServer.testingOnlyReconcile();
        await waitUntil(
          async () => {
            let rows = await dbAdapter.execute(
              `SELECT 1 FROM boxel_index WHERE realm_url = $1 LIMIT 1`,
              { bind: [publishedRealmURL] },
            );
            return rows.length > 0 ? rows : undefined;
          },
          {
            timeout: 30_000,
            interval: 100,
            timeoutMessage:
              'boxel_index entries for published realm did not appear',
          },
        );

        let initialJobs = (await dbAdapter.execute('select id from jobs')) as {
          id: string;
        }[];
        let initialJobIds = new Set(initialJobs.map((j) => String(j.id)));

        let reindexResponse = await request
          .post(
            `/_grafana-reindex?realm=${encodeURIComponent(publishedRealmURL)}`,
          )
          .set('Authorization', `Bearer ${grafanaSecret}`)
          .set('Content-Type', 'application/json');
        assert.strictEqual(
          reindexResponse.status,
          200,
          'reindex of a cross-domain published realm succeeds',
        );

        let finalJobs = (await dbAdapter.execute(
          'select id, job_type, args from jobs',
        )) as { id: string; job_type: string; args: any }[];
        let newJobs = finalJobs.filter((j) => !initialJobIds.has(String(j.id)));
        let reindexJob = newJobs.find(
          (j) =>
            j.job_type === 'from-scratch-index' &&
            j.args?.realmURL === publishedRealmURL,
        );
        assert.ok(
          reindexJob,
          'a from-scratch-index job was enqueued for the published realm',
        );
      });

      test('publishing a realm with the default CardsGrid index writes includePrerenderedDefaultRealmIndex into the published realm.json', async function (assert) {
        let response = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL:
                'http://testuser.localhost:4445/cards-grid-default/',
            }),
          );
        assert.strictEqual(response.status, 202, 'HTTP 202 status');

        let publishedRealmId = response.body.data.id;
        let publishedDir = join(dir.name, 'realm_server_3', '_published');
        let publishedRealmConfigPath = join(
          publishedDir,
          publishedRealmId,
          'realm.json',
        );
        assert.ok(
          existsSync(publishedRealmConfigPath),
          'published realm.json exists on disk',
        );
        let publishedRealmConfig = readJsonSync(publishedRealmConfigPath) as {
          data?: {
            attributes?: { includePrerenderedDefaultRealmIndex?: boolean };
          };
        };
        assert.true(
          publishedRealmConfig?.data?.attributes
            ?.includePrerenderedDefaultRealmIndex,
          'published realm.json carries includePrerenderedDefaultRealmIndex: true after publish',
        );
      });

      test('publishing a realm whose index.json is not a CardsGrid leaves the published realm.json untouched', async function (assert) {
        let sourceRealmPath = new URL(sourceRealmUrlString).pathname;

        // Replace the source realm's default CardsGrid index with a
        // bespoke CardDef-adopting index so the publish handler should
        // NOT set the opt-in flag.
        let customIndexResponse = await request
          .post(`${sourceRealmPath}index.json`)
          .set('Accept', 'application/vnd.card+source')
          .send(
            JSON.stringify({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: 'https://cardstack.com/base/card-api',
                    name: 'CardDef',
                  },
                },
              },
            }),
          );
        assert.strictEqual(
          customIndexResponse.status,
          204,
          'custom non-CardsGrid index.json can be written',
        );

        let response = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/custom-index/',
            }),
          );
        assert.strictEqual(response.status, 202, 'HTTP 202 status');

        let publishedRealmId = response.body.data.id;
        let publishedDir = join(dir.name, 'realm_server_3', '_published');
        let publishedRealmConfigPath = join(
          publishedDir,
          publishedRealmId,
          'realm.json',
        );
        assert.ok(
          existsSync(publishedRealmConfigPath),
          'published realm.json exists on disk',
        );
        let publishedRealmConfig = readJsonSync(publishedRealmConfigPath) as {
          data?: {
            attributes?: { includePrerenderedDefaultRealmIndex?: boolean };
          };
        };
        assert.notStrictEqual(
          publishedRealmConfig?.data?.attributes
            ?.includePrerenderedDefaultRealmIndex,
          true,
          'published realm.json does NOT carry includePrerenderedDefaultRealmIndex when the source index is a non-CardsGrid card',
        );
      });

      test('POST /_publish-realm serves cached module entries for published realm URLs', async function (assert) {
        let requestedPublishedRealmURL = 'http://localhost:4445/test-realm/';
        let sourceRealmPath = new URL(sourceRealmUrlString).pathname;

        let linkedCardModuleResponse = await request
          .post(`${sourceRealmPath}linked-card.gts`)
          .set('Accept', 'application/vnd.card+source').send(`
            import { CardDef } from "https://cardstack.com/base/card-api";
            import { linkedCardTitle } from "./linked-card-title";

            export const _linkedCardTitle = linkedCardTitle;

            export class LinkedCard extends CardDef {}
          `);
        assert.strictEqual(
          linkedCardModuleResponse.status,
          204,
          'source linked-card module can be written',
        );

        let linkedCardDepResponse = await request
          .post(`${sourceRealmPath}linked-card-title.ts`)
          .set('Accept', 'application/vnd.card+source')
          .send(`export const linkedCardTitle = "linked-card-title";`);
        assert.strictEqual(
          linkedCardDepResponse.status,
          204,
          'source linked-card dependency module can be written',
        );

        let linkedCardInstanceResponse = await request
          .post(`${sourceRealmPath}linked-card.json`)
          .set('Accept', 'application/vnd.card+source')
          .send(
            JSON.stringify({
              data: {
                type: 'card',
                id: `${sourceRealmUrlString}linked-card`,
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: './linked-card',
                    name: 'LinkedCard',
                  },
                },
              },
            }),
          );
        assert.strictEqual(
          linkedCardInstanceResponse.status,
          204,
          'source linked-card instance can be written',
        );

        let publishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: requestedPublishedRealmURL,
            }),
          );

        assert.strictEqual(publishResponse.status, 202, 'HTTP 202 status');
        let publishedRealmURL =
          publishResponse.body.data.attributes.publishedRealmURL;
        let publishedRealmPath = new URL(publishedRealmURL).pathname;
        let publishedRealmHost = new URL(publishedRealmURL).host;
        let publishedModuleAlias = `${publishedRealmURL}linked-card`;

        let publishedCardResponse = await waitUntil(
          async () => {
            let response = await request
              .get(`${publishedRealmPath}linked-card`)
              .set('Accept', 'application/vnd.card+json')
              .set('Host', publishedRealmHost);
            return response.status === 200 ? response : undefined;
          },
          {
            // This can be slow in CI because the first published lookup may
            // need to prerender and populate module cache rows.
            timeout: 30_000,
            interval: 200,
            timeoutMessage:
              'published linked-card card did not become readable',
          },
        );
        assert.strictEqual(publishedCardResponse?.status, 200);

        let cachedModuleEntry = await waitUntil(
          async () => {
            let rows = (await dbAdapter.execute(
              `SELECT url, file_alias, deps, resolved_realm_url
               FROM modules
               WHERE file_alias = $1
                 AND resolved_realm_url = $2`,
              {
                bind: [publishedModuleAlias, publishedRealmURL],
                coerceTypes: { deps: 'JSON' },
              },
            )) as {
              url: string;
              file_alias: string | null;
              deps: string[] | string | null;
              resolved_realm_url: string | null;
            }[];
            return rows[0];
          },
          {
            timeout: 30_000,
            interval: 200,
            timeoutMessage:
              'module cache entry for published linked-card was not created',
          },
        );

        assert.ok(cachedModuleEntry, 'published module cache entry is created');
        assert.strictEqual(
          cachedModuleEntry.url,
          `${publishedModuleAlias}.gts`,
          'cached module URL uses published realm URL',
        );
        assert.strictEqual(
          cachedModuleEntry.file_alias,
          publishedModuleAlias,
          'cached module file_alias uses published realm URL',
        );
        assert.strictEqual(
          cachedModuleEntry.resolved_realm_url,
          publishedRealmURL,
          'cached module resolved realm URL is the published realm',
        );
        let moduleDeps = cachedModuleEntry.deps;
        assert.ok(Array.isArray(moduleDeps), 'cached module deps are an array');
        assert.ok(
          moduleDeps?.includes(`${publishedRealmURL}linked-card-title`),
          'cached module deps include published local dependency',
        );
      });

      test('a proxied (https) request for an extensionless module URL that collides with a same-named instance is served the module, not the published HTML page', async function (assert) {
        // Repro of the published-realm "Unexpected token (1:0)" failure.
        //
        // A card whose instance and definition module share a base name
        // (home.json adopts ./home, defined in home.gts) collides on the
        // extensionless URL `.../home`. On a published realm that URL also
        // addresses the website page, so serveIndex has to decide between
        // serving the module and serving the page. It keeps the page only
        // when no same-named module exists — but that probe resolves the
        // request against the realm's registered protocol.
        //
        // Behind a TLS-terminating proxy (the load balancer in front of
        // staging/prod) the realm is registered https while the proxied
        // request reaches the server as http + `x-forwarded-proto: https`.
        // If serveIndex reads the raw connection protocol instead of the
        // forwarded one it builds an http URL for an https realm, the module
        // probe throws on the mismatch, and the host loader is handed the
        // HTML page — which it then fails to parse as JS.
        //
        // We reproduce that here by sending `x-forwarded-proto: https` over a
        // plain-http supertest connection against an https-published realm,
        // and by waiting on boxel_index (rather than reading the card) so the
        // module cache stays cold and the protocol-sensitive probe is the
        // deciding factor.
        let publishedRealmURL = 'https://collide.localhost:4445/test-realm/';
        let sourceRealmPath = new URL(sourceRealmUrlString).pathname;

        let moduleResponse = await request
          .post(`${sourceRealmPath}home.gts`)
          .set('Accept', 'application/vnd.card+source').send(`
            import { CardDef } from "https://cardstack.com/base/card-api";
            export class Home extends CardDef {
              static displayName = "Home";
            }
          `);
        assert.strictEqual(
          moduleResponse.status,
          204,
          'source home module written',
        );

        let instanceResponse = await request
          .post(`${sourceRealmPath}home.json`)
          .set('Accept', 'application/vnd.card+source')
          .send(
            JSON.stringify({
              data: {
                type: 'card',
                attributes: {},
                meta: { adoptsFrom: { module: './home', name: 'Home' } },
              },
            }),
          );
        assert.strictEqual(
          instanceResponse.status,
          204,
          'source home instance written',
        );

        let publishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL,
            }),
          );
        assert.strictEqual(publishResponse.status, 202, 'HTTP 202 status');

        let resolvedPublishedRealmURL =
          publishResponse.body.data.attributes.publishedRealmURL;
        let publishedRealmPath = new URL(resolvedPublishedRealmURL).pathname;
        let publishedRealmHost = new URL(resolvedPublishedRealmURL).host;

        // Mount the freshly-published realm, then wait for BOTH the module
        // file row AND the same-named instance row to be indexed, WITHOUT
        // reading the card (a card read would warm the module cache and mask
        // the bug). Both are required: the collision only triggers when the
        // instance row is present so isIndexedCardInstance takes the
        // instance-alias path and reaches the protocol-sensitive module
        // probe. The indexer visits home.json after home.gts, so fetching as
        // soon as only home.gts exists would let the request fall through to
        // normal module serving and pass even when the collision logic is
        // still broken.
        await testRealmServer.testingOnlyReconcile();
        await waitUntil(
          async () => {
            let rows = (await dbAdapter.execute(
              `SELECT
                 bool_or(url = $2) AS has_module,
                 bool_or(type = 'instance' AND url = $3) AS has_instance
               FROM boxel_index
               WHERE realm_url = $1`,
              {
                bind: [
                  resolvedPublishedRealmURL,
                  `${resolvedPublishedRealmURL}home.gts`,
                  `${resolvedPublishedRealmURL}home.json`,
                ],
              },
            )) as {
              has_module: boolean | null;
              has_instance: boolean | null;
            }[];
            return rows[0]?.has_module && rows[0]?.has_instance
              ? rows
              : undefined;
          },
          {
            timeout: 30_000,
            interval: 200,
            timeoutMessage:
              'published home module and instance were not both indexed',
          },
        );

        // The host loader's module fetch as it arrives behind the proxy:
        // http connection, `x-forwarded-proto: https`, against the
        // https-registered published realm.
        let moduleFetch = await request
          .get(`${publishedRealmPath}home`)
          .set('Accept', '*/*')
          .set('X-Forwarded-Proto', 'https')
          .set('Host', publishedRealmHost);

        assert.strictEqual(moduleFetch.status, 200, 'module fetch is 200');
        assert.notOk(
          /text\/html/.test(moduleFetch.headers['content-type'] ?? ''),
          `extensionless module URL must not be served as HTML (got ${moduleFetch.headers['content-type']})`,
        );
        assert.ok(
          /javascript/.test(moduleFetch.headers['content-type'] ?? ''),
          'extensionless module URL is served as JavaScript',
        );
        assert.ok(
          moduleFetch.text.includes('Home'),
          'served body is the module source, exporting Home',
        );
      });

      test('POST /_publish-realm can republish realm with updated timestamp', async function (assert) {
        // First publish
        let firstResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );

        assert.strictEqual(firstResponse.status, 202, 'First publish succeeds');
        let firstTimestamp = firstResponse.body.data.attributes.lastPublishedAt;

        // Wait a bit to ensure timestamp difference
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Republish
        let secondResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );

        assert.strictEqual(secondResponse.status, 202, 'Republish succeeds');
        assert.strictEqual(
          secondResponse.body.data.id,
          firstResponse.body.data.id,
          'Same published realm ID',
        );
        assert.strictEqual(
          secondResponse.body.data.attributes.publishedRealmURL,
          firstResponse.body.data.attributes.publishedRealmURL,
          'Same published realm URL',
        );
        assert.notEqual(
          secondResponse.body.data.attributes.lastPublishedAt,
          firstTimestamp,
          'Timestamp is updated on republish',
        );

        // CS-10053: publishable lives in realm_metadata.
        let publishedRealmURL =
          secondResponse.body.data.attributes.publishedRealmURL;
        let metaRows = (await dbAdapter.execute(
          `SELECT publishable FROM realm_metadata WHERE url = '${publishedRealmURL}'`,
        )) as { publishable: boolean | null }[];
        assert.deepEqual(
          metaRows,
          [{ publishable: false }],
          'realm_metadata for republished realm has publishable: false',
        );
      });

      test('republishing removes files that were deleted from the source realm', async function (assert) {
        let sourceRealmURL = new URL(sourceRealmUrlString);
        let sourceRealmFsPath = join(
          dir.name,
          'realm_server_3',
          ...sourceRealmURL.pathname.split('/').filter(Boolean),
        );

        // Write a file directly to the source realm filesystem
        writeJsonSync(join(sourceRealmFsPath, 'ephemeral-card.json'), {
          data: {
            type: 'card',
            id: `${sourceRealmUrlString}ephemeral-card`,
            attributes: {
              title: 'Ephemeral Card',
            },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        });

        // First publish
        let firstPublishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );

        assert.strictEqual(
          firstPublishResponse.status,
          202,
          'First publish succeeds',
        );

        let publishedRealmId = firstPublishResponse.body.data.id;
        let publishedDir = join(dir.name, 'realm_server_3', '_published');
        let publishedRealmPath = join(publishedDir, publishedRealmId);

        // Verify the file exists in the published realm on disk
        assert.ok(
          existsSync(join(publishedRealmPath, 'ephemeral-card.json')),
          'ephemeral-card.json exists in published realm after first publish',
        );

        // Delete the file from the source realm filesystem
        removeSync(join(sourceRealmFsPath, 'ephemeral-card.json'));
        assert.notOk(
          existsSync(join(sourceRealmFsPath, 'ephemeral-card.json')),
          'ephemeral-card.json is removed from source realm',
        );

        // Republish
        let republishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );

        assert.strictEqual(republishResponse.status, 202, 'Republish succeeds');

        // Verify the file no longer exists on disk in the published realm
        assert.notOk(
          existsSync(join(publishedRealmPath, 'ephemeral-card.json')),
          'ephemeral-card.json should not exist in published realm after republish',
        );
      });

      // CS-11043 regression. The production failure mode was:
      // republish completes (status 202), but the reindex it kicks off
      // serves PRE-swap source bytes out of the realm-server's
      // per-Realm #sourceCache, producing a fresh boxel_index row whose
      // head_html / isolated_html reflects the OLD card. Until the
      // file-watcher catches up (potentially many hours later in
      // production), the published URL keeps serving stale HTML.
      //
      // The fix (handle-publish-realm calling Realm.clearLocalSourceCaches()
      // before enqueueing the reindex) is verified end-to-end by the
      // matrix Playwright test, but the data-layer invariant is faster
      // to assert here: after republish, the boxel_index row for the
      // published instance reflects the NEW title, not the initial.
      test('republishing reflects updated source content in boxel_index (CS-11043)', async function (assert) {
        let sourceRealmURL = new URL(sourceRealmUrlString);
        let sourceRealmFsPath = join(
          dir.name,
          'realm_server_3',
          ...sourceRealmURL.pathname.split('/').filter(Boolean),
        );
        let publishedRealmURL = 'http://testuser.localhost:4445/test-realm/';
        let cardFilename = 'sentinel-card.json';
        let initialName = `sentinel-initial-${uuidv4()}`;
        let updatedName = `sentinel-updated-${uuidv4()}`;
        // cardInfo.name feeds the computed cardTitle field on CardDef,
        // which is what shows up in search_doc / head_html. Plain
        // `attributes.title` is not a CardDef field and would be
        // silently dropped during serialization.
        let buildCardJson = (name: string) => ({
          data: {
            type: 'card',
            id: `${sourceRealmUrlString}sentinel-card`,
            attributes: { cardInfo: { name } },
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/card-api',
                name: 'CardDef',
              },
            },
          },
        });

        writeJsonSync(
          join(sourceRealmFsPath, cardFilename),
          buildCardJson(initialName),
        );

        let publishHeaders = {
          Authorization: `Bearer ${createRealmServerJWT(
            { user: ownerUserId, sessionRoom: 'session-room-test' },
            realmSecretSeed,
          )}`,
        };
        let publishBody = JSON.stringify({
          sourceRealmURL: sourceRealmUrlString,
          publishedRealmURL,
        });

        let firstResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set('Authorization', publishHeaders.Authorization)
          .send(publishBody);
        assert.strictEqual(firstResponse.status, 202, 'first publish accepted');

        // The publish handler upserts the registry row asynchronously
        // and enqueues a from-scratch index — drive a reconcile so the
        // realm-server picks up the new published realm before we wait
        // on boxel_index. search_doc is jsonb; cast to text and use a
        // substring match so we don't have to encode the exact JSON
        // path (cardInfo.name vs the computed cardTitle).
        await testRealmServer.testingOnlyReconcile();
        await waitUntil(
          async () => {
            let rows = await dbAdapter.execute(
              `SELECT 1 FROM boxel_index
                 WHERE realm_url = $1
                   AND type = 'instance'
                   AND search_doc::text LIKE '%' || $2 || '%'
                 LIMIT 1`,
              { bind: [publishedRealmURL, initialName] },
            );
            return rows.length > 0 ? rows : undefined;
          },
          {
            timeout: 30_000,
            interval: 100,
            timeoutMessage:
              'initial sentinel never appeared in boxel_index.search_doc for published realm',
          },
        );

        // Rewrite the source instance with a fresh sentinel string.
        // After republish, boxel_index for the published realm must
        // reflect updatedName (and the cached initialName row must be
        // gone). If the realm-server's #sourceCache is not invalidated
        // before the reindex, the reindex re-reads the OLD bytes and
        // the assertion below times out, exactly as the production bug
        // would have it.
        writeJsonSync(
          join(sourceRealmFsPath, cardFilename),
          buildCardJson(updatedName),
        );

        let secondResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set('Authorization', publishHeaders.Authorization)
          .send(publishBody);
        assert.strictEqual(secondResponse.status, 202, 'republish accepted');

        await testRealmServer.testingOnlyReconcile();
        await waitUntil(
          async () => {
            let rows = await dbAdapter.execute(
              `SELECT 1 FROM boxel_index
                 WHERE realm_url = $1
                   AND type = 'instance'
                   AND search_doc::text LIKE '%' || $2 || '%'
                 LIMIT 1`,
              { bind: [publishedRealmURL, updatedName] },
            );
            return rows.length > 0 ? rows : undefined;
          },
          {
            timeout: 30_000,
            interval: 100,
            timeoutMessage:
              'updated sentinel never appeared in boxel_index.search_doc for published realm — republish served pre-swap source bytes (CS-11043)',
          },
        );

        // Belt-and-suspenders: the row that previously held the
        // initial sentinel should no longer reference it.
        let staleRows = await dbAdapter.execute(
          `SELECT 1 FROM boxel_index
             WHERE realm_url = $1
               AND type = 'instance'
               AND search_doc::text LIKE '%' || $2 || '%'`,
          { bind: [publishedRealmURL, initialName] },
        );
        assert.strictEqual(
          staleRows.length,
          0,
          'no boxel_index instance rows still reference the initial sentinel after republish',
        );
      });

      test('POST /_unpublish-realm can unpublish realm successfully', async function (assert) {
        // First publish a realm
        let publishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );

        assert.strictEqual(publishResponse.status, 202, 'Publish succeeds');
        let publishedRealmURL =
          publishResponse.body.data.attributes.publishedRealmURL;

        // Verify that boxel_index entries exist before unpublishing
        let indexResultsBefore = await dbAdapter.execute(
          `SELECT * FROM boxel_index WHERE realm_url = '${publishedRealmURL}'`,
        );
        assert.ok(
          indexResultsBefore.length > 0,
          'boxel_index should contain entries for published realm before unpublish',
        );
        // All entries should be marked as deleted (tombstones)
        for (let entry of indexResultsBefore) {
          assert.false(
            entry.is_deleted,
            `Entry ${entry.url} should not be marked as deleted (tombstone) before unpublish`,
          );
        }

        let versionBeforeUnpublish = (
          await dbAdapter.execute(
            `SELECT current_version FROM realm_versions WHERE realm_url = '${publishedRealmURL}'`,
          )
        )[0]?.current_version as number | undefined;

        // Now unpublish the realm
        let unpublishResponse = await request
          .post('/_unpublish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              publishedRealmURL: publishedRealmURL,
            }),
          );

        assert.strictEqual(unpublishResponse.status, 200, 'HTTP 200 status');
        // Phase 3: unmount is reconciler-driven (NOTIFY realm_registry).
        // Force a reconcile pass so the published realm is unmounted on
        // this instance before the "404 after unpublish" assertion below.
        await testRealmServer.testingOnlyReconcile();
        assert.strictEqual(
          unpublishResponse.body.data.type,
          'unpublished_realm',
        );
        assert.strictEqual(
          unpublishResponse.body.data.id,
          publishResponse.body.data.id,
          'unpublished realm ID is the same as the published realm ID',
        );
        assert.strictEqual(
          unpublishResponse.body.data.attributes.sourceRealmURL,
          sourceRealmUrlString,
          'source realm URL is correct',
        );
        assert.strictEqual(
          unpublishResponse.body.data.attributes.publishedRealmURL,
          publishedRealmURL,
          'published realm URL is correct',
        );
        assert.ok(
          unpublishResponse.body.data.attributes.lastPublishedAt,
          'last published at timestamp is present',
        );

        // Verify that the published realm directory was removed
        let publishedRealmId = unpublishResponse.body.data.id;
        let publishedDir = join(dir.name, 'realm_server_3', '_published');
        let publishedRealmPath = join(publishedDir, publishedRealmId);

        assert.notOk(
          existsSync(publishedRealmPath),
          'published realm directory should be removed',
        );

        let realmVersion = (
          await dbAdapter.execute(
            `SELECT current_version FROM realm_versions WHERE realm_url = '${publishedRealmURL}'`,
          )
        )[0] as { current_version: number };
        assert.notStrictEqual(
          versionBeforeUnpublish,
          undefined,
          'realm version of published realm is set before unpublish',
        );
        assert.ok(
          realmVersion.current_version > (versionBeforeUnpublish ?? 0),
          'realm version of published realm is increased',
        );

        // Verify that boxel_index entries are tombstoned (marked as deleted) for the unpublished realm
        let indexResultsAfter = await dbAdapter.execute(
          `SELECT * FROM boxel_index WHERE realm_url = '${publishedRealmURL}' AND realm_version = '${realmVersion.current_version}'`,
        );
        assert.ok(
          indexResultsAfter.length > 0,
          'boxel_index should contain tombstone entries for unpublished realm',
        );

        // All entries should be marked as deleted (tombstones)
        for (let entry of indexResultsAfter) {
          assert.true(
            entry.is_deleted,
            `Entry ${entry.url} should be marked as deleted (tombstone)`,
          );
        }

        // Verify that source realm info no longer includes lastPublishedAt
        let sourceRealmInfoResponse = await request
          .post('/test/_info')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(
          sourceRealmInfoResponse.status,
          200,
          'source realm info HTTP 200 status',
        );
        assert.strictEqual(
          sourceRealmInfoResponse.body.data.attributes.lastPublishedAt,
          null,
          'source realm lastPublishedAt should be null after unpublish',
        );

        // Verify that published realm is no longer accessible
        let publishedRealmInfoResponse = await request
          .post('/test-realm/_info')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json')
          .set('Host', new URL(publishedRealmURL).host);

        assert.strictEqual(
          publishedRealmInfoResponse.status,
          404,
          'published realm should return 404 after unpublish',
        );
      });

      test('POST /_unpublish-realm returns not found for non-existent published realm', async function (assert) {
        let response = await request
          .post('/_unpublish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              publishedRealmURL:
                'http://testuser.localhost/non-existent-realm/',
            }),
          );

        assert.strictEqual(response.status, 422, 'HTTP 422 status');
        assert.strictEqual(
          response.text,
          '{"errors":["Published realm http://testuser.localhost/non-existent-realm/ not found"]}',
          'Error message is correct',
        );
      });

      test('POST /_unpublish-realm returns bad request for missing publishedRealmURL', async function (assert) {
        let response = await request
          .post('/_unpublish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(JSON.stringify({}));

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        assert.strictEqual(
          response.text,
          '{"errors":["publishedRealmURL is required"]}',
          'Error message is correct',
        );
      });

      test('POST /_unpublish-realm returns forbidden for user without realm-owner permission', async function (assert) {
        // First publish a realm as the owner
        let publishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: 'http://testuser.localhost:4445/test-realm/',
            }),
          );

        assert.strictEqual(publishResponse.status, 202, 'Publish succeeds');
        let publishedRealmURL =
          publishResponse.body.data.attributes.publishedRealmURL;

        // Now try to unpublish as a non-owner
        let nonOwnerUserId = '@non-realm-owner:localhost';
        let response = await request
          .post('/_unpublish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: nonOwnerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              publishedRealmURL: publishedRealmURL,
            }),
          );

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
        assert.strictEqual(
          response.text,
          `{"errors":["${nonOwnerUserId} does not have enough permission to unpublish this realm"]}`,
          'Error message is correct',
        );
      });

      test('POST /_unpublish-realm returns bad request for invalid JSON', async function (assert) {
        let response = await request
          .post('/_unpublish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send('invalid json');

        assert.strictEqual(response.status, 400, 'HTTP 400 status');
        assert.strictEqual(
          response.text,
          '{"errors":["Request body is not valid JSON-API - invalid JSON"]}',
          'Error message is correct',
        );
      });

      test('QUERY /_info returns lastPublishedAt as null for unpublished realm', async function (assert) {
        let response = await request
          .post('/test/_info')
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', 'application/vnd.api+json');

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.body.data.attributes.lastPublishedAt,
          null,
          'unpublished realm has lastPublishedAt as null',
        );
      });

      test('republishing clears stale modules cache entries for the published realm', async function (assert) {
        let publishedRealmURL = 'http://testuser.localhost/test-realm/';

        // First publish
        let firstResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL,
            }),
          );

        assert.strictEqual(firstResponse.status, 202, 'First publish succeeds');

        // Simulate a stale modules cache entry with an error for the published realm
        let moduleUrl = `${publishedRealmURL}my-module`;
        await dbAdapter.execute(
          `INSERT INTO modules (url, file_alias, definitions, deps, error_doc, created_at, resolved_realm_url, cache_scope, auth_user_id)
           VALUES ('${moduleUrl}', '${moduleUrl}', '{}', '[]', '${JSON.stringify({ error: { message: 'simulated prerender failure' } })}', ${Date.now()}, '${publishedRealmURL}', 'public', '')`,
        );

        // Verify the error entry exists
        let modulesBefore = await dbAdapter.execute(
          `SELECT * FROM modules WHERE resolved_realm_url = '${publishedRealmURL}'`,
        );
        assert.ok(
          modulesBefore.length > 0,
          'modules table has entries for published realm before republish',
        );
        let errorEntry = modulesBefore.find((m: any) => m.error_doc != null);
        assert.ok(
          errorEntry,
          'modules table has an error_doc entry before republish',
        );

        // Republish the realm
        let secondResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL,
            }),
          );

        assert.strictEqual(secondResponse.status, 202, 'Republish succeeds');

        // Verify the stale modules cache entries were cleared
        let modulesAfter = await dbAdapter.execute(
          `SELECT * FROM modules WHERE resolved_realm_url = '${publishedRealmURL}'`,
        );
        let errorEntryAfter = modulesAfter.find(
          (m: any) => m.error_doc != null,
        );
        assert.notOk(
          errorEntryAfter,
          'modules table should not have error_doc entries after republish',
        );
      });

      test('POST /_publish-realm does not create duplicate realm instances on republish', async function (assert) {
        let publishedRealmURL = 'http://testuser.localhost:4445/test-realm/';

        // First publish
        let firstResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: publishedRealmURL,
            }),
          );

        assert.strictEqual(firstResponse.status, 202, 'First publish succeeds');

        let republishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: publishedRealmURL,
            }),
          );

        assert.strictEqual(republishResponse.status, 202, `Republish succeeds`);
        assert.strictEqual(
          republishResponse.body.data.id,
          firstResponse.body.data.id,
          `Republish uses same realm ID`,
        );

        // Now unpublish and verify clean removal
        let unpublishResponse = await request
          .post('/_unpublish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              publishedRealmURL: publishedRealmURL,
            }),
          );

        assert.strictEqual(unpublishResponse.status, 200, 'Unpublish succeeds');

        // Verify we can republish after unpublish without issues
        let republishAfterUnpublishResponse = await request
          .post('/_publish-realm')
          .set('Accept', 'application/vnd.api+json')
          .set('Content-Type', 'application/json')
          .set(
            'Authorization',
            `Bearer ${createRealmServerJWT(
              { user: ownerUserId, sessionRoom: 'session-room-test' },
              realmSecretSeed,
            )}`,
          )
          .send(
            JSON.stringify({
              sourceRealmURL: sourceRealmUrlString,
              publishedRealmURL: publishedRealmURL,
            }),
          );

        assert.strictEqual(
          republishAfterUnpublishResponse.status,
          202,
          'Republish after unpublish succeeds',
        );
        assert.notEqual(
          republishAfterUnpublishResponse.body.data.id,
          firstResponse.body.data.id,
          'New realm ID generated after republish following unpublish',
        );
      });
    });
  });
});
