import { module, test } from 'qunit';

import type {
  BoxelInstanceHandle,
  BoxelRenderRecord,
  LooseCardResource,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import BoxelExecutionEngine from '@cardstack/host/lib/boxel-execution-engine';
import {
  decideBoxelExecution,
  type BoxelExecutionPolicyInput,
} from '@cardstack/host/lib/boxel-execution-policy';
import type { BoxelRuntime } from '@cardstack/host/lib/boxel-runtime';
import BoxelRuntimeRouter from '@cardstack/host/lib/boxel-runtime-router';
import {
  BoxelModuleGraphClassifier,
  classifyBoxelSource,
  type BoxelSourceClassification,
} from '@cardstack/host/lib/boxel-source-classifier';

import type CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import type DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import type SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';

const capsuleSource: BoxelSourceClassification = {
  tier: 'capsule',
  reason: 'default-user-card',
  imports: [],
  signals: [],
  moduleGraph: [],
  propagatesToImporters: false,
};

const sandboxSource: BoxelSourceClassification = {
  tier: 'sandbox',
  reason: 'browser-runtime:document',
  imports: [],
  signals: ['document'],
  moduleGraph: [],
  propagatesToImporters: false,
};

function policy(
  overrides: Partial<BoxelExecutionPolicyInput> = {},
): BoxelExecutionPolicyInput {
  return {
    trusted: false,
    format: 'isolated',
    source: capsuleSource,
    prefersFullSandbox: false,
    volatile: false,
    ...overrides,
  };
}

class TestRuntime {
  destroyed = false;
  disposed: string[] = [];
  failBuild = false;
  prefersFullSandbox = false;
  createdFromSerialized = 0;
  retainedCanonical?: object;
  allowedModules: readonly string[] = [];
  private nextInstance = 0;

  constructor(readonly mode: BoxelRuntime['mode']) {}

  destroy(): void {
    this.destroyed = true;
  }

  async loadBoxel(): Promise<never> {
    throw new Error('not used');
  }
  async createFromSerialized(): Promise<BoxelInstanceHandle> {
    this.createdFromSerialized++;
    return `${this.mode}-instance:${++this.nextInstance}` as BoxelInstanceHandle;
  }
  retainCanonicalInstance(instance: object): BoxelInstanceHandle {
    this.retainedCanonical = instance;
    return `${this.mode}-instance:${++this.nextInstance}` as BoxelInstanceHandle;
  }
  async describeBoxel(): Promise<never> {
    throw new Error('not used');
  }
  async getFields(): Promise<never> {
    throw new Error('not used');
  }
  async getField(): Promise<never> {
    throw new Error('not used');
  }
  recordTamper?: (record: BoxelRenderRecord) => BoxelRenderRecord;

  async buildRenderRecord(): Promise<BoxelRenderRecord> {
    if (this.failBuild) {
      throw new Error(`${this.mode} render failed`);
    }
    let record = renderRecord(this.mode, this.prefersFullSandbox);
    return this.recordTamper ? this.recordTamper(record) : record;
  }
  async serializeCard(): Promise<never> {
    throw new Error('not used');
  }
  async serializeCardPatch(): Promise<never> {
    throw new Error('not used');
  }
  async dispose(handle: string): Promise<void> {
    this.disposed.push(handle);
  }

  allowModules(moduleIdentifiers: readonly string[]): void {
    this.allowedModules = moduleIdentifiers;
  }

  // Sandbox HMR (RP-17.1's un-deferral) test surface — only meaningfully
  // used when mode === 'sandbox'. A fake stand-in for
  // SandboxRuntimeProcess.pushDraft/reloadSandbox so BoxelExecutionSession's
  // OWN orchestration (classification, mode gating, request retention, the
  // teardown/newer-update race guard) can be tested without a real iframe.
  pushDraftCalls: {
    moduleIdentifier: string;
    source: string;
    moduleGraph: readonly string[];
    documentDeclaredModules: readonly string[];
  }[] = [];
  pushDraftResult: { generation: number; ok: boolean; error?: Error } = {
    generation: 1,
    ok: true,
  };
  async pushDraft(options: {
    moduleIdentifier: string;
    source: string;
    moduleGraph: readonly string[];
    documentDeclaredModules: readonly string[];
  }): Promise<{ generation: number; ok: boolean; error?: Error }> {
    this.pushDraftCalls.push(options);
    return this.pushDraftResult;
  }

  reloadCalls = 0;
  reloadSandbox(): void {
    this.reloadCalls++;
  }

  getRenderSlotForHandle() {
    return { owner: 'direct' as const, component: {} as never };
  }

  async getRenderSlot() {
    if (this.mode === 'sandbox') {
      return {
        owner: 'sandbox' as const,
        iframe: document.createElement('iframe'),
        surface: 'surface:test' as never,
      };
    }
    return {
      owner: 'capsule' as const,
      component: {} as never,
      stylesheets: [],
    };
  }
}

const resource = {
  id: 'https://example.test/Card/one',
  type: 'card',
  attributes: {},
  relationships: {},
  meta: {
    adoptsFrom: {
      module: 'https://example.test/card',
      name: 'Example',
    },
  },
} as unknown as LooseCardResource;

const cardDocument = {
  data: resource,
} as unknown as LooseSingleCardDocument;

function renderRecord(
  mode: BoxelRuntime['mode'],
  prefersFullSandbox = false,
): BoxelRenderRecord {
  return {
    protocolVersion: 1,
    boxel: {
      protocolVersion: 1,
      requiredFeatures: [],
      ref: resource.meta!.adoptsFrom!,
      boxelKind: 'card',
      ancestors: [],
      fields: [],
      formats: [],
      presentation: {
        displayName: `${mode} card`,
        headerColor: null,
        prefersWideFormat: false,
      },
      executionHints: { prefersFullSandbox },
    },
    instance: { id: resource.id ?? null, model: {}, fields: [] },
    presentation: {
      title: `${mode} title`,
      summary: null,
      thumbnailURL: null,
      theme: null,
      themeScope: null,
      themeCss: null,
      cssImports: null,
    },
  };
}

function executionRequest(source = 'capsule') {
  return {
    principal: 'user:one',
    surfaceId: 'surface:one',
    trusted: false,
    format: 'isolated',
    moduleIdentifier: 'https://example.test/card',
    source,
    resource,
    document: cardDocument,
    purpose: 'host-display' as const,
  };
}

module('Unit | Boxel execution engine', function () {
  test('Host policy chooses execution and authored input can only strengthen it', function (assert) {
    assert.deepEqual(decideBoxelExecution(policy({ trusted: true })), {
      mode: 'direct',
      reason: 'trusted-boxel-module',
    });
    assert.deepEqual(decideBoxelExecution(policy()), {
      mode: 'capsule',
      reason: 'default-user-card',
    });
    assert.deepEqual(decideBoxelExecution(policy({ source: sandboxSource })), {
      mode: 'sandbox',
      reason: 'browser-runtime:document',
    });
    assert.deepEqual(
      decideBoxelExecution(
        policy({
          trusted: true,
          prefersFullSandbox: true,
        }),
      ),
      { mode: 'sandbox', reason: 'prefers-full-sandbox' },
      'even trusted code can explicitly request the stronger process boundary',
    );
    assert.deepEqual(
      decideBoxelExecution(policy({ source: sandboxSource, format: 'fitted' })),
      { mode: 'capsule', reason: 'ses-only-format:fitted' },
      'compact composition formats never create inline iframes',
    );
    for (let format of ['atom', 'head', 'markdown']) {
      assert.deepEqual(
        decideBoxelExecution(policy({ source: sandboxSource, format })),
        { mode: 'capsule', reason: `ses-only-format:${format}` },
        `${format} remains composable without an inline iframe`,
      );
    }
    for (let format of ['isolated', 'embedded', 'edit']) {
      assert.deepEqual(
        decideBoxelExecution(policy({ source: sandboxSource, format })),
        { mode: 'sandbox', reason: 'browser-runtime:document' },
        `${format} may use the origin-isolated browser runtime`,
      );
    }
  });

  test('one semantic fixture crosses Direct, Capsule, and Sandbox through the same session contract', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async (_module, source) =>
      source === 'sandbox' ? sandboxSource : capsuleSource,
    );

    try {
      let cases = [
        {
          expected: 'direct',
          request: { ...executionRequest(), trusted: true },
        },
        { expected: 'capsule', request: executionRequest() },
        {
          expected: 'sandbox',
          request: executionRequest('sandbox'),
        },
      ] as const;

      for (let fixture of cases) {
        let session = engine.createSession();
        let generation = await session.update(fixture.request);
        assert.strictEqual(
          generation?.lease.runtime.mode,
          fixture.expected,
          `${fixture.expected} owns semantic materialization`,
        );
        assert.deepEqual(
          structuredClone(generation?.renderRecord),
          generation?.renderRecord,
          `${fixture.expected} returns the same cloneable record shape`,
        );
        let slot = await session.getRenderSlot('isolated');
        assert.strictEqual(
          slot.owner,
          fixture.expected,
          `${fixture.expected} owns its render effect`,
        );
        await session.destroy();
      }
    } finally {
      engine.destroy();
    }
  });

  test('Direct retains the canonical Store instance while boundaries materialize projections', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async () => capsuleSource);
    let canonicalCard = {};
    let directSession = engine.createSession();
    let capsuleSession = engine.createSession();

    await directSession.update({
      ...executionRequest(),
      trusted: true,
      canonicalCard: canonicalCard as never,
    });
    await capsuleSession.update({
      ...executionRequest(),
      canonicalCard: canonicalCard as never,
    });

    assert.strictEqual(
      direct.retainedCanonical,
      canonicalCard,
      'trusted Direct rendering preserves the Store-owned object identity',
    );
    assert.strictEqual(
      direct.createdFromSerialized,
      0,
      'Direct does not create a fallback-store clone',
    );
    assert.strictEqual(
      capsule.createdFromSerialized,
      1,
      'Capsule still materializes only the serialized projection',
    );
    assert.strictEqual(
      capsule.retainedCanonical,
      undefined,
      'the canonical Store object never enters the Capsule runtime',
    );

    await directSession.destroy();
    await capsuleSession.destroy();
    engine.destroy();
  });

  test('mixed delegated boundaries keep independent runtime and lifecycle ownership', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async (_module, source) =>
      source === 'sandbox' ? sandboxSource : capsuleSource,
    );
    let trustedBaseField = engine.createSession();
    let authoredParent = engine.createSession();
    let browserDependentChild = engine.createSession();

    try {
      await trustedBaseField.update({
        ...executionRequest(),
        surfaceId: 'surface:base-field',
        trusted: true,
      });
      await authoredParent.update({
        ...executionRequest(),
        surfaceId: 'surface:parent',
      });
      await browserDependentChild.update({
        ...executionRequest('sandbox'),
        surfaceId: 'surface:child',
      });

      assert.deepEqual(
        [
          trustedBaseField.snapshot.current?.lease.runtime.mode,
          authoredParent.snapshot.current?.lease.runtime.mode,
          browserDependentChild.snapshot.current?.lease.runtime.mode,
        ],
        ['direct', 'capsule', 'sandbox'],
        'a composed graph may cross Host, Capsule, and Sandbox boundaries',
      );

      await browserDependentChild.destroy();
      assert.strictEqual(
        authoredParent.snapshot.status,
        'ready',
        'releasing the nested browser process does not invalidate its parent',
      );
      assert.strictEqual(
        trustedBaseField.snapshot.status,
        'ready',
        'trusted Base remains immune to authored child lifecycle',
      );
    } finally {
      await trustedBaseField.destroy();
      await authoredParent.destroy();
      await browserDependentChild.destroy();
      engine.destroy();
    }
  });

  test('source classification distinguishes type references from browser authority', async function (assert) {
    let typeOnly = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        element?: HTMLElement;
      }
    `);
    assert.strictEqual(typeOnly.tier, 'capsule');

    let trustedCSSVariable = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      import { cssVar } from '@cardstack/boxel-ui/helpers';
      export class Example extends CardDef {
        static isolated = class {
          <template>
            <section style={{cssVar example-accent=@model.accent}}></section>
          </template>
        };
      }
    `);
    assert.strictEqual(
      trustedCSSVariable.tier,
      'capsule',
      'the trusted custom-property helper does not require a browser process',
    );

    let arbitraryDynamicStyle = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        static isolated = class {
          <template>
            <section style={{@model.style}}></section>
          </template>
        };
      }
    `);
    assert.strictEqual(arbitraryDynamicStyle.tier, 'sandbox');
    assert.true(arbitraryDynamicStyle.signals.includes('dynamic-inline-style'));

    let browser = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        static isolated = document.createElement('canvas');
      }
    `);
    assert.strictEqual(browser.tier, 'sandbox');
    assert.true(browser.signals.includes('document'));

    let externalRenderer = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      import * as THREE from 'three';
      export class Example extends CardDef {
        static isolated = THREE.Scene;
      }
    `);
    assert.strictEqual(externalRenderer.tier, 'sandbox');
    assert.true(externalRenderer.signals.includes('three'));

    let globalStyle = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        static isolated = class {
          <template>
            <section>Example</section>
            <style scoped>:global(.operator-mode) { font-size: 8rem; }</style>
          </template>
        };
      }
    `);
    assert.strictEqual(globalStyle.tier, 'sandbox');
    assert.true(globalStyle.signals.includes('global-style-selector'));

    let globalRegistration = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        static isolated = class {
          <template>
            <section>Example</section>
            <style scoped>@font-face { font-family: CardFont; src: local(Arial); }</style>
          </template>
        };
      }
    `);
    assert.strictEqual(globalRegistration.tier, 'sandbox');
    assert.true(globalRegistration.signals.includes('document-global-style'));

    let networkImport = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        static isolated = class {
          <template>
            <section>Example</section>
            <style scoped>@import "https://fonts.example/inter.css"; .title { color: red; }</style>
          </template>
        };
      }
    `);
    assert.strictEqual(
      networkImport.tier,
      'sandbox',
      'an @import in scoped CSS is network-bearing and cannot be admitted to the shared Capsule document, so it routes to the Sandbox tier',
    );
    assert.true(networkImport.signals.includes('network-bearing-style'));

    let networkUrl = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        static isolated = class {
          <template>
            <section>Example</section>
            <style scoped>.title { background: url(https://images.example/bg.png); }</style>
          </template>
        };
      }
    `);
    assert.strictEqual(
      networkUrl.tier,
      'sandbox',
      'a url() in scoped CSS is network-bearing and routes to the Sandbox tier exactly like @import',
    );
    assert.true(networkUrl.signals.includes('network-bearing-style'));
  });

  test('module graph classification propagates authored browser dependencies and stops at trusted modules', async function (assert) {
    let sources: Record<string, string> = {
      'https://example.test/entry.gts': `
        import Renderer from './renderer.gts';
        import { CardDef } from 'https://cardstack.com/base/card-api';
        export class Example extends CardDef { static isolated = Renderer; }
      `,
      'https://example.test/renderer.gts': `
        import * as THREE from 'three';
        export default THREE.Scene;
      `,
    };
    let loads: string[] = [];
    let resolutions: string[] = [];
    let classifier = new BoxelModuleGraphClassifier({
      loadSource: async (identifier) => {
        loads.push(identifier);
        let source = sources[identifier];
        if (source === undefined) {
          throw new Error('not found');
        }
        return source;
      },
      resolveImport: (specifier, relativeTo) => {
        resolutions.push(specifier);
        return specifier.startsWith('.')
          ? new URL(specifier, relativeTo).href
          : specifier;
      },
      isTrustedModule: (identifier) =>
        identifier.startsWith('https://cardstack.com/base/'),
    });

    // eslint-disable-next-line ember/no-string-prototype-extensions -- this is the graph classifier API, not Ember.String.classify
    let result = await classifier.classify('https://example.test/entry.gts');
    assert.strictEqual(result.tier, 'sandbox');
    assert.strictEqual(
      result.reason,
      'dependency-runtime:https://example.test/renderer.gts',
    );
    assert.true(result.signals.includes('three'));
    assert.false(
      loads.includes('https://cardstack.com/base/card-api'),
      'trusted imports are semantic leaves and are never fetched as authored source',
    );
    assert.false(
      resolutions.includes('https://cardstack.com/base/card-api'),
      'trusted imports do not trigger package resolution or eager module evaluation',
    );
  });

  test('module graph classification reuses unchanged supplied source and replaces changed source', async function (assert) {
    let moduleIdentifier = 'https://example.test/entry.gts';
    let dependencyIdentifier = 'https://example.test/dependency.gts';
    let dependencyLoads = 0;
    let classifier = new BoxelModuleGraphClassifier({
      loadSource: async (identifier) => {
        if (identifier !== dependencyIdentifier) {
          throw new Error('not found');
        }
        dependencyLoads++;
        return `export default class Dependency {}`;
      },
      resolveImport: (specifier, relativeTo) =>
        new URL(specifier, relativeTo).href,
      isTrustedModule: () => false,
    });
    let source = `
      import Dependency from './dependency.gts';
      export class Example extends Dependency {}
    `;

    // eslint-disable-next-line ember/no-string-prototype-extensions -- this is the graph classifier API, not Ember.String.classify
    await classifier.classify(moduleIdentifier, source);
    // eslint-disable-next-line ember/no-string-prototype-extensions -- this is the graph classifier API, not Ember.String.classify
    await classifier.classify(moduleIdentifier, source);
    assert.strictEqual(
      dependencyLoads,
      1,
      'an unchanged editor or Store snapshot reuses its module graph',
    );

    // eslint-disable-next-line ember/no-string-prototype-extensions -- this is the graph classifier API, not Ember.String.classify
    await classifier.classify(
      moduleIdentifier,
      `${source}\nexport const revision = 2;`,
    );
    assert.strictEqual(
      dependencyLoads,
      2,
      'a changed source snapshot replaces the cached graph',
    );
  });

  test('Sandbox module authority is seeded from the document as well as the static module graph', async function (assert) {
    // Reproduces the shape reported against the execution-runtime-suite realm:
    // a module classified into the Sandbox tier for its own reason (here,
    // `sandboxSource`'s browser-runtime signal) whose *document* links a
    // second card — e.g. a `linksTo(CardDef)` relationship, resolved only at
    // the field's declared generic type — through `included`, not through a
    // literal ESM import anywhere in the entry module's source. Nothing in
    // `source.moduleGraph` (the static import walk) can ever discover that
    // module, yet the Sandbox child's `createFromSerialized` still needs to
    // load it to construct the linked instance.
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let sourceWithStaticGraph: BoxelSourceClassification = {
      ...sandboxSource,
      moduleGraph: [
        'https://example.test/card',
        'https://example.test/statically-imported-sibling',
      ],
    };
    let engine = new BoxelExecutionEngine(
      router,
      async () => sourceWithStaticGraph,
    );
    let session = engine.createSession();

    let linkedTrackResource = {
      id: 'https://realm.example/use-case-4/track-one',
      type: 'card',
      attributes: {},
      relationships: {},
      meta: {
        adoptsFrom: {
          module: 'https://realm.example/use-case-4/track',
          name: 'Track',
        },
      },
    } as unknown as LooseCardResource;

    let documentWithIncludedRelationship = {
      data: {
        ...resource,
        relationships: {
          subject: { data: { type: 'card', id: linkedTrackResource.id! } },
        },
      },
      included: [linkedTrackResource],
    } as unknown as LooseSingleCardDocument;

    await session.update({
      ...executionRequest('sandbox'),
      document: documentWithIncludedRelationship,
    });

    assert.true(
      sandbox.allowedModules.includes(
        'https://example.test/statically-imported-sibling',
      ),
      'the static module graph is still admitted',
    );
    assert.true(
      sandbox.allowedModules.includes('https://realm.example/use-case-4/track'),
      'an included relationship resource’s adoptsFrom module is admitted even though no source statically imports it',
    );

    await session.destroy();
    engine.destroy();
  });

  test('the router retains Capsule by principal and Sandbox by mounted surface', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsules: TestRuntime[] = [];
    let sandboxes: TestRuntime[] = [];
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => {
        let runtime = new TestRuntime('capsule');
        capsules.push(runtime);
        return runtime as unknown as CapsuleBoxelRuntime;
      },
      () => {
        let runtime = new TestRuntime('sandbox');
        sandboxes.push(runtime);
        return runtime as unknown as SandboxRuntimeProcess;
      },
      0,
    );

    let sharedInput = {
      ...policy(),
      principal: 'user:one',
      surfaceId: 'surface:one',
    };
    let capsuleOne = router.route(sharedInput);
    let capsuleTwo = router.route({ ...sharedInput, surfaceId: 'surface:two' });
    assert.strictEqual(
      capsuleOne.runtime,
      capsuleTwo.runtime,
      'one principal shares one warm Capsule across surfaces',
    );

    let sandboxOne = router.route({
      ...sharedInput,
      source: sandboxSource,
    });
    let sandboxTwo = router.route({
      ...sharedInput,
      source: sandboxSource,
      surfaceId: 'surface:two',
    });
    assert.notStrictEqual(
      sandboxOne.runtime,
      sandboxTwo.runtime,
      'each mounted Sandbox surface owns a distinct child process',
    );
    assert.strictEqual(capsules.length, 1);
    assert.strictEqual(sandboxes.length, 2);

    capsuleOne.release();
    assert.false(capsules[0]!.destroyed, 'one retained consumer remains');
    capsuleTwo.release();
    sandboxOne.release();
    sandboxTwo.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.true(capsules[0]!.destroyed, 'idle Capsule was evicted');
    assert.true(sandboxes[0]!.destroyed, 'idle Sandbox was evicted');
    assert.true(sandboxes[1]!.destroyed, 'other idle Sandbox was evicted');
    assert.false(direct.destroyed, 'the trusted Host runtime is not evicted');

    router.destroy();
  });

  test('an execution session swaps complete generations and retains last-known-good on failure', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async (_module, source) =>
      source === 'sandbox' ? sandboxSource : capsuleSource,
    );
    let session = engine.createSession();

    let first = await session.update(executionRequest());
    assert.strictEqual(first?.lease.runtime, capsule);
    assert.strictEqual(session.snapshot.status, 'ready');

    capsule.failBuild = true;
    let failed = await session.update(executionRequest());
    assert.strictEqual(failed, undefined);
    assert.strictEqual(session.snapshot.status, 'error');
    assert.strictEqual(
      session.snapshot.current,
      first,
      'a failed candidate cannot replace the last-known-good generation',
    );
    assert.strictEqual(
      session.snapshot.error?.message,
      'capsule render failed',
    );

    await session.destroy();
    engine.destroy();
  });

  test('an unsupported protocol version or required feature fails closed and retains last-known-good', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async () => capsuleSource);
    let session = engine.createSession();

    let first = await session.update(executionRequest());
    assert.strictEqual(session.snapshot.status, 'ready');

    capsule.recordTamper = (record) => ({ ...record, protocolVersion: 999 });
    let failedVersion = await session.update(executionRequest());
    assert.strictEqual(failedVersion, undefined);
    assert.strictEqual(
      session.snapshot.current,
      first,
      'an unknown record version cannot replace last-known-good',
    );
    assert.true(
      session.snapshot.error?.message.includes('protocol version 999'),
    );

    capsule.recordTamper = (record) => ({
      ...record,
      boxel: { ...record.boxel, requiredFeatures: ['time-travel'] },
    });
    let failedFeature = await session.update(executionRequest());
    assert.strictEqual(failedFeature, undefined);
    assert.strictEqual(
      session.snapshot.current,
      first,
      'an unknown required feature cannot replace last-known-good',
    );
    assert.true(session.snapshot.error?.message.includes('time-travel'));

    await session.destroy();
    engine.destroy();
  });

  test('obsolete async classification cannot replace a newer generation', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let releaseSlow!: (classification: BoxelSourceClassification) => void;
    let slow = new Promise<BoxelSourceClassification>((resolve) => {
      releaseSlow = resolve;
    });
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, (_module, source) =>
      source === 'slow' ? slow : Promise.resolve(sandboxSource),
    );
    let session = engine.createSession();

    let obsolete = session.update(executionRequest('slow'));
    let current = await session.update(executionRequest('fast'));
    releaseSlow(capsuleSource);

    assert.strictEqual(await obsolete, undefined);
    assert.strictEqual(session.snapshot.current, current);
    assert.strictEqual(current?.lease.runtime, sandbox);
    assert.strictEqual(session.snapshot.requestedGeneration, 2);

    await session.destroy();
    engine.destroy();
  });

  test('a type-discovered full Sandbox preference strengthens the initial decision', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    capsule.prefersFullSandbox = true;
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async () => capsuleSource);
    let session = engine.createSession();

    let generation = await session.update(executionRequest());
    assert.strictEqual(generation?.lease.decision.mode, 'sandbox');
    assert.strictEqual(generation?.lease.runtime, sandbox);
    assert.strictEqual(
      capsule.disposed.length,
      1,
      'the weaker candidate was disposed before the stronger one became current',
    );

    await session.destroy();
    engine.destroy();
  });

  test('the execution session exposes the render slot owned by the selected tier', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    Object.assign(sandbox, {
      getRenderSlot: () => ({
        owner: 'sandbox' as const,
        iframe: document.createElement('iframe'),
        surface: 'surface:test',
      }),
    });
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async (_module, source) =>
      source === 'sandbox' ? sandboxSource : capsuleSource,
    );

    let directSession = engine.createSession();
    await directSession.update({
      ...executionRequest(),
      trusted: true,
    });
    assert.strictEqual(
      (await directSession.getRenderSlot('isolated')).owner,
      'direct',
    );

    let capsuleSession = engine.createSession();
    await capsuleSession.update(executionRequest());
    assert.strictEqual(
      (await capsuleSession.getRenderSlot('fitted')).owner,
      'capsule',
    );

    let sandboxSession = engine.createSession();
    await sandboxSession.update(executionRequest('sandbox'));
    assert.strictEqual(
      (await sandboxSession.getRenderSlot('isolated')).owner,
      'sandbox',
    );

    await directSession.destroy();
    await capsuleSession.destroy();
    await sandboxSession.destroy();
    engine.destroy();
  });

  test('RP-15.3: pushDraft() classifies the edit and delegates to the Sandbox process with its module graph plus document-declared modules — the authority-growth step, edge case 8', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let classifyCalls: { moduleIdentifier: string; source: string }[] = [];
    let draftClassification: BoxelSourceClassification = {
      ...sandboxSource,
      moduleGraph: [
        'https://example.test/card',
        'https://example.test/newly-imported-helper',
      ],
    };
    let engine = new BoxelExecutionEngine(
      router,
      async (moduleIdentifier, source) => {
        classifyCalls.push({ moduleIdentifier, source });
        return source === 'sandbox' ? sandboxSource : draftClassification;
      },
    );
    let session = engine.createSession();
    await session.update(executionRequest('sandbox'));

    let result = await session.pushDraft(
      'https://example.test/card',
      'edited source',
    );

    assert.true(result.ok);
    assert.strictEqual(result.generation, sandbox.pushDraftResult.generation);
    assert.strictEqual(
      classifyCalls[classifyCalls.length - 1]?.source,
      'edited source',
      'the draft source is classified — the same pure step update() itself performs — before being pushed',
    );
    assert.strictEqual(sandbox.pushDraftCalls.length, 1);
    assert.deepEqual(
      sandbox.pushDraftCalls[0],
      {
        moduleIdentifier: 'https://example.test/card',
        source: 'edited source',
        moduleGraph: draftClassification.moduleGraph,
        // modulesConsumedInMeta (resource-types.ts) always includes the
        // primary resource's own adoptsFrom module — here the same URL as
        // the module being edited, since that's what this fixture's
        // `resource.meta.adoptsFrom` names.
        documentDeclaredModules: ['https://example.test/card'],
      },
      "the draft's own classified module graph is threaded through for authority growth — never the original (pre-edit) source's graph",
    );

    await session.destroy();
    engine.destroy();
  });

  test('RP-15.3: pushDraft() fails without touching any runtime when the session has no ready generation, or when the current generation is not Sandbox', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async () => capsuleSource);
    let session = engine.createSession();

    let beforeReady = await session.pushDraft(
      'https://example.test/card',
      'edited source',
    );
    assert.false(beforeReady.ok);
    assert.true(beforeReady.error?.message.includes('no ready generation'));

    await session.update(executionRequest());
    assert.strictEqual(session.snapshot.current?.lease.runtime, capsule);

    let wrongTier = await session.pushDraft(
      'https://example.test/card',
      'edited source',
    );
    assert.false(wrongTier.ok);
    assert.true(wrongTier.error?.message.includes("'capsule' execution tier"));
    assert.strictEqual(
      sandbox.pushDraftCalls.length,
      0,
      'a draft push against a non-Sandbox generation never reaches any runtime',
    );

    await session.destroy();
    engine.destroy();
  });

  test('RP-15.3: pushDraft() that races a newer update() while classifying does not apply against a generation the session no longer owns', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let releaseClassify!: (classification: BoxelSourceClassification) => void;
    let slowClassify = new Promise<BoxelSourceClassification>((resolve) => {
      releaseClassify = resolve;
    });
    let engine = new BoxelExecutionEngine(router, async (_module, source) => {
      if (source === 'slow-draft') {
        return slowClassify;
      }
      return source === 'sandbox' ? sandboxSource : capsuleSource;
    });
    let session = engine.createSession();
    await session.update(executionRequest('sandbox'));

    let racedDraft = session.pushDraft(
      'https://example.test/card',
      'slow-draft',
    );
    // A newer, unrelated update() supersedes the generation the draft above
    // was classifying against — a second Sandbox render for a DIFFERENT
    // reason (a format switch, a fresh navigation), not a competing draft.
    await session.update(executionRequest('sandbox'));
    releaseClassify(sandboxSource);

    let result = await racedDraft;
    assert.false(
      result.ok,
      'a draft that finishes classifying only after its generation was superseded never applies',
    );
    assert.true(result.error?.message.includes('generation changed'));
    assert.strictEqual(
      sandbox.pushDraftCalls.length,
      0,
      'the superseded draft never reaches the runtime at all',
    );

    await session.destroy();
    engine.destroy();
  });

  test("RP-15.3: reloadSandbox() delegates to the current Sandbox generation's process, and is a no-op for a non-Sandbox generation or no generation at all", async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let engine = new BoxelExecutionEngine(router, async (_module, source) =>
      source === 'sandbox' ? sandboxSource : capsuleSource,
    );
    let session = engine.createSession();

    session.reloadSandbox();
    assert.strictEqual(
      sandbox.reloadCalls,
      0,
      'no generation yet — nothing to reload',
    );

    await session.update(executionRequest());
    session.reloadSandbox();
    assert.strictEqual(
      sandbox.reloadCalls,
      0,
      'the current generation is Capsule, not Sandbox — reloadSandbox() only ever targets the Sandbox tier',
    );

    await session.update(executionRequest('sandbox'));
    session.reloadSandbox();
    assert.strictEqual(sandbox.reloadCalls, 1);

    await session.destroy();
    engine.destroy();
  });
});
