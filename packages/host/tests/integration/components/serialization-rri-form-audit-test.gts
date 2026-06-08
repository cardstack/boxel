import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  identifyCard,
  PermissionsContextName,
  type Permissions,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  cardInfo,
  provideConsumeContext,
  saveCard,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRRI,
} from '../../helpers';
import {
  CardDef,
  contains,
  FieldDef,
  field,
  linksTo,
  serializeCard,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

module('Integration | serialization | RRI form audit', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    let permissions: Permissions = { canWrite: true, canRead: true };
    provideConsumeContext(PermissionsContextName, permissions);
    loader = getService('loader-service').loader;
  });
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  test('serializeCard output keys against an unmapped (test) realm', async function (assert) {
    class Author extends FieldDef {
      @field name = contains(StringField);
    }
    class Tag extends CardDef {
      @field label = contains(StringField);
    }
    class Post extends CardDef {
      @field title = contains(StringField);
      @field author = contains(Author);
      @field tag = linksTo(Tag);
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: { 'test-cards.gts': { Author, Post, Tag } },
    });

    let tag = new Tag({ label: 'announcements' });
    await saveCard(
      tag,
      `${testRealmURL}Tag/announcements`,
      loader,
      undefined,
      testRealmURL,
    );

    let post = new Post({
      title: 'Hello',
      author: new Author({ name: 'Buck' }),
      tag,
    });
    await saveCard(
      post,
      `${testRealmURL}Post/1`,
      loader,
      undefined,
      testRealmURL,
    );

    let doc = serializeCard(post, {
      includeUnrenderedFields: true,
      useAbsoluteURL: true,
    });

    assert.strictEqual(
      doc.data.id,
      `${testRealmURL}Post/1`,
      'data.id is URL form (test realm has no prefix mapping)',
    );
    assert.strictEqual(
      (doc.data.meta as any).realmURL,
      testRealmURL,
      'meta.realmURL is URL form (test realm)',
    );
    assert.deepEqual(
      (doc.data.meta as any).adoptsFrom,
      { module: testRRI('test-cards'), name: 'Post' },
      'meta.adoptsFrom.module is URL form (test-realm-defined class)',
    );
    assert.deepEqual(
      (doc.data.relationships as any).tag,
      {
        links: { self: `${testRealmURL}Tag/announcements` },
        data: { id: `${testRealmURL}Tag/announcements`, type: 'card' },
      },
      'linksTo relationship link.self and data.id are URL form',
    );
    assert.deepEqual(
      doc.data.attributes as any,
      {
        title: 'Hello',
        author: { name: 'Buck' },
        cardInfo,
      },
      'contained FieldDef attributes have no identifier exposure',
    );
  });

  test('Loader.identify returns RRI form for base-realm classes when VN has the mapping', async function (assert) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {},
    });

    assert.deepEqual(
      Loader.identify(CardDef),
      { module: '@cardstack/base/card-api', name: 'CardDef' },
      'CardDef identifies as RRI form via base prefix mapping',
    );
    assert.deepEqual(
      Loader.identify(FieldDef),
      { module: '@cardstack/base/card-api', name: 'FieldDef' },
      'FieldDef identifies as RRI form via base prefix mapping',
    );
    assert.deepEqual(
      Loader.identify(StringField),
      { module: '@cardstack/base/string', name: 'default' },
      'StringField identifies as RRI form via base prefix mapping',
    );
  });

  test('identifyCard returns RRI form when adoptedFrom chain ends at a base class', async function (assert) {
    class StrField extends FieldDef {
      @field value = contains(StringField);
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: { 'test-cards.gts': { StrField } },
    });

    assert.deepEqual(
      identifyCard(StrField),
      { module: testRRI('test-cards'), name: 'StrField' },
      'A test-realm class identifies to its own URL-form module (no prefix mapping for the test realm)',
    );
  });
});
