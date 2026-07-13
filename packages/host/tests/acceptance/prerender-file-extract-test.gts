import type Transition from '@ember/routing/transition';
import { visit, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  baseRealm,
  buildToolFunctionNameFromResolvedRef,
  type FileExtractResponse,
  type RenderRouteOptions,
  type ResolvedCodeRef,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import type RenderFileExtractRoute from '@cardstack/host/routes/render/file-extract';
import type RenderStoreService from '@cardstack/host/services/render-store';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | prerender | file-extract', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const renderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/file-extract`;

  const fileDefCodeRef = (
    moduleName: string,
    name: string,
  ): ResolvedCodeRef => ({
    module: new URL(moduleName, testRealmURL).href as RealmResourceIdentifier,
    name,
  });

  const fileURL = (path: string) => new URL(path, testRealmURL).href;

  async function captureFileExtractResult(
    expectedStatus?: 'ready' | 'error',
  ): Promise<FileExtractResponse> {
    await waitUntil(
      () => {
        let container = document.querySelector(
          '[data-prerender-file-extract]',
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        let status = container.getAttribute(
          'data-prerender-file-extract-status',
        );
        if (!status) {
          return false;
        }
        if (expectedStatus && status !== expectedStatus) {
          return false;
        }
        return status === 'ready' || status === 'error';
      },
      { timeout: 5000 },
    );

    let container = document.querySelector(
      '[data-prerender-file-extract]',
    ) as HTMLElement | null;
    if (!container) {
      throw new Error(
        'captureFileExtractResult: missing [data-prerender-file-extract] container after wait',
      );
    }
    let pre = container.querySelector('pre');
    let text = pre?.textContent?.trim() ?? '';
    return JSON.parse(text) as FileExtractResponse;
  }

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'filedef-success.gts': `
          import { FileDef as BaseFileDef } from "${baseRealm.url}file-api";

          export class SuccessDef extends BaseFileDef {
            static async extractAttributes(url) {
              return {
                url,
                name: "custom-success",
                contentType: "text/plain",
                custom: true,
              };
            }
          }
        `,
          'filedef-mismatch.gts': `
          import {
            FileDef as BaseFileDef,
            FileContentMismatchError,
          } from "${baseRealm.url}file-api";

          export class MismatchDef extends BaseFileDef {
            static async extractAttributes() {
              throw new FileContentMismatchError("content mismatch");
            }
          }
        `,
          'filedef-throws.gts': `
          import { FileDef as BaseFileDef } from "${baseRealm.url}file-api";

          export class ThrowingDef extends BaseFileDef {
            static async extractAttributes() {
              throw new Error("boom");
            }
          }
        `,
          'filedef-missing.gts': `
          export const NotFileDef = {};
        `,
          'filedef-passthrough.gts': `
          import { FileDef as BaseFileDef } from "${baseRealm.url}file-api";

          // Inherits the base extractAttributes unchanged, so it exercises the
          // base hash/size handling (including the provided-options shortcut).
          export class PassthroughDef extends BaseFileDef {}
        `,
          'greet-tool.ts': `
          import { Command } from '@cardstack/runtime-common';
          import { CardDef, field, contains } from "${baseRealm.url}card-api";
          import StringField from "${baseRealm.url}string";

          export class GreetInput extends CardDef {
            @field greeting = contains(StringField);
          }

          export default class GreetCommand extends Command {
            description = 'Sends a greeting';

            async getInputType() {
              return GreetInput;
            }

            async run() {
              return undefined;
            }
          }
        `,
          'skills/greeting/SKILL.md': `---
name: greeting
description: A skill that greets
boxel:
  kind: skill
  tools:
    - codeRef:
        module: ../../greet-tool
        name: default
      requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/switch-submode'
        name: default
---
# Greeting

Greets people.
`,
          'skills/broken-tool/SKILL.md': `---
name: broken-tool
boxel:
  kind: skill
  tools:
    - codeRef:
        module: ./missing-tool
        name: default
    - codeRef:
        module: ../../greet-tool
        name: default
---
# Broken Tool

One of my tools does not exist.
`,
          'recipe.md': `---
name: pasta
boxel:
  kind: recipe
  tools:
    - codeRef:
        module: ../greet-tool
        name: default
---
# Pasta
`,
          'sample.txt': 'hello world',
          'mismatch.txt': 'mismatch content',
        },
      });
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('returns an error when the render model is missing', async function (assert) {
    let route = this.owner.lookup(
      'route:render/file-extract',
    ) as RenderFileExtractRoute;
    (route as any).modelFor = () => undefined;
    delete (globalThis as any).__renderModel;

    let result = await route.model({}, {} as Transition);
    assert.strictEqual(result.status, 'error');
    assert.ok(result.error, 'includes a render error');
  });

  test('returns an error when fileExtract is not enabled', async function (assert) {
    let route = this.owner.lookup(
      'route:render/file-extract',
    ) as RenderFileExtractRoute;
    let aborted = false;
    let transition = { abort: () => (aborted = true) } as unknown as Transition;
    (route as any).modelFor = () => undefined;
    (globalThis as any).__renderModel = {
      cardId: fileURL('sample.txt'),
      nonce: '0',
      renderOptions: { clearCache: true },
    };

    let result = await route.model({}, transition);
    assert.ok(aborted, 'aborts the transition');
    assert.strictEqual(result.status, 'error');
    assert.ok(result.error, 'includes a render error');
  });

  test('uses the provided FileDef to extract attributes', async function (assert) {
    let url = fileURL('sample.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: fileDefCodeRef('filedef-success', 'SuccessDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.searchDoc?.custom, 'uses custom extractor');
    assert.ok(
      result.deps.includes(
        fileDefCodeRef('filedef-success', 'SuccessDef').module,
      ),
      'deps include custom file def module',
    );
  });

  test('uses the provided contentHash and contentSize without re-reading the file', async function (assert) {
    // The indexer forwards the realm's already-persisted hash/size so the base
    // FileDef.extractAttributes skips its buffered MD5/size pass. Sentinel
    // values that deliberately do NOT match 'hello world' prove they are used
    // verbatim — a recompute would yield the real md5 and a size of 11.
    let url = fileURL('sample.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: fileDefCodeRef('filedef-passthrough', 'PassthroughDef'),
        fileContentHash: 'sentinel-content-hash',
        fileContentSize: 4242,
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.searchDoc?.contentHash,
      'sentinel-content-hash',
      'uses the provided content hash instead of recomputing it',
    );
    assert.strictEqual(
      result.searchDoc?.contentSize,
      4242,
      'uses the provided content size instead of re-reading the file',
    );
  });

  test('falls back when the FileDef module is missing extractAttributes', async function (assert) {
    let url = fileURL('sample.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: fileDefCodeRef('filedef-missing', 'MissingDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.name, 'sample.txt');
    assert.ok(result.error, 'includes the original extraction error');
  });

  test('falls back and marks mismatch when the extractor signals a content mismatch', async function (assert) {
    let url = fileURL('mismatch.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: fileDefCodeRef('filedef-mismatch', 'MismatchDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(result.mismatch, 'sets mismatch flag');
    assert.ok(result.error, 'includes the original extraction error');
  });

  test('stamps LLM tool definitions onto a skill file-meta resource', async function (assert) {
    let url = fileURL('skills/greeting/SKILL.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: {
          module: `${baseRealm.url}markdown-file-def`,
          name: 'MarkdownDef',
        } as ResolvedCodeRef,
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.toolSchemaErrors,
      undefined,
      'no tool schema errors',
    );

    let tools = (result.resource?.attributes as Record<string, any>)
      ?.frontmatter?.tools;
    assert.strictEqual(tools?.length, 2, 'both tools are stamped');

    let realmToolModule = fileURL('greet-tool');
    let expectedRealmFn = buildToolFunctionNameFromResolvedRef({
      module: realmToolModule,
      name: 'default',
    });
    let [realmTool, hostTool] = tools;
    assert.strictEqual(
      realmTool.codeRef.module,
      realmToolModule,
      'relative tool module is resolved absolute against the skill URL',
    );
    assert.strictEqual(realmTool.codeRef.name, 'default');
    assert.strictEqual(realmTool.functionName, expectedRealmFn);
    assert.false(realmTool.requiresApproval, 'authored false is preserved');
    assert.strictEqual(realmTool.tool.type, 'function');
    assert.strictEqual(realmTool.tool.function.name, expectedRealmFn);
    assert.strictEqual(realmTool.tool.function.description, 'Sends a greeting');
    assert.ok(
      realmTool.tool.function.parameters.properties.attributes.properties
        .greeting,
      'generated schema carries the input card fields',
    );

    let hostToolModule = '@cardstack/boxel-host/tools/switch-submode';
    assert.strictEqual(
      hostTool.codeRef.module,
      hostToolModule,
      'package specifier passes through verbatim',
    );
    assert.strictEqual(
      hostTool.functionName,
      buildToolFunctionNameFromResolvedRef({
        module: hostToolModule,
        name: 'default',
      }),
    );
    assert.true(
      hostTool.requiresApproval,
      'absent requiresApproval stamps as true',
    );
    assert.ok(
      hostTool.tool.function.parameters.properties.attributes.properties
        .submode,
      'host tool schema carries its input card fields',
    );

    let searchDocTools = (result.searchDoc as Record<string, any>)?.frontmatter
      ?.tools;
    assert.strictEqual(
      searchDocTools?.[0]?.codeRef?.module,
      '../../greet-tool',
      'search doc keeps the tools as authored',
    );
    assert.false(
      'tool' in searchDocTools[0],
      'generated schemas stay out of the search doc',
    );
    assert.false(
      'functionName' in searchDocTools[0],
      'stamped functionName stays out of the search doc',
    );

    assert.ok(
      result.deps.includes(realmToolModule),
      'realm-hosted tool module is a runtime dependency of the extract',
    );
  });

  test('a broken tool ref indexes the remaining tools and reports a tool schema error', async function (assert) {
    let url = fileURL('skills/broken-tool/SKILL.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: {
          module: `${baseRealm.url}markdown-file-def`,
          name: 'MarkdownDef',
        } as ResolvedCodeRef,
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready', 'extract still succeeds');

    assert.strictEqual(result.toolSchemaErrors?.length, 1);
    let [toolError] = result.toolSchemaErrors!;
    assert.strictEqual(
      toolError.module,
      fileURL('skills/broken-tool/missing-tool'),
      'error names the resolved module',
    );
    assert.strictEqual(toolError.name, 'default');
    assert.ok(toolError.message, 'error carries a message');

    let tools = (result.resource?.attributes as Record<string, any>)
      ?.frontmatter?.tools;
    assert.strictEqual(tools?.length, 2, 'both tools stay in the list');
    assert.strictEqual(
      tools[0].codeRef.module,
      './missing-tool',
      'failed tool entry stays as authored',
    );
    assert.strictEqual(
      tools[0].tool,
      undefined,
      'failed tool entry has no schema',
    );
    assert.ok(tools[1].tool, 'the remaining tool still enriches');
    assert.strictEqual(
      tools[1].functionName,
      buildToolFunctionNameFromResolvedRef({
        module: fileURL('greet-tool'),
        name: 'default',
      }),
    );
  });

  test('a non-skill markdown file is not enriched even when it declares tools', async function (assert) {
    let url = fileURL('recipe.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: {
          module: `${baseRealm.url}markdown-file-def`,
          name: 'MarkdownDef',
        } as ResolvedCodeRef,
      }),
    );
    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(
      result.toolSchemaErrors,
      undefined,
      'no tool schema errors',
    );
    // A non-skill kind keeps only the raw frontmatter (no typed `tools`
    // field), and the kind gate skips enrichment before ever looking.
    let frontmatter = (result.resource?.attributes as Record<string, any>)
      ?.frontmatter;
    assert.strictEqual(
      frontmatter?.tools,
      undefined,
      'no typed tools on a non-skill file',
    );
    assert.strictEqual(
      frontmatter?.rawContent?.boxel?.tools?.[0]?.codeRef?.module,
      '../greet-tool',
      'raw frontmatter is preserved as authored',
    );
  });

  test('returns an error when the file fetch fails', async function (assert) {
    let url = fileURL('missing.txt');
    await visit(renderPath(url, { fileExtract: true }));
    let result = await captureFileExtractResult('error');
    assert.strictEqual(result.status, 'error');
    assert.ok(result.error, 'includes a render error');
  });

  test('blocks saves while file-extract is active', async function (assert) {
    let renderStore = this.owner.lookup(
      'service:render-store',
    ) as RenderStoreService;
    let savedUrls: string[] = [];
    renderStore._onSave((url) => savedUrls.push(url.href));

    await visit(renderPath(fileURL('sample.txt'), { fileExtract: true }));

    let patchResult = await renderStore.patch(
      fileURL('ModelConfiguration/test-gpt'),
      {
        attributes: { modelId: 'openai/gpt-5' },
      },
    );

    assert.strictEqual(
      patchResult,
      undefined,
      'patch is ignored during file-extract render context',
    );
    assert.deepEqual(savedUrls, [], 'does not emit save events');

    renderStore._unregisterSaveSubscriber();
  });
});
