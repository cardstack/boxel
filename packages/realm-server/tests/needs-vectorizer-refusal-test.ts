import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import {
  DEFAULT_PERMISSIONS,
  SupportedMimeType,
  rri,
} from '@cardstack/runtime-common';

import {
  createJWT,
  setupPermissionedRealmCached,
  testRealmURLFor,
  type RealmRequest,
  withRealmPath,
} from './helpers/index.ts';

const ownerUserId = '@mango:localhost';

// A vector field typed with a vector kind that names no vectorizer has no
// exact space, so its type is refused when its module loads
// (`needs-vectorizer`). The refusal tells the author what to declare.
module(basename(import.meta.filename), function (hooks) {
  let realmURL = testRealmURLFor('test/');
  let request: RealmRequest;
  let testRealm: Realm;

  setupPermissionedRealmCached(hooks, {
    permissions: {
      [ownerUserId]: ['read', 'write', 'realm-owner'],
    },
    realmURL,
    fileSystem: {
      'note.gts': `
        import { contains, field, CardDef } from "@cardstack/base/card-api";
        import StringField from "@cardstack/base/string";
        import { TextVectorField } from "@cardstack/base/vector";
        export class Note extends CardDef {
          @field body = contains(StringField);
          @field embedding = contains(TextVectorField);
        }
      `,
      'note-1.json': {
        data: {
          type: 'card',
          attributes: { body: 'hello' },
          meta: { adoptsFrom: { module: rri('./note'), name: 'Note' } },
        },
      },
    },
    onRealmSetup({ testRealm: realm, request: req }) {
      testRealm = realm;
      request = withRealmPath(req, realmURL);
    },
  });

  test('a vector kind with no vectorizer is refused, naming what to declare', async function (assert) {
    let response = await request
      .get('/_indexing-errors')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(testRealm, ownerUserId, DEFAULT_PERMISSIONS)}`,
      );
    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let body = JSON.stringify(response.body);
    assert.true(
      body.includes(
        'field \\"embedding\\": TextVectorField is a text vector kind with no exact space',
      ),
      `the error names the field and its type; got ${body}`,
    );
    assert.true(
      body.includes(
        'declare a subclass with static vectorizer (id@revision), provider and dimensions, or use StandardTextVector',
      ),
      'and says what to declare',
    );
  });
});
