import { module, test } from 'qunit';
import supertest, { SuperTest, Test } from 'supertest';
import { basename } from 'path';
import { Server } from 'http';
import { execSync } from 'child_process';

import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  realmSecretSeed,
  testRealmHref,
} from './helpers';
import { createPrerenderHttpServer } from '../prerender/app';

module(basename(__filename), function () {
  module('Prerender server', function (hooks) {
    let request: SuperTest<Test>;
    let prerenderServer: Server;
    const testUserId = '@jade:localhost';

    hooks.before(() => {
      // Ensure chrome is available for puppeteer in CI
      execSync('pnpm puppeteer browsers install chrome');
    });

    setupBaseRealmServer(hooks, matrixURL);

    setupPermissionedRealm(hooks, {
      mode: 'before',
      permissions: { [testUserId]: ['read', 'write', 'realm-owner'] },
      fileSystem: {
        'pet.gts': `
          import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';
          import { Component } from 'https://cardstack.com/base/card-api';
          export class Pet extends CardDef {
            static displayName = 'Pet';
            @field name = contains(StringField);
            static embedded = <template>{{@fields.name}} is a good pet</template>
          }
        `,
        '1.json': {
          data: {
            attributes: { name: 'Maple' },
            meta: {
              adoptsFrom: { module: './pet', name: 'Pet' },
            },
          },
        },
      },
    });

    hooks.before(function () {
      prerenderServer = createPrerenderHttpServer({
        secretSeed: realmSecretSeed,
      });
      request = supertest(prerenderServer);
    });

    hooks.after(async function () {
      await new Promise<void>((resolve) =>
        prerenderServer.close(() => resolve()),
      );
    });

    test('liveness', async function (assert) {
      let res = await request.get('/').set('Accept', 'application/json');
      assert.strictEqual(res.status, 200, 'HTTP 200');
      assert.deepEqual(res.body, { ready: true }, 'ready payload');
    });

    test('it handles prerender request', async function (assert) {
      let url = `${testRealmHref}1`;
      let permissions = {
        [testRealmHref]: ['read', 'write', 'realm-owner'] as (
          | 'read'
          | 'write'
          | 'realm-owner'
        )[],
      };
      let res = await request
        .post('/prerender')
        .set('Accept', 'application/vnd.api+json')
        .set('Content-Type', 'application/json')
        .send({
          data: {
            type: 'prerender-request',
            attributes: {
              url,
              userId: testUserId,
              permissions,
            },
          },
        });

      assert.strictEqual(res.status, 201, 'HTTP 201');
      assert.strictEqual(res.body.data.type, 'prerender-result', 'type ok');
      assert.strictEqual(res.body.data.id, url, 'id is url');
      assert.strictEqual(
        res.body.data.attributes.displayName,
        'Pet',
        'displayName ok',
      );
      assert.strictEqual(
        res.body.data.attributes.searchDoc?.name,
        'Maple',
        'searchDoc.name ok',
      );
      assert.strictEqual(
        res.body.data.attributes.searchDoc?._cardType,
        'Pet',
        'searchDoc._cardType ok',
      );
      assert.ok(
        /Maple/.test(res.body.data.attributes.isolatedHTML ?? ''),
        'isolatedHTML contains the instance title',
      );
      assert.ok(res.body.meta?.timing?.totalMs >= 0, 'has timing');
    });
  });
});
