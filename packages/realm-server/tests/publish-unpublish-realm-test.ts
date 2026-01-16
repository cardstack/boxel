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
} from 'fs-extra';
import { basename, join } from 'path';
import type { Server } from 'http';
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
  setupPermissionedRealm,
  runTestRealmServer,
  closeServer,
  createVirtualNetwork,
  realmSecretSeed,
  matrixURL,
} from './helpers';
import { createJWT as createRealmServerJWT } from '../utils/jwt';

const testRealm2URL = 'http://127.0.0.1:4445/test/';

module(basename(__filename), function () {
  module('publish and unpublish realm tests', function (hooks) {
    let testRealmHttpServer: Server;
    let testRealm: Realm;
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let request: SuperTest<Test>;
    let testRealmDir: string;
    let virtualNetwork: VirtualNetwork;
    let ownerUserId = '@mango:localhost';

    let dir: DirResult;

    setupPermissionedRealm(hooks, {
      permissions: {
        '*': ['read', 'write'],
      },
      onRealmSetup: async () => {},
    });

    hooks.beforeEach(async function () {
      dir = dirSync();
      copySync(join(__dirname, 'cards'), dir.name);
    });

    async function startRealmServer(
      dbAdapter: PgAdapter,
      publisher: QueuePublisher,
      runner: QueueRunner,
    ) {
      virtualNetwork = createVirtualNetwork();
      ({ testRealm: testRealm, testRealmHttpServer: testRealmHttpServer } =
        await runTestRealmServer({
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
        copySync(join(__dirname, 'cards'), testRealmDir);
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
            publishedRealmURL: 'http://testuser.localhost/test-realm/',
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
        dbAdapter.execute(`
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
              publishedRealmURL: 'http://testuser.localhost/test-realm/',
            }),
          );

        assert.strictEqual(response.status, 201, 'HTTP 201 status');
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

        let publishedRealmConfig = readJsonSync(
          join(publishedRealmPath, '.realm.json'),
        );
        assert.notOk(
          publishedRealmConfig.publishable,
          'published realm config should have publishable: false',
        );

        // Verify that boxel_index entries exist for the published realm
        let publishedRealmURL = response.body.data.attributes.publishedRealmURL;
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

      test('publishing rewrites hostHome URLs that point to the source realm', async function (assert) {
        let sourceRealmURL = new URL(sourceRealmUrlString);
        let sourceRealmPath = join(
          dir.name,
          'realm_server_3',
          ...sourceRealmURL.pathname.split('/').filter(Boolean),
        );
        let sourceRealmConfigPath = join(sourceRealmPath, '.realm.json');
        let sourceRealmConfig = pathExistsSync(sourceRealmConfigPath)
          ? readJsonSync(sourceRealmConfigPath)
          : {};
        let hostHomePath = 'SiteConfig/custom-home';
        let sourceHostHome = `${sourceRealmUrlString}${hostHomePath}`;

        writeJsonSync(sourceRealmConfigPath, {
          ...sourceRealmConfig,
          publishable: true,
          hostHome: sourceHostHome,
        });

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
              publishedRealmURL: 'http://testuser.localhost/test-realm/',
            }),
          );

        assert.strictEqual(response.status, 201, 'HTTP 201 status');

        let publishedRealmId = response.body.data.id;
        let publishedRealmPath = join(
          dir.name,
          'realm_server_3',
          '_published',
          publishedRealmId,
        );
        let publishedRealmConfig = readJsonSync(
          join(publishedRealmPath, '.realm.json'),
        );

        assert.strictEqual(
          publishedRealmConfig.hostHome,
          `${response.body.data.attributes.publishedRealmURL}${hostHomePath}`,
          'hostHome points at published realm',
        );
        assert.notOk(
          publishedRealmConfig.publishable,
          'published realm config should have publishable: false',
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
              publishedRealmURL: 'http://testuser.localhost/test-realm/',
            }),
          );

        assert.strictEqual(firstResponse.status, 201, 'First publish succeeds');
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
              publishedRealmURL: 'http://testuser.localhost/test-realm/',
            }),
          );

        assert.strictEqual(secondResponse.status, 201, 'Republish succeeds');
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

        let publishedRealmId = secondResponse.body.data.id;
        let publishedDir = join(dir.name, 'realm_server_3', '_published');
        let publishedRealmPath = join(publishedDir, publishedRealmId);

        let publishedRealmConfig = readJsonSync(
          join(publishedRealmPath, '.realm.json'),
        );

        assert.notOk(
          publishedRealmConfig.publishable,
          'published realm config should have publishable: false',
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
              publishedRealmURL: 'http://testuser.localhost/test-realm/',
            }),
          );

        assert.strictEqual(publishResponse.status, 201, 'Publish succeeds');
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
        )[0];
        assert.strictEqual(
          realmVersion.current_version,
          2,
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
              publishedRealmURL: 'http://testuser.localhost/test-realm/',
            }),
          );

        assert.strictEqual(publishResponse.status, 201, 'Publish succeeds');
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

      test('POST /_publish-realm does not create duplicate realm instances on republish', async function (assert) {
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
              publishedRealmURL: publishedRealmURL,
            }),
          );

        assert.strictEqual(firstResponse.status, 201, 'First publish succeeds');

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

        assert.strictEqual(republishResponse.status, 201, `Republish succeeds`);
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
          201,
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
