import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  decodeLintFilename,
  Deferred,
  LINT_FILENAME_HEADER,
  REPLACE_MARKER,
  SEARCH_MARKER,
  SEPARATOR_MARKER,
  type LintResult,
} from '@cardstack/runtime-common';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import { isReady, type Ready } from '@cardstack/host/resources/file';
import PatchCodeTool from '@cardstack/host/tools/patch-code';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | tools | patch-code', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });

  const testFileName = 'task.gts';
  const fileUrl = `${testRealmURL}${testFileName}`;
  const jsonFileName = 'task.json';
  const jsonFileUrl = `${testRealmURL}${jsonFileName}`;
  let adapter: any;

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    let realmSetup = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          [testFileName]: `import {
  contains,
  field,
  CardDef,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
export class Task extends CardDef {
  static displayName = 'Task';
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field priority = contains(NumberField);
}`,
          [jsonFileName]: `{
  "title": "Old title",
  "count": 1
}
`,
        },
      }),
    );
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
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);

    // Set up a custom lintStub that verifies the filename header
    adapter.lintStub = async (
      request: Request,
      _requestContext: any,
    ): Promise<LintResult> => {
      // The X-Filename header travels percent-encoded, so that a name outside
      // Latin-1 can be carried in a header at all. Read it back through the
      // same codec, which is what pins the name the realm sees to the name on
      // disk rather than to whichever spelling the caller happened to hold.
      const filename = decodeLintFilename(
        request.headers.get(LINT_FILENAME_HEADER),
      );
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
      fileIdentifier: fileUrl,
      codeBlocks: [codeBlock],
    });

    const expectedResult = `import { eq } from '@cardstack/boxel-ui/helpers';
import {
  contains,
  field,
  CardDef,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
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

    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);
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
        fileIdentifier: fileUrl,
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

  test('allows empty search and replace blocks via patch-code for new files', async function (assert) {
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);
    let emptyFileUrl = `${testRealmURL}empty.gts`;

    adapter.lintStub = async (request: Request): Promise<LintResult> => {
      return {
        output: await request.text(),
        fixed: false,
        messages: [],
      };
    };

    const codeBlock = `${SEARCH_MARKER}
${SEPARATOR_MARKER}
${REPLACE_MARKER}`;

    let result = await patchCodeCommand.execute({
      fileIdentifier: emptyFileUrl,
      codeBlocks: [codeBlock],
    });

    assert.strictEqual(result.finalFileIdentifier, emptyFileUrl);
    assert.strictEqual(result.patchedContent, '');
    assert.strictEqual(result.results[0]?.status, 'applied');
  });

  test('skips linting for non-gts/ts files', async function (assert) {
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);

    adapter.lintStub = async () => {
      assert.ok(false, 'lint should not run for json files');
      return { output: '', fixed: false, messages: [] };
    };

    const codeBlock = `${SEARCH_MARKER}
  "title": "Old title",
${SEPARATOR_MARKER}
  "title": "New title",
${REPLACE_MARKER}`;

    let result = await patchCodeCommand.execute({
      fileIdentifier: jsonFileUrl,
      codeBlocks: [codeBlock],
    });

    assert.strictEqual(
      result.patchedContent,
      `{
  "title": "New title",
  "count": 1
}
`,
      'json file is patched without linting',
    );
    assert.strictEqual(result.results[0]?.status, 'applied');
  });

  test('reports when the formatter reverts an applied patch and skips the save', async function (assert) {
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);

    const originalSource = `import {
  contains,
  field,
  CardDef,
  Component,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
export class Task extends CardDef {
  static displayName = 'Task';
  @field cardTitle = contains(StringField);
  @field cardDescription = contains(StringField);
  @field priority = contains(NumberField);
}`;

    // The lint/format pass undoes whatever the patch did, returning the
    // file byte-identical to what is on disk.
    adapter.lintStub = async (): Promise<LintResult> => {
      return { output: originalSource, fixed: true, messages: [] };
    };

    const codeBlock = `${SEARCH_MARKER}
  static displayName = 'Task';
${SEPARATOR_MARKER}
  static displayName = 'Task';

${REPLACE_MARKER}`;

    let result = await patchCodeCommand.execute({
      fileIdentifier: fileUrl,
      codeBlocks: [codeBlock],
    });

    assert.strictEqual(result.results[0]?.status, 'applied');
    assert.strictEqual(
      result.patchedContent,
      originalSource,
      'the formatter round-tripped the content back to the original',
    );
    assert.ok(
      result.lintIssues?.some((issue: string) =>
        issue.includes('formatter reverted the applied changes'),
      ),
      'the reverted-by-formatter notice is reported alongside lint issues',
    );
  });

  test('does not claim a formatter revert when blocks cancel out and no formatter ran', async function (assert) {
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);

    adapter.lintStub = async () => {
      assert.ok(false, 'lint should not run for json files');
      return { output: '', fixed: false, messages: [] };
    };

    // Each block changes content individually, so both apply, but together
    // they round-trip to the original file. No formatter was involved, so
    // the reverted-by-formatter notice would be a lie the model acts on.
    const blockForward = `${SEARCH_MARKER}
  "title": "Old title",
${SEPARATOR_MARKER}
  "title": "New title",
${REPLACE_MARKER}`;
    const blockBack = `${SEARCH_MARKER}
  "title": "New title",
${SEPARATOR_MARKER}
  "title": "Old title",
${REPLACE_MARKER}`;

    let result = await patchCodeCommand.execute({
      fileIdentifier: jsonFileUrl,
      codeBlocks: [blockForward, blockBack],
    });

    assert.strictEqual(result.results[0]?.status, 'applied');
    assert.strictEqual(result.results[1]?.status, 'applied');
    assert.notOk(
      result.lintIssues?.some((issue: string) =>
        issue.includes('formatter reverted'),
      ),
      'no reverted-by-formatter notice when no formatter ran',
    );
  });
});
