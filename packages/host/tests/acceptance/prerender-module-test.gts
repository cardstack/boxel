import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
  trimExecutableExtension,
  type RenderRouteOptions,
  type RealmPermissions,
  CardError,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import {
  setupLocalIndexing,
  setupOnSave,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  captureModuleResult,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

import type { TestRealmAdapter } from '../helpers/adapter';

module('Acceptance | prerender | module', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let adapter: TestRealmAdapter;
  let realm: Realm;

  const DEFAULT_MODULE_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({} as RenderRouteOptions),
  );
  const modulePath = (
    url: string,
    nonce = 0,
    optionsSegment = DEFAULT_MODULE_OPTIONS_SEGMENT,
  ) => `/module/${encodeURIComponent(url)}/${nonce}/${optionsSegment}`;
  const PERSON_MODULE = `
    import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';

    export class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
    }
  `;
  const PARENT_MODULE = `
    import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';

    export class Parent extends CardDef {
      static displayName = 'Parent';
      @field title = contains(StringField);
    }
  `;
  const CHILD_MODULE = `
    import { Parent } from './parent';
    import { field, contains, StringField } from 'https://cardstack.com/base/card-api';

    export class Child extends Parent {
      static displayName = 'Child';
      @field nickname = contains(StringField);
    }
  `;
  const BROKEN_MODULE = `export const Broken = ;`;

  hooks.beforeEach(async function () {
    ({ adapter, realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'person.gts': PERSON_MODULE,
        'parent.gts': PARENT_MODULE,
        'child.gts': CHILD_MODULE,
        'broken.gts': BROKEN_MODULE,
      },
    }));
  });

  test('captures module metadata when module loads successfully', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;

    await visit(modulePath(moduleURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'ready', 'route reports ready status');
    assert.strictEqual(model.id, moduleURL, 'returns module id');
    assert.false(model.isShimmed, 'module is not marked shimmed');
    assert.ok(model.lastModified > 0, 'lastModified recorded');
    assert.ok(model.createdAt > 0, 'createdAt recorded');

    let personKey = `${
      trimExecutableExtension(new URL(moduleURL)).href
    }/Person`;
    assert.ok(personKey in model.definitions, 'includes person definition');

    let personEntry = model.definitions[personKey];
    assert.strictEqual(
      personEntry.type,
      'definition',
      'person definition entry',
    );
    assert.strictEqual(
      personEntry.definition.type,
      'card-def',
      'captures definition details',
    );
    assert.strictEqual(
      personEntry.moduleURL,
      trimExecutableExtension(new URL(moduleURL)).href,
      'moduleURL exposes trimmed module path',
    );
    assert.ok(
      personEntry.types.includes(personKey),
      'types include the card itself',
    );
    assert.ok(
      personEntry.types.includes(`${baseRealm.url}card-api/CardDef`),
      'types include base card',
    );
  });

  test('surface a top-level error when module import fails', async function (assert) {
    let missingURL = `${testRealmURL}missing.gts`;

    await visit(modulePath(missingURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'error', 'capture reports error status');
    assert.strictEqual(model.status, 'error', 'model status is error');
    assert.ok(model.error, 'model contains error entry');
    assert.strictEqual(
      model.error.error.status,
      404,
      'error status is correct',
    );
  });

  test('surface a compile error when module has syntax error', async function (assert) {
    let brokenURL = `${testRealmURL}broken.gts`;

    await visit(modulePath(brokenURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'error', 'capture reports error status');
    assert.strictEqual(model.status, 'error', 'model status is error');
    assert.ok(model.error, 'model contains error entry');
    assert.strictEqual(
      model.error.error.status,
      406,
      'compile error surfaces as 406',
    );
    assert.strictEqual(
      Object.keys(model.definitions).length,
      0,
      'no definitions produced when module fails to compile',
    );
  });

  test('identifies shimmed modules', async function (assert) {
    let loaderService = getService('loader-service');
    let loader = loaderService.loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    cardApi = await loader.import(`${baseRealm.url}card-api`);

    let { field, contains, CardDef, StringField } = cardApi;
    class Shimmed extends CardDef {
      static displayName = 'Shimmed';
      @field name = contains(StringField);
    }

    let shimURL = `${testRealmURL}shimmed.gts`;
    loader.shimModule(shimURL, { Shimmed });

    await visit(modulePath(shimURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'ready', 'shimmed module still resolves');
    assert.true(model.isShimmed, 'module flagged as shimmed');
    assert.strictEqual(
      model.lastModified,
      0,
      'shimmed module lastModified zeroed',
    );
    assert.strictEqual(model.createdAt, 0, 'shimmed module createdAt zeroed');
    assert.deepEqual(
      model.deps,
      [trimExecutableExtension(new URL(shimURL)).href],
      'deps limited to shimmed file',
    );

    let shimKey = `${trimExecutableExtension(new URL(shimURL)).href}/Shimmed`;
    let shimEntry = model.definitions[shimKey];
    assert.ok(shimEntry, 'definition generated for shimmed export');
    assert.strictEqual(shimEntry.type, 'definition', 'shim definition entry');
    assert.strictEqual(
      shimEntry.moduleURL,
      trimExecutableExtension(new URL(shimURL)).href,
      'moduleURL always omits executable extension',
    );
  });

  test('retains status when type resolution fails for a definition', async function (assert) {
    let loaderService = getService('loader-service');
    let loader = loaderService.loader;
    let parentURL = `${testRealmURL}parent.gts`;
    let childURL = `${testRealmURL}child.gts`;

    await loader.import(parentURL);
    await loader.import(childURL);

    loader.shimModule(parentURL, {});

    await visit(modulePath(childURL));
    let { status, model } = captureModuleResult();

    assert.strictEqual(status, 'ready', 'overall route still succeeds');

    let childKey = `${trimExecutableExtension(new URL(childURL)).href}/Child`;
    let childEntry = model.definitions[childKey];
    assert.ok(childEntry, 'child definition captured');
    assert.strictEqual(childEntry.type, 'error', 'definition marked as error');
    assert.strictEqual(childEntry.error.status, 404, 'definition error status');
    assert.strictEqual(
      childEntry.error.status,
      CardError.fromSerializableError(childEntry.error).status,
      'status survives serialization round-trip',
    );
  });

  test('card prerenderer can prerender modules', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;
    let prerenderer = getService('local-indexer').prerenderer;
    let permissions: RealmPermissions = {
      [testRealmURL]: ['read', 'write', 'realm-owner'],
    };

    let response = await prerenderer.prerenderModule({
      realm: testRealmURL,
      url: moduleURL,
      userId: '@testuser:localhost',
      permissions,
    });

    assert.strictEqual(
      response.status,
      'ready',
      'module prerender reports ready',
    );
    assert.strictEqual(response.id, moduleURL, 'module id echoed back');
    let key = `${trimExecutableExtension(new URL(moduleURL)).href}/Person`;
    assert.ok(response.definitions[key], 'definition captured');
    assert.strictEqual(
      response.definitions[key]?.type,
      'definition',
      'definition entry returned',
    );
  });

  test('card prerenderer surfaces module errors', async function (assert) {
    let moduleURL = `${testRealmURL}broken.gts`;
    let prerenderer = getService('local-indexer').prerenderer;
    let permissions: RealmPermissions = {
      [testRealmURL]: ['read', 'write', 'realm-owner'],
    };

    let response = await prerenderer.prerenderModule({
      realm: testRealmURL,
      url: moduleURL,
      userId: '@testuser:localhost',
      permissions,
    });

    assert.strictEqual(
      response.status,
      'error',
      'module prerender reports error',
    );
    assert.ok(response.error, 'error payload present');
    assert.strictEqual(
      response.error?.error.status,
      406,
      'compile error status surfaced',
    );
  });

  test('module prerender captures updated definitions after clear cache', async function (assert) {
    let moduleURL = `${testRealmURL}person.gts`;

    await visit(modulePath(moduleURL));
    let initial = captureModuleResult();

    let definitionKey = `${
      trimExecutableExtension(new URL(moduleURL)).href
    }/Person`;
    let initialEntry = initial.model.definitions[definitionKey];
    assert.ok(initialEntry, 'initial definition exists');
    assert.strictEqual(
      initialEntry?.type,
      'definition',
      'initial definition entry present',
    );
    assert.strictEqual(
      initialEntry?.type === 'definition'
        ? initialEntry.definition.displayName
        : undefined,
      'Person',
      'initial display name recorded',
    );

    await adapter.write(
      'person.gts',
      `
      import { CardDef, field, contains, StringField } from 'https://cardstack.com/base/card-api';

      export class Person extends CardDef {
        static displayName = 'Updated Person';
        @field name = contains(StringField);
      }
    `,
    );
    realm.__testOnlyClearCaches();

    await visit(modulePath(moduleURL));
    let cached = captureModuleResult();
    let cachedEntry = cached.model.definitions[definitionKey];
    assert.ok(cachedEntry, 'cached definition exists');
    assert.strictEqual(
      cachedEntry?.type,
      'definition',
      'cached definition entry present',
    );
    assert.strictEqual(
      cachedEntry?.type === 'definition'
        ? cachedEntry.definition.displayName
        : undefined,
      'Person',
      'cache retains original display name without clearCache flag',
    );

    let clearOptionsSegment = encodeURIComponent(
      JSON.stringify({ clearCache: true } as RenderRouteOptions),
    );

    await visit(modulePath(moduleURL, 1, clearOptionsSegment));
    let updated = captureModuleResult();
    let updatedEntry = updated.model.definitions[definitionKey];
    assert.ok(updatedEntry, 'updated definition exists');
    assert.strictEqual(
      updatedEntry?.type,
      'definition',
      'updated definition entry present',
    );
    assert.strictEqual(
      updatedEntry?.type === 'definition'
        ? updatedEntry.definition.displayName
        : undefined,
      'Updated Person',
      'updated display name observed after clearCache flag',
    );
  });
});
