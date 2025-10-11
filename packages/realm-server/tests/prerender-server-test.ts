import { module, test } from 'qunit';
import supertest, { SuperTest, Test } from 'supertest';
import { basename } from 'path';

import {
  setupBaseRealmServer,
  setupPermissionedRealm,
  matrixURL,
  realmSecretSeed,
  testRealmHref,
} from './helpers';
import { buildPrerenderApp } from '../prerender/prerender-app';
import { Prerenderer } from '../prerender';
import { baseCardRef } from '@cardstack/runtime-common';

module(basename(__filename), function () {
  module('Prerender server', function (hooks) {
    let request: SuperTest<Test>;
    let prerenderer: Prerenderer;
    const testUserId = '@jade:localhost';

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
      let built = buildPrerenderApp(realmSecretSeed);
      prerenderer = built.prerenderer;
      request = supertest(built.app.callback());
    });

    hooks.after(async function () {
      await prerenderer.stop();
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
              realm: testRealmHref,
            },
          },
        });

      assert.strictEqual(res.status, 201, 'HTTP 201');
      assert.strictEqual(res.body.data.type, 'prerender-result', 'type ok');
      assert.strictEqual(res.body.data.id, url, 'id is url');
      assert.deepEqual(
        res.body.data.attributes.displayNames,
        ['Pet', 'Card'],
        'displayNames ok',
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
      // spot check a few deps, as the whole list is overwhelming...
      assert.ok(
        res.body.data.attributes.deps?.includes(baseCardRef.module),
        `${baseCardRef.module} is a dep`,
      );
      assert.ok(
        res.body.data.attributes.deps?.includes(`${testRealmHref}pet`),
        `${testRealmHref}pet is a dep`,
      );
      assert.ok(
        (res.body.data.attributes.deps as string[]).find((d) =>
          d.match(
            /^https:\/\/cardstack.com\/base\/card-api\.gts\..*glimmer-scoped\.css$/,
          ),
        ),
        `glimmer scoped css from ${baseCardRef.module} is a dep`,
      );
      assert.ok(res.body.meta?.timing?.totalMs >= 0, 'has timing');
      assert.ok(res.body.meta?.pool?.pageId, 'has pool.pageId');
      assert.false(res.body.meta?.pool?.evicted, 'pool.evicted defaults false');
      assert.strictEqual(
        res.body.meta?.pool?.realm,
        testRealmHref,
        'pool realm ok',
      );
    });
  });
});
