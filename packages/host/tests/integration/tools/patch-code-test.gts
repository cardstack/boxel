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

import { Submodes } from '@cardstack/host/components/submode-switcher';
import CodePreviewSandbox from '@cardstack/host/lib/code-preview-sandbox';
import { opaqueRealmCardState } from '@cardstack/host/lib/realm-sandbox-boundary';
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

import type { BaseDef } from '@cardstack/base/card-api';

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

  test('publishes a coherent patch before remote lint completes', async function (assert) {
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);
    let realmSandbox = getService('realm-sandbox');
    let preview = new CodePreviewSandbox();
    let lintStarted = new Deferred<void>();
    let releaseLint = new Deferred<void>();
    let locallyApplied = new Deferred<void>();
    let trackedBeforeLocalApply = false;
    let originalTrack =
      toolService.trackAiAssistantCardRequest.bind(toolService);
    toolService.trackAiAssistantCardRequest = (args) => {
      trackedBeforeLocalApply = true;
      return originalTrack(args);
    };
    patchCodeCommand.onLocallyApplied = () => locallyApplied.fulfill();

    adapter.lintStub = async (
      request: Request,
      _requestContext: any,
    ): Promise<LintResult> => {
      lintStarted.fulfill();
      await releaseLint.promise;
      return {
        output: `// linted\n${await request.text()}`,
        fixed: true,
        messages: [],
      };
    };

    realmSandbox.seedCodePreviewSource(
      preview,
      fileUrl,
      (await getService('card-service').getSource(new URL(fileUrl))).content,
    );

    const codeBlock = `${SEARCH_MARKER}
  static displayName = 'Task';
${SEPARATOR_MARKER}
  static displayName = 'Instant Task';
${REPLACE_MARKER}`;

    try {
      let execution = patchCodeCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: [codeBlock],
      });
      await lintStarted.promise;
      await locallyApplied.promise;

      assert.true(
        trackedBeforeLocalApply,
        'the canonical invalidation is tracked before local completion is exposed',
      );
      assert.true(
        preview.source?.includes("displayName = 'Instant Task'"),
        'the preview receives the patch while lint is still pending',
      );

      releaseLint.fulfill();
      let result = await execution;
      assert.true(
        result.patchedContent.startsWith('// linted'),
        'the canonical result still includes lint fixes',
      );
      assert.strictEqual(
        preview.source,
        result.patchedContent,
        'the preview advances to the linted generation before persistence',
      );
    } finally {
      toolService.trackAiAssistantCardRequest = originalTrack;
      releaseLint.fulfill();
      realmSandbox.releaseCodePreviewSandbox(preview);
    }
  });

  test('a late older lint result cannot roll back a newer patch generation', async function (assert) {
    let toolService = getService('tool-service');
    let firstCommand = new PatchCodeTool(toolService.toolContext);
    let secondCommand = new PatchCodeTool(toolService.toolContext);
    let realmSandbox = getService('realm-sandbox');
    let cardService = getService('card-service');
    let preview = new CodePreviewSandbox();
    let firstLintStarted = new Deferred<void>();
    let releaseFirstLint = new Deferred<void>();
    let savedSources: string[] = [];

    adapter.lintStub = async (request: Request): Promise<LintResult> => {
      let source = await request.text();
      if (source.includes("displayName = 'First Task'")) {
        firstLintStarted.fulfill();
        await releaseFirstLint.promise;
        return {
          output: `// linted first\n${source}`,
          fixed: true,
          messages: [],
        };
      }
      return {
        output: `// linted second\n${source}`,
        fixed: true,
        messages: [],
      };
    };

    cardService._onSave((_url, content) => {
      if (typeof content === 'string') {
        savedSources.push(content);
      }
    });
    realmSandbox.seedCodePreviewSource(
      preview,
      fileUrl,
      (await cardService.getSource(new URL(fileUrl))).content,
    );

    let firstBlock = `${SEARCH_MARKER}
  static displayName = 'Task';
${SEPARATOR_MARKER}
  static displayName = 'First Task';
${REPLACE_MARKER}`;
    let secondBlock = `${SEARCH_MARKER}
  static displayName = 'First Task';
${SEPARATOR_MARKER}
  static displayName = 'Second Task';
${REPLACE_MARKER}`;

    try {
      let firstExecution = firstCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: [firstBlock],
      });
      await firstLintStarted.promise;

      await secondCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: [secondBlock],
      });
      await waitUntil(() =>
        savedSources.some((source) =>
          source.includes("displayName = 'Second Task'"),
        ),
      );
      assert.ok(
        preview.source?.includes("displayName = 'Second Task'"),
        'the newer patch reaches the preview while the older lint is pending',
      );

      releaseFirstLint.fulfill();
      await firstExecution;

      assert.ok(
        preview.source?.includes("displayName = 'Second Task'"),
        'the late older lint result cannot replace the newer preview source',
      );
      assert.false(
        savedSources.some(
          (source) =>
            source.includes("displayName = 'First Task'") &&
            !source.includes("displayName = 'Second Task'"),
        ),
        'the late older lint result is never persisted',
      );
    } finally {
      releaseFirstLint.fulfill();
      cardService._unregisterSaveSubscriber();
      realmSandbox.releaseCodePreviewSandbox(preview);
    }
  });

  test('a Monaco generation published during lint cannot be rolled back by that lint result', async function (assert) {
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);
    let realmSandbox = getService('realm-sandbox');
    let cardService = getService('card-service');
    let preview = new CodePreviewSandbox();
    let lintStarted = new Deferred<void>();
    let releaseLint = new Deferred<void>();
    let savedSources: string[] = [];

    adapter.lintStub = async (request: Request): Promise<LintResult> => {
      let source = await request.text();
      lintStarted.fulfill();
      await releaseLint.promise;
      return {
        output: `// linted AI patch\n${source}`,
        fixed: true,
        messages: [],
      };
    };

    cardService._onSave((_url, content) => {
      if (typeof content === 'string') {
        savedSources.push(content);
      }
    });
    let canonicalSource = (await cardService.getSource(new URL(fileUrl)))
      .content;
    realmSandbox.seedCodePreviewSource(preview, fileUrl, canonicalSource);

    let codeBlock = `${SEARCH_MARKER}
  static displayName = 'Task';
${SEPARATOR_MARKER}
  static displayName = 'AI Task';
${REPLACE_MARKER}`;

    try {
      let execution = patchCodeCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: [codeBlock],
      });
      await lintStarted.promise;

      let monacoSource = canonicalSource.replace(
        "static displayName = 'Task'",
        "static displayName = 'Monaco Task'",
      );
      realmSandbox.publishCodePreviewSource(preview, fileUrl, monacoSource);
      assert.ok(
        preview.source?.includes("displayName = 'Monaco Task'"),
        'the local Monaco generation immediately replaces the pending AI generation',
      );

      releaseLint.fulfill();
      await execution;

      assert.strictEqual(
        preview.source,
        monacoSource,
        'the late lint output cannot replace the newer Monaco generation',
      );
      assert.deepEqual(
        savedSources,
        [],
        'the stale lint output is not persisted after Monaco publishes newer source',
      );
    } finally {
      releaseLint.fulfill();
      cardService._unregisterSaveSubscriber();
      realmSandbox.releaseCodePreviewSandbox(preview);
    }
  });

  test('canonical source writes for one module reach the realm in invocation order', async function (assert) {
    let cardService = getService('card-service');
    let network = getService('network');
    let originalAuthedFetch = network.authedFetch;
    let firstWriteStarted = new Deferred<void>();
    let releaseFirstWrite = new Deferred<void>();
    let receivedSources: string[] = [];

    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (...args: Parameters<typeof originalAuthedFetch>) => {
        let [input, init] = args;
        let requestURL =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : input;
        if (requestURL === fileUrl && init?.method === 'POST') {
          let source = String(init.body);
          receivedSources.push(source);
          if (source === 'GENERATION ONE') {
            firstWriteStarted.fulfill();
            await releaseFirstWrite.promise;
          }
          return new Response(null, { status: 204 });
        }
        return originalAuthedFetch(...args);
      },
    });

    try {
      let firstWrite = cardService.saveSource(
        new URL(fileUrl),
        'GENERATION ONE',
        'bot-patch',
      );
      await firstWriteStarted.promise;
      let secondWrite = cardService.saveSource(
        new URL(fileUrl),
        'GENERATION TWO',
        'bot-patch',
      );
      await Promise.resolve();
      assert.deepEqual(
        receivedSources,
        ['GENERATION ONE'],
        'the newer request waits while the older write is in flight',
      );

      releaseFirstWrite.fulfill();
      await Promise.all([firstWrite, secondWrite]);
      assert.deepEqual(
        receivedSources,
        ['GENERATION ONE', 'GENERATION TWO'],
        'the realm receives source generations in invocation order',
      );
    } finally {
      releaseFirstWrite.fulfill();
      delete (network as { authedFetch?: typeof originalAuthedFetch })
        .authedFetch;
    }
  });

  test('uses the open file resource when the target file is open', async function (assert) {
    assert.expect(11);

    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);
    let operatorModeStateService = getService('operator-mode-state-service');
    let cardService = getService('card-service');
    let realmSandbox = getService('realm-sandbox');

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
    let preview = new CodePreviewSandbox();
    realmSandbox.seedCodePreviewSource(
      preview,
      fileUrl,
      (openFileResource as Ready).content,
    );
    assert.strictEqual(
      realmSandbox.prepareCodePreviewCommit(
        preview,
        fileUrl,
        (openFileResource as Ready).content,
        'editor',
      ),
      undefined,
      'initial editor hydration does not make the module volatile',
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
      assert.ok(
        preview.source?.includes('High Priority'),
        'the first completed block publishes directly to the active preview',
      );
      let chainedCodeBlock = `${SEARCH_MARKER}
      <p>High Priority</p>
${SEPARATOR_MARKER}
      <p>Critical Priority</p>
${REPLACE_MARKER}`;
      await patchCodeCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: [chainedCodeBlock],
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
      assert.ok(
        latestResource.content.includes('Critical Priority'),
        'a second streamed block composes onto the staged first block',
      );
      assert.ok(
        preview.source?.includes('Critical Priority'),
        'the second completed block advances the same preview source',
      );
      deferredSave.fulfill();
      await latestResource.writing;
      assert.ok(
        latestResource.content.includes('Critical Priority'),
        'patched content is reflected in the open file resource',
      );
      assert.strictEqual(
        saveCalls,
        2,
        'each completed streamed block starts one realm save',
      );
    } finally {
      realmSandbox.releaseCodePreviewSandbox(preview);
      cardService.saveSource = originalSaveSource;
      operatorModeStateService.restore({ stacks: [[]] });
    }
  });

  test('[NAV-08][HMR-02] assistant patches make a mounted Interact card volatile and reuse its preview loader', async function (assert) {
    let toolService = getService('tool-service');
    let patchCodeCommand = new PatchCodeTool(toolService.toolContext);
    let operatorModeStateService = getService('operator-mode-state-service');
    let realmSandbox = getService('realm-sandbox');
    operatorModeStateService.restore({
      stacks: [[]],
      submode: Submodes.Interact,
    });

    adapter.lintStub = async (request: Request): Promise<LintResult> => ({
      output: await request.text(),
      fixed: false,
      messages: [],
    });

    let interactCard = {} as BaseDef;
    Object.defineProperty(interactCard, opaqueRealmCardState, {
      value: {
        typeRef: { module: fileUrl, name: 'Task' },
        principal: testRealmURL,
        document: { data: { type: 'card', attributes: {} } },
        snapshot: {},
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });
    let unregister = realmSandbox.registerInteractiveCodePreview(interactCard);

    let firstBlock = `${SEARCH_MARKER}
  static displayName = 'Task';
${SEPARATOR_MARKER}
  static displayName = 'Interactive Task';
${REPLACE_MARKER}`;
    let secondBlock = `${SEARCH_MARKER}
  static displayName = 'Interactive Task';
${SEPARATOR_MARKER}
  static displayName = 'Live Interactive Task';
${REPLACE_MARKER}`;

    try {
      assert.strictEqual(
        realmSandbox.interactiveCodePreviewFor(interactCard),
        undefined,
        'viewing a stable Interact card does not allocate a preview loader',
      );
      await patchCodeCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: [firstBlock],
      });
      let preview = realmSandbox.interactiveCodePreviewFor(interactCard);
      assert.ok(preview, 'the first assistant mutation allocates a preview');
      assert.ok(
        preview?.source?.includes("displayName = 'Interactive Task'"),
        'the Interact preview receives the first generation immediately',
      );
      let firstRevision = preview?.revision;

      await patchCodeCommand.execute({
        fileIdentifier: fileUrl,
        codeBlocks: [secondBlock],
      });
      let updatedPreview = realmSandbox.interactiveCodePreviewFor(interactCard);
      assert.strictEqual(
        updatedPreview,
        preview,
        'subsequent patches reuse the same private preview loader',
      );
      assert.ok(
        updatedPreview?.source?.includes(
          "displayName = 'Live Interactive Task'",
        ),
        'the second block composes from the volatile first generation',
      );
      assert.ok(
        (updatedPreview?.revision ?? 0) > (firstRevision ?? 0),
        'the mounted Interact preview advances generations',
      );
      assert.strictEqual(
        operatorModeStateService.state.submode,
        Submodes.Interact,
        'the patch does not switch the operator into Code mode',
      );
    } finally {
      unregister();
      operatorModeStateService.restore({ stacks: [[]] });
    }
    assert.strictEqual(
      realmSandbox.interactiveCodePreviewFor(interactCard),
      undefined,
      'the private Interact preview is released after unmount',
    );
  });

  test('[HMR-03][HMR-04] out-of-band module writes HMR only displayed cards until they unload', async function (assert) {
    let realmSandbox = getService('realm-sandbox');
    let cardService = getService('card-service');
    let originalGetSource = cardService.getSource;
    let externalSource = `export class Task { static displayName = 'CLI One'; }`;
    cardService.getSource = async () => ({
      status: 200,
      content: externalSource,
      contentType: 'text/plain',
    });

    let interactCard = {} as BaseDef;
    Object.defineProperty(interactCard, opaqueRealmCardState, {
      value: {
        typeRef: { module: fileUrl, name: 'Task' },
        principal: testRealmURL,
        document: { data: { type: 'card', attributes: {} } },
        snapshot: {},
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });
    let unregister = realmSandbox.registerInteractiveCodePreview(interactCard);

    try {
      assert.true(
        realmSandbox.handleExternalModuleInvalidations([fileUrl]),
        'a displayed module claims the external invalidation',
      );
      await waitUntil(
        () =>
          realmSandbox.interactiveCodePreviewFor(interactCard)?.source ===
          externalSource,
      );
      let preview = realmSandbox.interactiveCodePreviewFor(interactCard);
      assert.ok(preview, 'the external write allocates a private preview');
      assert.true(
        realmSandbox.isUsingExternalModuleHMR(fileUrl),
        'external HMR remains leased while the card is displayed',
      );

      externalSource = `export class Task { static displayName = 'CLI Two'; }`;
      assert.true(
        realmSandbox.handleExternalModuleInvalidations([fileUrl]),
        'a later CLI write reuses the displayed-module path',
      );
      await waitUntil(
        () =>
          realmSandbox.interactiveCodePreviewFor(interactCard)?.source ===
          externalSource,
      );
      assert.strictEqual(
        realmSandbox.interactiveCodePreviewFor(interactCard),
        preview,
        'successive external writes keep the same private loader',
      );
      assert.false(
        realmSandbox.handleExternalModuleInvalidations([
          `${testRealmURL}not-displayed.gts`,
        ]),
        'an undisplayed module keeps the canonical loader invalidation path',
      );
      let partition = realmSandbox.handleExternalModuleInvalidationPartition([
        fileUrl,
        `${testRealmURL}not-displayed.gts`,
      ]);
      assert.deepEqual(
        [...partition],
        [fileUrl],
        'a mixed event claims only the displayed module for private HMR',
      );
    } finally {
      unregister();
      cardService.getSource = originalGetSource;
    }

    assert.false(
      realmSandbox.isUsingExternalModuleHMR(fileUrl),
      'the external HMR lease ends when the card unloads',
    );
  });

  test('commits each newly-complete search/replace block as its own generation', async function (assert) {
    let toolService = getService('tool-service');
    let originalPatchCode = toolService.patchCode;
    let calls: Array<{ fileUrl: string; indexes: number[] }> = [];
    toolService.patchCode = async (_roomId, targetUrl, patches) => {
      calls.push({
        fileUrl: targetUrl!,
        indexes: patches.map((patch) => patch.codeBlockIndex),
      });
    };

    let completeBlock = `${SEARCH_MARKER}
old
${SEPARATOR_MARKER}
new
${REPLACE_MARKER}`;
    try {
      await toolService.executeReadyCodePatches('!streaming-room', [
        {
          codeData: {
            fileUrl,
            isNewFile: false,
            code: null,
            language: 'typescript',
            searchReplaceBlock: completeBlock,
            roomId: '!streaming-room',
            eventId: '$streaming-event',
            codeBlockIndex: 0,
          },
        },
        {
          codeData: {
            fileUrl,
            isNewFile: false,
            code: null,
            language: 'typescript',
            searchReplaceBlock: completeBlock,
            roomId: '!streaming-room',
            eventId: '$streaming-event',
            codeBlockIndex: 1,
          },
        },
      ]);
    } finally {
      toolService.patchCode = originalPatchCode;
    }

    assert.deepEqual(calls, [
      { fileUrl, indexes: [0] },
      { fileUrl, indexes: [1] },
    ]);
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
});
