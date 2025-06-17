import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
} from '@cardstack/runtime-common';

import { LintResult } from '@cardstack/runtime-common/lint';

import PatchCodeCommand from '@cardstack/host/commands/patch-code';

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

  hooks.beforeEach(async function () {
    let { adapter } = await setupIntegrationTestRealm({
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
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field priority = contains(NumberField);
}`,
      },
    });
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
  @field title = contains(StringField);
  @field description = contains(StringField);
  @field priority = contains(NumberField);
  <template>
    {{#if (eq priority 1)}}
      <p>High Priority</p>
    {{/if}}
  </template>
}`;
    assert.strictEqual(result.patchedContent, expectedResult);
  });
});
