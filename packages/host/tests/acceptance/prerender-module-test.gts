import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealm,
  trimExecutableExtension,
  type RenderRouteOptions,
  CardError,
} from '@cardstack/runtime-common';

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

module('Acceptance | prerender | module', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const DEFAULT_MODULE_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({} as RenderRouteOptions),
  );
  const modulePath = (
    url: string,
    nonce = 0,
    optionsSegment = DEFAULT_MODULE_OPTIONS_SEGMENT,
  ) => `/module/${encodeURIComponent(url)}/${nonce}/${optionsSegment}`;

  function resetCaches(reason: string) {
    let loaderService = getService('loader-service');
    loaderService.resetLoader({
      clearFetchCache: true,
      reason,
    });
    getService('store').resetCache();
  }

  hooks.beforeEach(async function () {
    resetCaches('prerender-module-test setup');
    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    cardApi = await loader.import(`${baseRealm.url}card-api`);

    let { field, contains, CardDef, StringField } = cardApi;

    class Person extends CardDef {
      static displayName = 'Person';
      @field name = contains(StringField);
    }

    class Parent extends CardDef {
      static displayName = 'Parent';
      @field title = contains(StringField);
    }

    class Child extends Parent {
      static displayName = 'Child';
      @field nickname = contains(StringField);
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'person.gts': { Person },
        'parent.gts': { Parent },
        'child.gts': { Child },
        'broken.gts': `export const Broken = ;`,
      },
    });
  });

  hooks.afterEach(function () {
    resetCaches('prerender-module-test cleanup');
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
});
