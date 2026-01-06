import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  Deferred,
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  type LintResult,
} from '@cardstack/runtime-common';

import PatchCodeCommand from '@cardstack/host/commands/patch-code';
import { Submodes } from '@cardstack/host/components/submode-switcher';
import { isReady, type Ready } from '@cardstack/host/resources/file';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | patch-code', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });

  const testFileName = 'task.gts';
  const fileUrl = `${testRealmURL}${testFileName}`;
  let adapter: any;

  hooks.beforeEach(async function () {
    let realmSetup = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        [testFileName]: `import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
export class Task extends CardDef {
  static displayName = 'Task';
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field priority = contains(NumberField);
}`,
      },
    });
    adapter = realmSetup.adapter;
    adapter.lintStub = async (
      request: Request,
      _requestContext: any,
    ): Promise<LintResult> => {
      return {
        output:
          "import { eq } from '@cardstack/boxel-ui/helpers';\n" +
          (await request.text()),
        fixed: true,
        messages: [],
      };
    };
    let realmService = getService('realm');
    await realmService.login(testRealmURL);
  });

  test('lint-fixes contents before returning them', async function (assert) {
    let commandService = getService('command-service');
    let patchCodeCommand = new PatchCodeCommand(commandService.commandContext);

    // Set up a custom lintStub that verifies the filename header
    adapter.lintStub = async (
      request: Request,
      _requestContext: any,
    ): Promise<LintResult> => {
      // Verify that X-Filename header is passed correctly
      const filename = request.headers.get('X-Filename');
      assert.strictEqual(
        filename,
        testFileName,
        'X-Filename header should be set correctly',
      );

      return {
        output:
          "import { eq } from '@cardstack/boxel-ui/helpers';\n" +
          (await request.text()),
        fixed: true,
        messages: [],
      };
    };

    // note that `eq` import will be missing after this is applied
    const codeBlock = `${SEARCH_MARKER}
  @field priority = contains(NumberField);
${SEPARATOR_MARKER}
  @field priority = contains(NumberField);
  <template>
    {{#if (eq priority 1)}}
      <p>High Priority</p>
    {{/if}}
  </template>
${REPLACE_MARKER}`;

    let result = await patchCodeCommand.execute({
      fileUrl,
      codeBlocks: [codeBlock],
    });

    const expectedResult = `import { eq } from '@cardstack/boxel-ui/helpers';
import {
  contains,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
export class Task extends CardDef {
  static displayName = 'Task';
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field priority = contains(NumberField);
  <template>
    {{#if (eq priority 1)}}
      <p>High Priority</p>
    {{/if}}
  </template>
}`;
    assert.strictEqual(result.patchedContent, expectedResult);
  });

  test('uses the open file resource when the target file is open', async function (assert) {
    assert.expect(7);

    let commandService = getService('command-service');
    let patchCodeCommand = new PatchCodeCommand(commandService.commandContext);
    let operatorModeStateService = getService('operator-mode-state-service');
    let cardService = getService('card-service');

    operatorModeStateService.restore({
      stacks: [[]],
      submode: Submodes.Code,
      codePath: fileUrl,
    });

    await waitUntil(() => isReady(operatorModeStateService.openFile?.current));

    let openFileResource = operatorModeStateService.openFile?.current;
    assert.ok(openFileResource, 'open file resource exists');
    assert.ok(
      isReady(openFileResource),
      'open file resource is ready before patch',
    );

    let deferredSave = new Deferred<void>();
    let saveCalls = 0;
    let originalSaveSource = cardService.saveSource;
    cardService.saveSource = async (
      ...args: Parameters<typeof originalSaveSource>
    ) => {
      saveCalls++;
      await deferredSave.promise;
      return originalSaveSource.apply(cardService, args);
    };

    const codeBlock = `${SEARCH_MARKER}
  @field priority = contains(NumberField);
${SEPARATOR_MARKER}
  @field priority = contains(NumberField);
  <template>
    {{#if (eq priority 1)}}
      <p>High Priority</p>
    {{/if}}
  </template>
${REPLACE_MARKER}`;

    try {
      await patchCodeCommand.execute({
        fileUrl,
        codeBlocks: [codeBlock],
      });
      let maybeLatestResource = operatorModeStateService.openFile?.current;
      assert.ok(maybeLatestResource, 'open file resource still exists');
      assert.ok(
        isReady(maybeLatestResource),
        'open file resource remains ready after patch',
      );
      let latestResource = maybeLatestResource as Ready;
      assert.ok(
        latestResource.writing,
        'write is initiated on the open file resource',
      );
      deferredSave.fulfill();
      await latestResource.writing;
      assert.ok(
        latestResource.content.includes('High Priority'),
        'patched content is reflected in the open file resource',
      );
      assert.strictEqual(saveCalls, 1, 'save source is invoked exactly once');
    } finally {
      cardService.saveSource = originalSaveSource;
      operatorModeStateService.restore({ stacks: [[]] });
    }
  });
});
