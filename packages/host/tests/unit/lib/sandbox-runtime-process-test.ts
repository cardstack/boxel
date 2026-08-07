import { module, test } from 'qunit';

import type { SurfaceHandle } from '@cardstack/runtime-common';

import SandboxRuntimeProcess, {
  isSandboxRuntimeControl,
} from '@cardstack/host/lib/sandbox-runtime-process';

import type SurfaceService from '@cardstack/host/services/surface-service';

function fakeSurfaceService(): {
  service: SurfaceService;
  surface: SurfaceHandle;
  released: SurfaceHandle[];
} {
  let surface = 'surface:sandbox-test' as SurfaceHandle;
  let released: SurfaceHandle[] = [];
  let service = {
    register: () => surface,
    release: (handle: SurfaceHandle) => released.push(handle),
    layout: () => undefined,
  } as unknown as SurfaceService;
  return { service, surface, released };
}

function createTestRuntime(
  overrides: {
    service?: SurfaceService;
    connectTimeout?: number;
    resolveModuleURL?: (identifier: string) => string;
  } = {},
): SandboxRuntimeProcess {
  let { service } = overrides.service
    ? { service: overrides.service }
    : fakeSurfaceService();
  return new SandboxRuntimeProcess({
    childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
    childOrigin: 'https://sandbox.example.test',
    surfaceService: service,
    fetch: globalThis.fetch,
    resolveModuleURL:
      overrides.resolveModuleURL ?? ((identifier) => identifier),
    isTrustedModuleURL: () => false,
    identity: {
      mode: 'sandbox',
      principal: 'user:test',
      surfaceId: 'sandbox-test',
    },
    connectTimeout: overrides.connectTimeout ?? 30,
  });
}

module('Unit | Sandbox runtime process', function () {
  test("RP-15.3: the control envelope accepts the child's post-ready 'runtime-error' report — and still rejects malformed shapes", function (assert) {
    let base = {
      kind: 'boxel-sandbox-control',
      transportVersion: 1,
    };
    // The guard hard-codes the CURRENT transport version; mirror it by
    // probing what 'ready' accepts rather than duplicating the constant.
    let version = [1, 2, 3, 4, 5].find((transportVersion) =>
      isSandboxRuntimeControl({ ...base, transportVersion, type: 'ready' }),
    );
    assert.ok(version, 'found the accepted transport version via ready');
    assert.true(
      isSandboxRuntimeControl({
        ...base,
        transportVersion: version,
        type: 'runtime-error',
        error: {
          name: 'Error',
          message: 'Sandbox module read is outside its classified graph',
        },
      }),
      "a well-formed 'runtime-error' passes — the parent's persistent listener depends on this",
    );
    assert.false(
      isSandboxRuntimeControl({
        ...base,
        transportVersion: version,
        type: 'runtime-error',
      }),
      "a 'runtime-error' with no error payload is rejected",
    );
    assert.false(
      isSandboxRuntimeControl({
        ...base,
        transportVersion: version,
        type: 'runtime-error',
        error: { name: 'Error' },
      }),
      "a 'runtime-error' with a partial error payload is rejected",
    );
    assert.false(
      isSandboxRuntimeControl({
        ...base,
        transportVersion: version,
        type: 'something-else',
        error: { name: 'Error', message: 'x' },
      }),
      'an unknown control type is rejected',
    );
  });

  test('creates its iframe detached — never appended anywhere until mount()', function (assert) {
    let { service } = fakeSurfaceService();
    let runtime = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    // RP-15.3: the iframe must be BORN in its presentation slot, not moved
    // there — so it does not exist in the document, and has not started
    // loading anything, until something calls mount() with the real slot
    // element.
    assert.false(
      runtime.iframe.isConnected,
      'the iframe is not in the document before mount()',
    );
    assert.strictEqual(
      runtime.iframe.getAttribute('src'),
      null,
      'the iframe has not started loading anything before mount()',
    );

    runtime.destroy();
  });

  test('mount() appends the iframe into its permanent slot element exactly once and boots it in place', function (assert) {
    let { service } = fakeSurfaceService();
    let runtime = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      let iframe = runtime.iframe;

      assert.strictEqual(
        iframe.parentElement,
        slotElement,
        'the iframe is appended into its permanent slot element',
      );
      assert.strictEqual(
        iframe.getAttribute('sandbox'),
        'allow-scripts allow-same-origin',
      );
      assert.true(iframe.hasAttribute('credentialless'));
      assert.true(
        (iframe.getAttribute('src') ?? '').startsWith(
          'https://sandbox.example.test/_boxel-sandbox-runtime',
        ),
        'boots only once mounted, in its final position',
      );

      // A second mount() call (e.g. a Glimmer rerender that re-invokes the
      // modifier with the same slot) must not re-append the iframe — doing
      // so would re-parent an already-loading/live iframe, reloading it.
      let srcBeforeSecondMount = iframe.getAttribute('src');
      runtime.mount(slotElement);
      assert.strictEqual(
        slotElement.children.length,
        1,
        'mount() is idempotent — no duplicate iframe',
      );
      assert.strictEqual(
        iframe.getAttribute('src'),
        srcBeforeSecondMount,
        'a repeat mount() does not reload the iframe',
      );
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('unmount() removes the live iframe and prepares a fresh, still-detached one for the next mount()', function (assert) {
    let { service } = fakeSurfaceService();
    let runtime = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      let firstIframe = runtime.iframe;
      assert.true(firstIframe.isConnected);

      runtime.unmount();

      assert.false(
        firstIframe.isConnected,
        'the live iframe is removed on unmount — it cannot be preserved',
      );
      assert.strictEqual(
        firstIframe.getAttribute('src'),
        'about:blank',
        'the dead iframe is blanked, not left pointing at the child origin',
      );
      assert.notStrictEqual(
        runtime.iframe,
        firstIframe,
        'a fresh, distinct iframe is ready for a future mount()',
      );
      assert.false(
        runtime.iframe.isConnected,
        'the fresh iframe is detached, exactly like a brand new process',
      );

      // Remount on a new slot: reuses this SAME process object (and
      // therefore its already-accumulated module-authority state) — only
      // the iframe is new.
      let newSlotElement = document.createElement('div');
      document.body.append(newSlotElement);
      try {
        runtime.mount(newSlotElement);
        assert.strictEqual(runtime.iframe.parentElement, newSlotElement);
        assert.notStrictEqual(runtime.iframe, firstIframe);
      } finally {
        newSlotElement.remove();
      }
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('destroy() unmounts the live iframe and releases the Surface handle deterministically', async function (assert) {
    let { service, surface, released } = fakeSurfaceService();
    let runtime = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    let slotElement = document.createElement('div');
    document.body.append(slotElement);
    runtime.mount(slotElement);
    let iframe = runtime.iframe;

    runtime.destroy();

    assert.false(
      iframe.isConnected,
      'the process removes its browsing context',
    );
    assert.deepEqual(released, [surface], 'the Host capability is released');
    await assert.rejects(
      runtime.loadBoxel({
        module: 'https://realm.example/card.gts' as never,
        name: 'Card',
      }),
      /closed/,
      'released processes fail closed',
    );

    slotElement.remove();
  });

  test('whenMounted() resolves once mount() connects the process — breaking the materialize()-before-mount deadlock', async function (assert) {
    let { service } = fakeSurfaceService();
    let runtime = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    try {
      // Before mount(), any call needing a live client fails closed
      // immediately — this is exactly what a caller like materialize()
      // hits if it runs before the presentation slot exists to mount into.
      await assert.rejects(
        runtime.loadBoxel({
          module: 'https://realm.example/card.gts' as never,
          name: 'Card',
        }),
        /closed/,
        'a withClient()-gated call before mount() fails the same way a truly closed process does',
      );

      let mounted = false;
      let whenMounted = runtime.whenMounted().then(() => {
        mounted = true;
      });
      assert.false(
        mounted,
        'whenMounted() has not resolved before mount() is ever called',
      );

      let slotElement = document.createElement('div');
      document.body.append(slotElement);
      try {
        runtime.mount(slotElement);
        await whenMounted;
        assert.true(
          mounted,
          'whenMounted() resolves once mount() has run — this is what lets a caller that reserved this process early (BoxelExecutionService.reserveSandboxProcess()) know it is now safe to let materialize() ask for a client',
        );

        // withClient()-gated calls no longer fail closed once mounted —
        // they instead wait on the (still-connecting) client, exactly the
        // behavior materialize()'s createFromSerialized()/buildRenderRecord()
        // need to avoid the "Sandbox runtime process is closed" deadlock.
        let stillPending = true;
        let afterMount = runtime
          .loadBoxel({
            module: 'https://realm.example/card.gts' as never,
            name: 'Card',
          })
          .catch(() => undefined)
          .finally(() => {
            stillPending = false;
          });
        await Promise.resolve();
        assert.true(
          stillPending,
          'a withClient()-gated call after mount() awaits the connecting client instead of rejecting closed',
        );
        runtime.destroy();
        await afterMount;
      } finally {
        slotElement.remove();
      }
    } finally {
      runtime.destroy();
    }
  });

  test('whenMounted() resolves immediately once already mounted', async function (assert) {
    let { service } = fakeSurfaceService();
    let runtime = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    let slotElement = document.createElement('div');
    document.body.append(slotElement);
    try {
      runtime.mount(slotElement);
      let resolvedSynchronously = false;
      void runtime.whenMounted().then(() => {
        resolvedSynchronously = true;
      });
      await Promise.resolve();
      assert.true(
        resolvedSynchronously,
        'whenMounted() resolves without waiting for a future mount() when the process is already mounted',
      );
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('whenMounted() is released (not left pending forever) if the process is destroyed before ever mounting', async function (assert) {
    let { service } = fakeSurfaceService();
    let runtime = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService: service,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: {
        mode: 'sandbox',
        principal: 'user:test',
        surfaceId: 'sandbox-test',
      },
      connectTimeout: 60_000,
    });

    let settled = false;
    let whenMounted = runtime.whenMounted().then(() => {
      settled = true;
    });
    runtime.destroy();
    await whenMounted;
    assert.true(
      settled,
      'a reservation awaiting whenMounted() on a process that never mounts is released once the process is destroyed, rather than hanging forever',
    );
  });

  test('RP-15.3: pushDraft() on a closed process fails immediately and never touches draftState', async function (assert) {
    let runtime = createTestRuntime();
    runtime.destroy();

    let before = runtime.draftState;
    let result = await runtime.pushDraft({
      moduleIdentifier: 'https://realm.example/card.gts',
      source: 'export default class {}',
      moduleGraph: [],
      documentDeclaredModules: [],
    });

    assert.false(result.ok);
    assert.strictEqual(
      result.error?.message,
      'Sandbox runtime process is closed',
    );
    assert.strictEqual(
      runtime.draftState,
      before,
      'a pre-flight rejection on a closed process never mutates draftState at all',
    );
  });

  test('RP-15.3: pushDraft() never touches the mounted iframe\'s identity — RP-15.3\'s "never re-parented" holds even when the draft cannot complete', async function (assert) {
    let runtime = createTestRuntime({ connectTimeout: 30 });
    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      let iframeBeforeDraft = runtime.iframe;
      let srcBeforeDraft = iframeBeforeDraft.getAttribute('src');
      let parentBeforeDraft = iframeBeforeDraft.parentElement;

      let result = await runtime.pushDraft({
        moduleIdentifier: 'https://realm.example/card.gts',
        source: 'export default class {}',
        moduleGraph: [],
        documentDeclaredModules: [],
      });

      assert.false(
        result.ok,
        'the draft cannot complete without a live child connection in this test harness',
      );
      assert.strictEqual(
        runtime.iframe,
        iframeBeforeDraft,
        'pushDraft() never mints, replaces, or re-mounts the iframe — the exact identity a real HMR generation must preserve',
      );
      assert.strictEqual(
        runtime.iframe.parentElement,
        parentBeforeDraft,
        'and never re-parents it either',
      );
      assert.strictEqual(
        runtime.iframe.getAttribute('src'),
        srcBeforeDraft,
        'nor does it reload it — pushDraft carries its source through the fetch-channel override, not a navigation',
      );
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('RP-15.3: a draft override is set immediately (before the wire round-trip settles) and survives an unmount/remount, but not a reloadSandbox()', async function (assert) {
    let runtime = createTestRuntime({ connectTimeout: 30 });
    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      let url = 'https://realm.example/card.gts';
      assert.false(runtime.hasDraftOverride(url));

      let pushed = runtime.pushDraft({
        moduleIdentifier: url,
        source: 'export default class {}',
        moduleGraph: [],
        documentDeclaredModules: [],
      });
      assert.true(
        runtime.hasDraftOverride(url),
        'the override is set synchronously, before the wire round-trip even begins — a fetch that races the in-flight push must already see it',
      );

      runtime.unmount();
      assert.true(
        runtime.hasDraftOverride(url),
        "an ordinary unmount (slot teardown, format switch) reuses this process's already-accumulated state — it must not silently revert to canonical source",
      );

      runtime.mount(slotElement);
      runtime.reloadSandbox();
      assert.false(
        runtime.hasDraftOverride(url),
        'only an explicit hard reload clears draft overrides',
      );

      await pushed;
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  // False positive (qunit/resolve-async): onReload()'s returned unsubscribe
  // function is a plain Web-API-style callback registration, not an
  // assert.async()/done() pair — every actual async operation in this test
  // is a properly-awaited pushDraft().
  // eslint-disable-next-line qunit/resolve-async
  test('RP-15.3: reloadSandbox() resets draftState to idle and notifies onReload — the signal a placeholder-handoff flag keyed on the old identity must invalidate on', async function (assert) {
    let runtime = createTestRuntime({ connectTimeout: 30 });
    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      await runtime.pushDraft({
        moduleIdentifier: 'https://realm.example/card.gts',
        source: 'export default class {}',
        moduleGraph: [],
        documentDeclaredModules: [],
      });
      assert.strictEqual(runtime.draftState.phase, 'failed');

      let reloadCount = 0;
      let stop = runtime.onReload(() => {
        reloadCount++;
      });
      let iframeBeforeReload = runtime.iframe;

      runtime.reloadSandbox();

      assert.strictEqual(
        reloadCount,
        1,
        'onReload fires exactly once per reloadSandbox() call',
      );
      assert.strictEqual(
        runtime.draftState.phase,
        'idle',
        'reloadSandbox() resets generation state — this is not an ordinary HMR generation',
      );
      assert.notStrictEqual(
        runtime.iframe,
        iframeBeforeReload,
        'reloadSandbox() remints the iframe — same unmount+mint machinery as an ordinary remount, giving it a fresh bootstrapId for free',
      );
      assert.strictEqual(
        runtime.iframe.parentElement,
        slotElement,
        'a process that was mounted before reloadSandbox() is automatically remounted into the SAME slot element — never a different one',
      );

      stop();
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('RP-15.3: reloadSandbox() on an unmounted process still clears state — nothing to remount, but the next mount() starts clean', async function (assert) {
    let runtime = createTestRuntime({ connectTimeout: 30 });
    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      await runtime.pushDraft({
        moduleIdentifier: 'https://realm.example/card.gts',
        source: 'export default class {}',
        moduleGraph: [],
        documentDeclaredModules: [],
      });
      runtime.unmount();
      assert.true(runtime.hasDraftOverride('https://realm.example/card.gts'));

      runtime.reloadSandbox();
      assert.false(runtime.hasDraftOverride('https://realm.example/card.gts'));
      assert.strictEqual(runtime.draftState.phase, 'idle');
      assert.false(
        runtime.iframe.isConnected,
        'nothing to remount into — reloadSandbox() does not mount an unmounted process',
      );
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('RP-15.3: reloadSandbox() and destroy() are both no-ops after the process is already closed', function (assert) {
    let runtime = createTestRuntime();
    runtime.destroy();
    let stateBefore = runtime.draftState;

    runtime.reloadSandbox();
    assert.strictEqual(
      runtime.draftState,
      stateBefore,
      'reloadSandbox() on a closed process does nothing',
    );

    runtime.destroy();
    assert.ok(true, 'a second destroy() does not throw');
  });
});
