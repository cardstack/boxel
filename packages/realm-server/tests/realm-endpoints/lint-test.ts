import { module, test } from 'qunit';
import { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { baseRealm, Realm } from '@cardstack/runtime-common';
import {
  setupCardLogs,
  setupBaseRealmServer,
  createVirtualNetworkAndLoader,
  matrixURL,
  setupPermissionedRealm,
  createJWT,
} from '../helpers';
import '@cardstack/runtime-common/helpers/code-equality-assertion';

module(`realm-endpoints/${basename(__filename)}`, function () {
  module('Realm-specific Endpoints | POST _lint', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmPath: string;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      request = args.request;
    }

    let { virtualNetwork, loader } = createVirtualNetworkAndLoader();

    setupCardLogs(
      hooks,
      async () => await loader.import(`${baseRealm.url}card-api`),
    );

    setupBaseRealmServer(hooks, virtualNetwork, matrixURL);

    setupPermissionedRealm(hooks, {
      permissions: {
        john: ['read', 'write'],
      },
      onRealmSetup,
    });

    test('401 with invalid JWT', async function (assert) {
      let response = await request
        .post('/_lint')
        .set('Authorization', `Bearer invalid-token`)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send(`console.log('hi')`);

      assert.strictEqual(response.status, 401, 'HTTP 401 status');
    });

    test('user can do a lint with missing template invokable fix', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import MyComponent from 'somewhere';
<template>
  <MyComponent @flag={{eq 1 1}} />
</template>
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import { eq } from '@cardstack/boxel-ui/helpers';
import MyComponent from 'somewhere';
<template>
  <MyComponent @flag={{eq 1 1}} />
</template>
`,
      );
    });

    test('user can do a lint with missing card api fix', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { CardDef } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`,
      );
    });

    test('user can do a lint with duplicate import fix', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import StringField from 'https://cardstack.com/base/string';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';

export class MyCard extends CardDef {
  @field name = contains(StringField);
}
`,
      );
    });

    test('user can do a lint with no fix needed', async function (assert) {
      let response = await request
        .post('/_lint')
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'john', ['read', 'write'])}`,
        )
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', 'application/json')
        .send(`import { eq } from '@cardstack/boxel-ui/helpers';
import MyComponent from 'somewhere';
<template>
  <MyComponent @flag={{eq 1 1}} />
</template>
`);

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      let responseJson = JSON.parse(response.text);
      assert.strictEqual(
        responseJson.output,
        `import { eq } from '@cardstack/boxel-ui/helpers';
import MyComponent from 'somewhere';
<template>
  <MyComponent @flag={{eq 1 1}} />
</template>
`,
      );
    });
  });
});
