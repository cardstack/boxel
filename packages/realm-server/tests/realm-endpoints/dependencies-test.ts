import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import type { Server } from 'http';
import { closeServer, setupPermissionedRealm } from '../helpers';

module(`realm-endpoints/${basename(__filename)}`, function (hooks) {
  let testRealm: Realm;
  let testRealmHttpServer: Server;
  let request: SuperTest<Test>;
  function onRealmSetup({
    testRealm: realm,
    testRealmHttpServer: server,
    request: req,
  }: {
    testRealm: Realm;
    testRealmHttpServer: Server;
    request: SuperTest<Test>;
  }) {
    testRealm = realm;
    testRealmHttpServer = server;
    request = req;
  }

  hooks.afterEach(async function () {
    await closeServer(testRealmHttpServer);
  });

  setupPermissionedRealm(hooks, {
    permissions: {
      '*': ['read'],
    },
    onRealmSetup,
  });

  test('returns resource index entries for an existing module', async function (assert) {
    await testRealm.write(
      'dependencies-card.gts',
      `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        export class ResourceIndexCard extends CardDef {
          @field title = contains(StringField);
        }
      `,
    );
    await testRealm.realmIndexUpdater.fullIndex();

    let targetUrl = `${testRealm.url}dependencies-card.gts`;
    let response = await request
      .get(`/_dependencies?url=${encodeURIComponent(targetUrl)}&type=module`)
      .set('Accept', SupportedMimeType.JSONAPI);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.true(response.body.data.length > 0, 'returns at least one entry');

    let entry = response.body.data.find(
      (candidate: any) => candidate.attributes?.entryType === 'module',
    );
    assert.ok(entry, 'returns module entry');
    assert.strictEqual(entry.id, targetUrl);
    assert.strictEqual(entry.attributes.canonicalUrl, targetUrl);
    assert.strictEqual(entry.attributes.realmUrl, testRealm.url);
    assert.strictEqual(entry.attributes.entryType, 'module');
    assert.false(entry.attributes.hasError);
    assert.true(
      entry.attributes.dependencies.includes(
        'https://cardstack.com/base/string',
      ),
    );
  });

  test('returns empty array for unknown resources', async function (assert) {
    let response = await request
      .get(
        `/_dependencies?url=${encodeURIComponent(`${testRealm.url}missing-resource.gts`)}`,
      )
      .set('Accept', SupportedMimeType.JSONAPI);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.deepEqual(
      response.body.data,
      [],
      'missing resource returns an empty array',
    );
  });

  test('returns bad request when url parameter is missing', async function (assert) {
    let response = await request
      .get('/_dependencies')
      .set('Accept', SupportedMimeType.JSONAPI);

    assert.strictEqual(response.status, 400, 'HTTP 400 status');

    assert.strictEqual(
      response.body.errors?.[0]?.message,
      'The request is missing the url query parameter',
    );
  });
});
