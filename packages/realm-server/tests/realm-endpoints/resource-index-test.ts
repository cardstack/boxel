import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import type { Server } from 'http';
import {
  closeServer,
  matrixURL,
  setupBaseRealmServer,
  setupPermissionedRealm,
} from '../helpers';

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

  setupBaseRealmServer(hooks, matrixURL);

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
      'resource-index-card.gts',
      `
        import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
        import StringField from "https://cardstack.com/base/string";
        export class ResourceIndexCard extends CardDef {
          @field title = contains(StringField);
        }
      `,
    );
    await testRealm.realmIndexUpdater.fullIndex();

    let targetUrl = `${testRealm.url}resource-index-card.gts`;
    let response = await request
      .get(`/_resource-index?url=${encodeURIComponent(targetUrl)}`)
      .set('Accept', SupportedMimeType.JSON);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.true(response.body.length > 0, 'returns at least one entry');

    let entry = response.body[0];
    assert.strictEqual(entry.canonicalUrl, targetUrl);
    assert.strictEqual(entry.realmUrl, testRealm.url);
    assert.true(
      entry.dependencies.includes('https://cardstack.com/base/string'),
    );
  });

  test('returns empty array for unknown resources', async function (assert) {
    let response = await request
      .get(
        `/_resource-index?url=${encodeURIComponent(`${testRealm.url}missing-resource.gts`)}`,
      )
      .set('Accept', SupportedMimeType.JSON);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.deepEqual(
      response.body,
      [],
      'missing resource returns an empty array',
    );
  });

  test('returns bad request when url parameter is missing', async function (assert) {
    let response = await request
      .get('/_resource-index')
      .set('Accept', SupportedMimeType.JSON);

    assert.strictEqual(response.status, 400, 'HTTP 400 status');

    assert.strictEqual(
      response.body.errors?.[0]?.message,
      'The request body is missing the url parameter',
    );
  });
});
