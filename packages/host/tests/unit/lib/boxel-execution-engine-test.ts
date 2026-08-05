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
  propagatesToImporters: false,
};

const sandboxSource: BoxelSourceClassification = {
  tier: 'sandbox',
  reason: 'browser-runtime:document',
  imports: [],
  signals: ['document'],
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
    ...overrides,
  };
}

class TestRuntime {
  destroyed = false;
  disposed: string[] = [];
  failBuild = false;
  prefersFullSandbox = false;
  private nextInstance = 0;

  constructor(readonly mode: BoxelRuntime['mode']) {}

  destroy(): void {
    this.destroyed = true;
  }

  async loadBoxel(): Promise<never> {
    throw new Error('not used');
  }
  async createFromSerialized(): Promise<BoxelInstanceHandle> {
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
  async buildRenderRecord(): Promise<BoxelRenderRecord> {
    if (this.failBuild) {
      throw new Error(`${this.mode} render failed`);
    }
    return renderRecord(this.mode, this.prefersFullSandbox);
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

  getRenderSlotForHandle() {
    return { owner: 'direct' as const, component: {} as never };
  }

  async getRenderSlot() {
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
    instance: { id: resource.id ?? null, fields: [] },
    presentation: {
      title: `${mode} title`,
      summary: null,
      thumbnailURL: null,
      theme: null,
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
  });

  test('source classification distinguishes type references from browser authority', async function (assert) {
    let typeOnly = await classifyBoxelSource(`
      import { CardDef } from '@cardstack/base/card-api';
      export class Example extends CardDef {
        element?: HTMLElement;
      }
    `);
    assert.strictEqual(typeOnly.tier, 'capsule');

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
    assert.deepEqual(externalRenderer.formatOnlyImports, [
      {
        specifier: 'three',
        bindings: [{ exportName: 'Scene', formats: ['isolated'] }],
      },
    ]);
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
    let classifier = new BoxelModuleGraphClassifier({
      loadSource: async (identifier) => {
        loads.push(identifier);
        let source = sources[identifier];
        if (source === undefined) {
          throw new Error('not found');
        }
        return source;
      },
      resolveImport: (specifier, relativeTo) =>
        specifier.startsWith('.')
          ? new URL(specifier, relativeTo).href
          : specifier,
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
});
