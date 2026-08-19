import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import EvaluateModuleTool from '@cardstack/host/tools/evaluate-module';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const VALID_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class ValidCard extends CardDef {
    static displayName = 'Valid Card';
    @field name = contains(StringField);
  }
`;

const BROKEN_IMPORT_MODULE = `
  import { CardDef, field, contains } from "@cardstack/base/card-api";
  import { Foo } from "./does-not-exist";
  export class BrokenImportCard extends CardDef {
    static displayName = 'Broken Import Card';
    @field brokenField = contains(Foo);
  }
`;

module('Integration | tools | evaluate-module', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'valid-card.gts': VALID_MODULE,
          'broken-import-card.gts': BROKEN_IMPORT_MODULE,
        },
      });
    });
  });

  test('valid module passes evaluation', async function (assert) {
    let toolService = getService('tool-service');
    let command = new EvaluateModuleTool(toolService.toolContext);

    let InputType = await command.getInputType();
    let input = new InputType({
      moduleIdentifier: `${testRealmURL}valid-card`,
      realmIdentifier: testRealmURL,
    });

    let result = await command.execute(input);

    assert.true(result.passed, 'valid module should pass');
    assert.notOk(result.error, 'no error for valid module');
  });

  test('module with broken import fails evaluation', async function (assert) {
    let toolService = getService('tool-service');
    let command = new EvaluateModuleTool(toolService.toolContext);

    let InputType = await command.getInputType();
    let input = new InputType({
      moduleIdentifier: `${testRealmURL}broken-import-card`,
      realmIdentifier: testRealmURL,
    });

    let result = await command.execute(input);

    assert.false(result.passed, 'broken import module should fail');
    assert.ok(result.error, 'should have an error message');
  });
});
