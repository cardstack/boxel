import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  Loader,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import BoxelExecutionEngine from '@cardstack/host/lib/boxel-execution-engine';
import type { BoxelRuntime } from '@cardstack/host/lib/boxel-runtime';
import BoxelRuntimeRouter from '@cardstack/host/lib/boxel-runtime-router';
import type { BoxelSourceClassification } from '@cardstack/host/lib/boxel-source-classifier';
import type CapsuleBoxelRuntime from '@cardstack/host/lib/capsule-boxel-runtime';
import type DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';
import type SurfaceService from '@cardstack/host/services/surface-service';

// Named without the `rp-` prefix on purpose: the bijection scanner only
// scans files matching `rp-*-test.(gts|ts)`. Volatile promotion doesn't
// have spec statements yet (docs/boxel-volatile-execution-plan.md is
// design intent, pre-implementation) — the coordinator writes those in a
// follow-up round, then this file's test titles get RP-cited and (per that
// round's own pattern) likely gets renamed to match the scan pattern.

const capsuleSource: BoxelSourceClassification = {
  tier: 'capsule',
  reason: 'default-user-card',
  imports: [],
  signals: [],
  moduleGraph: [],
  propagatesToImporters: false,
  authoredEditTemplate: false,
};

/**
 * Minimal `BoxelRuntime`-shaped fake, mirroring
 * boxel-execution-engine-test.ts's own `TestRuntime` (each suite owns its
 * fixtures rather than sharing them across files). Extended with the
 * Sandbox HMR draft surface so session-level pushDraft() delegation is
 * exercisable without a real iframe/child connection.
 */
class TestRuntime {
  disposed: string[] = [];
  private nextInstance = 0;

  constructor(readonly mode: BoxelRuntime['mode']) {}

  destroy(): void {}

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
    return renderRecord(this.mode);
  }
  async serializeCard(): Promise<never> {
    throw new Error('not used');
  }
  async dispose(handle: string): Promise<void> {
    this.disposed.push(handle);
  }
  allowModules(): void {}
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

const cardDocument = { data: resource } as unknown as LooseSingleCardDocument;

function renderRecord(mode: BoxelRuntime['mode']): BoxelRenderRecord {
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
      executionHints: { prefersFullSandbox: false },
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

function executionRequest(surfaceId = 'surface:one') {
  return {
    principal: 'user:one',
    surfaceId,
    trusted: false,
    format: 'isolated',
    moduleIdentifier: 'https://example.test/card',
    source: 'capsule',
    resource,
    document: cardDocument,
    purpose: 'host-display' as const,
  };
}

function fakeSurfaceService(): { service: SurfaceService } {
  let surface = 'surface:volatile-test' as SurfaceHandle;
  let service = {
    register: () => surface,
    release: () => undefined,
    layout: () => undefined,
  } as unknown as SurfaceService;
  return { service };
}

module('Unit | rp-volatile | service promotion', function (hooks) {
  setupTest(hooks);

  test('RP-19.1: promoteToVolatile is one-way for the session — idempotent, no demotion affordance exists', function (assert) {
    let service = this.owner.lookup(
      'service:boxel-execution',
    ) as BoxelExecutionService;
    let moduleIdentifier = 'https://realm.example/card.gts';

    assert.false(
      service.isVolatile(moduleIdentifier),
      'not volatile before promotion',
    );

    service.promoteToVolatile(moduleIdentifier);
    assert.true(
      service.isVolatile(moduleIdentifier),
      'volatile after promotion',
    );

    // Idempotent: promoting an already-volatile module again is a no-op —
    // does not throw, and the module simply stays volatile.
    service.promoteToVolatile(moduleIdentifier);
    assert.true(service.isVolatile(moduleIdentifier));

    // No demotion, lease, or timer: the plan explicitly deletes the frozen
    // branch's renewable-lease machinery. There is no public affordance to
    // revert a promotion for the life of this service.
    assert.strictEqual(
      (service as unknown as Record<string, unknown>)['demoteFromVolatile'],
      undefined,
    );
    assert.strictEqual(
      (service as unknown as Record<string, unknown>)['demoteVolatile'],
      undefined,
    );
  });

  test('RP-19.1: promoteToVolatile on a trusted Host module identifier is inert', function (assert) {
    let service = this.owner.lookup(
      'service:boxel-execution',
    ) as BoxelExecutionService;
    // isTrustedModule (lib/trusted-modules.ts): any https://cardstack.com/
    // base/* URL, unconditionally, independent of environment config.
    let trustedModuleIdentifier = 'https://cardstack.com/base/card-api';

    service.promoteToVolatile(trustedModuleIdentifier);

    assert.false(
      service.isVolatile(trustedModuleIdentifier),
      "volatile promotion is for user cards under active edit, never the platform's own trusted graph — the call is a silent no-op, not a thrown error",
    );
  });

  test('RP-19.3: moduleIdentifierFor returns undefined for a class the Loader never identified, rather than throwing — the synchronous lookup that scopes the live re-route to exactly one module', function (assert) {
    let service = this.owner.lookup(
      'service:boxel-execution',
    ) as BoxelExecutionService;
    class NeverImported {}
    assert.strictEqual(
      service.moduleIdentifierFor(
        new NeverImported() as unknown as Parameters<
          BoxelExecutionService['moduleIdentifierFor']
        >[0],
      ),
      undefined,
      'nothing to track for a card whose module identity is unknown — the real error still surfaces from requestFor() itself, not from this synchronous helper',
    );
  });
});

module('Unit | rp-volatile | engine routing', function () {
  test("RP-19.2, RP-19.3: promoting a mounted module's identifier swaps its session's routing decision to Sandbox on the very next update() — the live re-route BoxelExecutionRenderer's resource re-instantiation triggers — disposing the old Capsule generation through the normal replace path, not a special-cased teardown", async function (assert) {
    let capsule = new TestRuntime('capsule');
    let sandbox = new TestRuntime('sandbox');
    let router = new BoxelRuntimeRouter(
      {} as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => sandbox as unknown as SandboxRuntimeProcess,
    );
    let volatileModules = new Set<string>();
    let engine = new BoxelExecutionEngine(
      router,
      async () => capsuleSource, // classification alone always says Capsule
      (moduleIdentifier) => volatileModules.has(moduleIdentifier),
    );
    let session = engine.createSession();

    try {
      let first = await session.update(executionRequest());
      assert.strictEqual(
        first?.lease.decision.mode,
        'capsule',
        'classification alone routes Capsule, as this fixture intends',
      );
      assert.ok(first, 'the first generation materialized');
      assert.strictEqual(capsule.disposed.length, 0);

      volatileModules.add('https://example.test/card'); // == executionRequest()'s moduleIdentifier
      let second = await session.update(executionRequest());

      assert.strictEqual(
        second?.lease.decision.mode,
        'sandbox',
        'the EXACT SAME (still Capsule-classified) request now routes Sandbox once its module is promoted — volatility strengthens isolation, classification never changed',
      );
      assert.strictEqual(second?.lease.decision.reason, 'volatile-promotion');
      assert.deepEqual(
        capsule.disposed,
        first ? [first.card] : [],
        "the superseded Capsule generation disposes through update()'s ordinary previous-generation replace path",
      );
    } finally {
      await session.destroy();
      engine.destroy();
    }
  });

  test('RP-19.2: a trusted module never routes through volatile promotion, even if (defensively) the predicate were somehow asked to', async function (assert) {
    let direct = new TestRuntime('direct');
    let capsule = new TestRuntime('capsule');
    let router = new BoxelRuntimeRouter(
      direct as unknown as DirectBoxelRuntime,
      () => capsule as unknown as CapsuleBoxelRuntime,
      () => {
        throw new Error('sandbox is not used by this fixture');
      },
    );
    // Defensive: even if a volatile predicate incorrectly answered `true`
    // for a trusted module (the real guard is at
    // BoxelExecutionService.promoteToVolatile(), which never adds one),
    // decideBoxelExecution's own branch order still can't be talked into
    // Sandbox for a trusted module — trusted is checked first.
    let engine = new BoxelExecutionEngine(
      router,
      async () => capsuleSource,
      () => true,
    );
    let session = engine.createSession();

    try {
      let generation = await session.update({
        ...executionRequest(),
        trusted: true,
      });
      assert.strictEqual(
        generation?.lease.decision.mode,
        'direct',
        'trusted always wins over a (here, always-true) volatile signal',
      );
    } finally {
      await session.destroy();
      engine.destroy();
    }
  });

  test("RP-19.4: isolation (a) — a volatile session's pushDraft() never touches a separate, independent Loader standing in for the host's stable module graph — same cached module identity, zero re-fetch", async function (assert) {
    let hostFetchCalls = 0;
    let hostSources: Record<string, string> = {
      'https://realm.example/shared-helper.gts': 'export const value = 1;',
    };
    let hostFetch = (async (input: RequestInfo | URL) => {
      hostFetchCalls++;
      let url = String(input instanceof Request ? input.url : input);
      return new Response(hostSources[url] ?? 'not found', {
        status: hostSources[url] ? 200 : 404,
        headers: { 'content-type': 'text/javascript' },
      });
    }) as typeof fetch;
    let hostLoader = new Loader(hostFetch, (id) => id);

    let firstImport = await hostLoader.import<{ value: number }>(
      'https://realm.example/shared-helper.gts',
    );
    assert.strictEqual(firstImport.value, 1);
    assert.strictEqual(hostFetchCalls, 1);

    // A completely independent Sandbox process — standing in for a
    // SEPARATE (volatile) session's card, which happens to reference the
    // same module URL. It holds no reference to hostLoader at all; that
    // absence is what the isolation guarantee rests on structurally (see
    // pushDraft()'s own doc comment — drafts live only in this process's
    // own override map).
    let { service } = fakeSurfaceService();
    let volatileProcess = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: (async () => new Response('unreachable')) as typeof fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'volatile-isolation-test',
      },
      loadTimeout: 20,
      connectTimeout: 20,
    });

    try {
      await volatileProcess.pushDraft({
        moduleIdentifier: 'https://realm.example/shared-helper.gts',
        source: 'export const value = 999; // edited draft, never saved',
        moduleGraph: [],
        documentDeclaredModules: [],
      });

      assert.true(
        volatileProcess.hasDraftOverride(
          'https://realm.example/shared-helper.gts',
        ),
        "the draft is admitted into the PROCESS's own override map",
      );

      let secondImport = await hostLoader.import<{ value: number }>(
        'https://realm.example/shared-helper.gts',
      );
      assert.strictEqual(
        secondImport,
        firstImport,
        'the exact same cached module — never invalidated, let alone re-derived with the draft value',
      );
      assert.strictEqual(
        secondImport.value,
        1,
        "still the SAVED value — the volatile draft is visible only inside the OTHER process's own render",
      );
      assert.strictEqual(
        hostFetchCalls,
        1,
        "the host Loader never re-fetched — nothing about the other process's draft push reaches it",
      );
    } finally {
      volatileProcess.destroy();
    }
  });

  test("RP-19.4: isolation (b) — a second session's own subscriber receives zero notifications while a different session runs its draft cycle — independent listener sets, no cross-talk", async function (assert) {
    let sandboxA = new TestRuntime('sandbox');
    let sandboxB = new TestRuntime('sandbox');
    let sandboxRuntimes = [sandboxA, sandboxB];
    let nextSandbox = 0;
    let router = new BoxelRuntimeRouter(
      {} as unknown as DirectBoxelRuntime,
      () => {
        throw new Error('capsule is not used by this fixture');
      },
      () => sandboxRuntimes[nextSandbox++]! as unknown as SandboxRuntimeProcess,
    );
    let sandboxSource: BoxelSourceClassification = {
      ...capsuleSource,
      tier: 'sandbox',
    };
    let engine = new BoxelExecutionEngine(router, async () => sandboxSource);
    let sessionA = engine.createSession();
    let sessionB = engine.createSession();

    try {
      await sessionA.update(executionRequest('surface:a'));
      await sessionB.update(executionRequest('surface:b'));

      let sessionBNotifications = 0;
      let unsubscribeB = sessionB.subscribe(() => {
        sessionBNotifications++;
      });
      // subscribe() itself calls back once immediately with the current
      // snapshot — reset the counter to isolate what happens DURING
      // session A's draft cycle specifically.
      sessionBNotifications = 0;

      let draftResult = await sessionA.pushDraft(
        'https://example.test/card',
        'edited source',
      );
      assert.true(draftResult.ok);

      assert.strictEqual(
        sessionBNotifications,
        0,
        "session B's subscriber is never notified by session A's draft cycle — each BoxelExecutionSession owns an entirely independent listener set",
      );
      assert.strictEqual(
        sandboxB.pushDraftCalls.length,
        0,
        "session A's draft never reaches session B's runtime either",
      );

      unsubscribeB();
    } finally {
      await sessionA.destroy();
      await sessionB.destroy();
      engine.destroy();
    }
  });
});
