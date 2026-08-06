import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  fetcher,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import { createSandboxModuleEvaluator } from '@cardstack/host/components/boxel-sandbox-runtime';
import DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import {
  SandboxFetchClient,
  SandboxFetchServer,
} from '@cardstack/host/lib/sandbox-fetch-transport';
import SandboxModuleAuthority from '@cardstack/host/lib/sandbox-module-authority';
import {
  SandboxRenderClient,
  SandboxRenderServer,
  type SandboxRenderTarget,
} from '@cardstack/host/lib/sandbox-render-transport';
import SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';

import type SurfaceService from '@cardstack/host/services/surface-service';

import type * as CardAPI from '@cardstack/base/card-api';

// RP-18 conformance suite: the Sandbox tier's source-volatility (HMR) v1
// un-deferral. This file adapts the strongest assertions from the round-10
// unit test files (sandbox-render-transport-test.ts,
// sandbox-fetch-transport-test.ts, sandbox-runtime-process-test.ts,
// direct-boxel-runtime-test.ts) into their focused, RP-cited conformance
// form. Those files keep their own, more exhaustive coverage; duplicated
// assertions here are the deliberately narrower slice that each RP-18
// statement's own sentence claims — see docs/boxel-rendering-protocol.md.

function fakeSurfaceService(): { service: SurfaceService } {
  let surface = 'surface:rp-hmr-test' as SurfaceHandle;
  let service = {
    register: () => surface,
    release: () => undefined,
    layout: () => undefined,
  } as unknown as SurfaceService;
  return { service };
}

function createRuntime(
  overrides: { connectTimeout?: number } = {},
): SandboxRuntimeProcess {
  let { service } = fakeSurfaceService();
  return new SandboxRuntimeProcess({
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
    connectTimeout: overrides.connectTimeout ?? 30,
  });
}

module('Unit | rp-hmr', function () {
  test('RP-18.1: every render-family request carries one process-monotonic generation the child echoes on its response, and a stale draft ack never overwrites the shared generation state a newer draft already settled', async function (assert) {
    let channel = new MessageChannel();
    let echoedGenerations: number[] = [];
    let target: SandboxRenderTarget = {
      render: () => {},
      clear: () => {},
      draft: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    channel.port2.addEventListener('message', (event) => {
      let response = event.data as { generation?: number };
      if (typeof response?.generation === 'number') {
        echoedGenerations.push(response.generation);
      }
    });
    channel.port2.start();
    let client = new SandboxRenderClient(channel.port2);

    try {
      await client.draft('https://realm.example/card.gts', 5);
      assert.deepEqual(
        echoedGenerations,
        [5],
        "the child's response echoes back the exact generation the parent's request carried",
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }

    // Parent-side half of the statement: draft/render state transitions
    // only on a matching echoed generation. Two pushDraft() calls share
    // one connection that will never complete in this unit-test harness
    // (no real child origin), so both eventually fail — but only the
    // LATER one may ever update the shared draftState; a late failure from
    // the superseded, older generation must be a silent no-op there, never
    // an error surface that clobbers what the newer generation already
    // settled to.
    let runtime = createRuntime();
    let slotElement = document.createElement('div');
    document.body.append(slotElement);
    try {
      runtime.mount(slotElement);
      let first = runtime.pushDraft({
        moduleIdentifier: 'https://realm.example/a.gts',
        source: 'a',
        moduleGraph: [],
        documentDeclaredModules: [],
      });
      let second = runtime.pushDraft({
        moduleIdentifier: 'https://realm.example/b.gts',
        source: 'b',
        moduleGraph: [],
        documentDeclaredModules: [],
      });

      let [firstResult, secondResult] = await Promise.all([first, second]);
      assert.false(firstResult.ok);
      assert.false(secondResult.ok);
      assert.strictEqual(
        runtime.draftState.generation,
        secondResult.generation,
        'draftState reflects the LATEST issued draft generation',
      );
      assert.strictEqual(
        runtime.draftState.phase,
        'failed',
        "the newer generation's own outcome is what the shared state carries",
      );
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('RP-18.2: the child drops a request whose generation is not newer than the latest it has observed, abandons in-flight work once a newer generation arrives (re-checked after every await), and a dropped generation is reported as dropped, not as a failure', async function (assert) {
    let channel = new MessageChannel();
    let ran: number[] = [];
    let target: SandboxRenderTarget = {
      render: async (_card, _format, generation) => {
        ran.push(generation);
        if (generation === 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
      },
      clear: () => {},
      draft: () => {},
    };
    let server = new SandboxRenderServer(channel.port1, target);
    let client = new SandboxRenderClient(channel.port2);

    try {
      let first = client.render('card:one' as never, 'isolated', 1);
      let second = client.render('card:one' as never, 'isolated', 2);
      let third = client.render('card:one' as never, 'isolated', 3);

      await first;
      let secondError: Error | undefined;
      try {
        await second;
      } catch (error) {
        secondError = error as Error;
      }
      await third;

      assert.deepEqual(
        ran,
        [1, 3],
        'generation 2 — still queued when generation 3 arrived — was dropped rather than dispatched at all',
      );
      assert.strictEqual(
        secondError?.name,
        'SandboxGenerationSuperseded',
        'reported as dropped — a distinct, non-error outcome — not as a genuine render failure',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-18.2: a target re-checks staleness after its own internal await and abandons in-flight work once a newer generation has ARRIVED, even before that newer generation is dispatched', async function (assert) {
    // The server's own arrival-time bookkeeping (`isStale`, surfaced to the
    // target via `setStaleCheck`) is what makes "re-checking after every
    // await" meaningful: the render queue is strictly serialized, so by
    // the time a newer request is actually DISPATCHED the older one has
    // always already finished — the only way an in-flight render can learn
    // "abandon me, something newer is already queued" is by consulting the
    // live check the server updates the moment a message ARRIVES, not
    // dispatch order.
    let channel = new MessageChannel();
    let abandoned: number[] = [];
    let committed: number[] = [];
    let isStale: ((generation: number) => boolean) | undefined;
    let releaseAwait!: () => void;
    let held = new Promise<void>((resolve) => {
      releaseAwait = resolve;
    });
    let notifyGeneration1Started!: () => void;
    let generation1Started = new Promise<void>((resolve) => {
      notifyGeneration1Started = resolve;
    });
    let target: SandboxRenderTarget = {
      render: async (_card, _format, generation) => {
        if (generation === 1) {
          // Signals that generation 1 has actually been DISPATCHED (not
          // merely posted) and is now parked on `held` — MessagePort
          // delivery is asynchronous, so posting a message is not the
          // same moment as the server actually processing it.
          notifyGeneration1Started();
        }
        await held;
        if (isStale?.(generation)) {
          abandoned.push(generation);
          return;
        }
        committed.push(generation);
      },
      clear: () => {},
      draft: () => {},
      setStaleCheck: (check) => {
        isStale = check;
      },
    };
    let server = new SandboxRenderServer(channel.port1, target);
    // In production this wiring is done by sandbox-runtime-host.ts, right
    // after constructing the server (see its own doc comment); replicated
    // here since this test constructs the server directly.
    target.setStaleCheck?.((generation) => server.isStale(generation));
    let client = new SandboxRenderClient(channel.port2);

    try {
      let first = client.render('card:one' as never, 'isolated', 1);
      // Wait for generation 1 to actually be parked on `held` before
      // posting generation 2 — otherwise "arrives while 1 is in flight"
      // isn't actually guaranteed: MessagePort delivery is asynchronous,
      // so releasing `held` immediately after posting both messages could
      // let generation 1's post-await continuation (a microtask, since
      // `held` would already be resolved by then) run before generation
      // 2's message has even been delivered to the server.
      await generation1Started;
      // A newer generation ARRIVES (the server records it immediately on
      // delivery) while generation 1 is still parked on `held` — its own
      // turn in the queue hasn't even started.
      let second = client.render('card:one' as never, 'isolated', 2);
      // Let generation 2's message actually be delivered to and recorded
      // by the server before releasing generation 1. A single
      // `setTimeout(0)` is NOT sufficient: MessagePort deliveries and
      // timer callbacks belong to different task sources, and the browser
      // may run the timer first even though the message was posted
      // earlier. Wait on the observable itself — the server's own
      // arrival-time bookkeeping reporting generation 1 stale — which is
      // exactly the state RP-18.2's re-check consults.
      let deadline = Date.now() + 2000;
      while (!server.isStale(1)) {
        if (Date.now() > deadline) {
          throw new Error(
            'generation 2 was never recorded by the server — MessagePort delivery did not happen within the bound',
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      releaseAwait();

      await first;
      await second;

      assert.deepEqual(
        abandoned,
        [1],
        "generation 1's own post-await re-check saw that generation 2 had already arrived and abandoned rather than applying stale output",
      );
      assert.deepEqual(
        committed,
        [2],
        'generation 2 — the latest — is unaffected and commits normally',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-18.3: a draft control message carries only the edited URL and its generation — never the source — and a draft override is matched by exact URL only, never a pattern', async function (assert) {
    let channel = new MessageChannel();
    let rawMessages: unknown[] = [];
    channel.port1.addEventListener('message', (event) => {
      rawMessages.push(event.data);
    });
    channel.port1.start();
    let client = new SandboxRenderClient(channel.port2);

    try {
      await client.draft('https://realm.example/card.gts', 3).catch(() => {
        // No server listening on this port — the point of this half of the
        // test is only to inspect the raw message shape that crossed the
        // wire, not to complete the round trip.
      });
      let [message] = rawMessages as {
        operation: string;
        url: string;
        generation: number;
        [key: string]: unknown;
      }[];
      assert.strictEqual(message?.operation, 'draft');
      assert.strictEqual(message?.url, 'https://realm.example/card.gts');
      assert.strictEqual(message?.generation, 3);
      assert.false(
        'source' in (message ?? {}),
        'the draft control message never carries the edited source text',
      );
    } finally {
      client.destroy();
      channel.port1.close();
      channel.port2.close();
    }

    // Second half of the statement: the draft's source crosses only
    // through the module-read channel's exact-URL override.
    let fetchChannel = new MessageChannel();
    let networkRequests: string[] = [];
    let drafts = new Map<string, string>([
      ['https://realm.example/card.gts', 'export const edited = true;'],
    ]);
    let allowed = new Set([
      'https://realm.example/card.gts',
      'https://realm.example/card-v2.gts',
    ]);
    let fetchServer = new SandboxFetchServer(
      fetchChannel.port1,
      async (input) => {
        networkRequests.push(String(input));
        return new Response('export const edited = false;', {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        });
      },
      (url) => allowed.has(url),
      undefined,
      (url) => drafts.get(url),
    );
    let fetchClient = new SandboxFetchClient(fetchChannel.port2);
    fetchChannel.port1.start();
    fetchChannel.port2.start();

    try {
      let drafted = await fetchClient.fetch('https://realm.example/card.gts');
      assert.strictEqual(await drafted.text(), 'export const edited = true;');
      assert.deepEqual(
        networkRequests,
        [],
        'the drafted URL is served from the override without ever reaching the network',
      );

      let similarButNotIdentical = await fetchClient.fetch(
        'https://realm.example/card-v2.gts',
      );
      assert.strictEqual(
        await similarButNotIdentical.text(),
        'export const edited = false;',
        'a URL that is merely similar (not identical) falls through to the network — the override is exact-URL only, never pattern-matched',
      );
    } finally {
      fetchClient.destroy();
      fetchServer.destroy();
      fetchChannel.port1.close();
      fetchChannel.port2.close();
    }
  });

  test("RP-18.3: authority re-allows exactly the draft's own module graph plus document-declared modules — an import the draft never declared stays denied", async function (assert) {
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    // The card's original, pre-edit graph.
    authority.allow(['https://realm.example/card.gts']);

    // The edit introduces a new import — classification of the DRAFT
    // discovers it, and the Host re-allows the draft's own module graph
    // (plus document-declared modules, here none) before ever admitting
    // its source.
    authority.allow([
      'https://realm.example/card.gts',
      'https://realm.example/color-helpers.gts',
    ]);

    assert.true(
      authority.has('https://realm.example/color-helpers.gts'),
      'the import the edit alone introduced is admitted',
    );
    assert.false(
      authority.has('https://realm.example/unrelated-sibling.gts'),
      'admission never widens beyond the literal reachable graph — a module the draft never imported stays denied even after growth',
    );
  });

  test("RP-18.4: a draft invalidates only the edited module in the child's loader — an unrelated module already cached stays cached, never re-fetched", async function (assert) {
    let channel = new MessageChannel();
    let requested: string[] = [];
    let sources: Record<string, string> = {
      'https://realm.example/edited.gts': 'export const value = 1;',
      'https://realm.example/unrelated.gts': 'export const value = 2;',
    };
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    authority.allow(Object.keys(sources));
    let server = new SandboxFetchServer(
      channel.port1,
      async (input) => {
        let url = String(input);
        requested.push(url);
        return new Response(sources[url] ?? 'not found', {
          status: sources[url] ? 200 : 404,
        });
      },
      (url) => authority.has(url),
      (url, contentType, body) => authority.observe(url, contentType, body),
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    let virtualNetwork = new VirtualNetwork(globalThis.fetch);
    virtualNetwork.mount((request: Request) => client.fetch(request));
    let fetchFn = fetcher(virtualNetwork.fetch, [], virtualNetwork);
    let loader: Loader = new Loader(fetchFn, virtualNetwork.resolveImport, {
      virtualNetwork,
      moduleEvaluator: createSandboxModuleEvaluator(() => loader),
    });

    try {
      await loader.import('https://realm.example/edited.gts');
      await loader.import('https://realm.example/unrelated.gts');
      assert.deepEqual(requested, [
        'https://realm.example/edited.gts',
        'https://realm.example/unrelated.gts',
      ]);

      loader.invalidateModule('https://realm.example/edited.gts');

      await loader.import('https://realm.example/edited.gts');
      await loader.import('https://realm.example/unrelated.gts');
      assert.deepEqual(
        requested,
        [
          'https://realm.example/edited.gts',
          'https://realm.example/unrelated.gts',
          'https://realm.example/edited.gts',
        ],
        'only the invalidated module was re-fetched — the unrelated one stayed cached, never re-requested',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-18.4: a draft re-derives the card from the identical retained document — instance data state survives the generation; only module/component identity changes', async function (assert) {
    let created: { resource: unknown; document: unknown }[] = [];
    let currentInstance: { tag: string } = { tag: 'first' };
    let getCardAPI = async () =>
      ({
        createFromSerialized: async (
          resource: LooseCardResource,
          document: LooseSingleCardDocument,
        ) => {
          created.push({ resource, document });
          return currentInstance;
        },
        serializeCard: async (instance: { tag: string }) => ({
          data: { id: instance.tag },
        }),
      }) as unknown as typeof CardAPI;
    let runtime = new DirectBoxelRuntime(getCardAPI);
    let resource = {
      id: 'https://realm.example/Card/1',
      type: 'card',
      attributes: {},
      relationships: {},
      meta: {
        adoptsFrom: { module: 'https://realm.example/card', name: 'Card' },
      },
    } as unknown as LooseCardResource;
    let document = { data: resource } as unknown as LooseSingleCardDocument;

    let handle = await runtime.createFromSerialized(
      resource,
      document,
      undefined,
      'host-display',
    );

    currentInstance = { tag: 'second' };
    await runtime.redeserialize(handle);

    assert.deepEqual(
      created[1],
      { resource, document },
      'the SAME retained resource/document was reused — nothing about the card data was re-sent or re-derived from anywhere else',
    );
    let serialized = await runtime.serializeCard(handle);
    assert.strictEqual(
      (serialized as unknown as { data: { id: string } }).data.id,
      'second',
      'the SAME handle now resolves to the redeserialized instance — only its module/component identity changed',
    );
  });

  test('RP-18.5: a failed generation — compile-time or render-time alike — leaves the previous successful render mounted, with the failure carried alongside as state rather than replacing it', async function (assert) {
    // Compile-time (a module that fails to evaluate/import) and render-time
    // (a module that evaluates but throws while rendering) failures both
    // reach the child the same way: draft()'s redeserialize()/render call
    // throws, SandboxRenderServer's queue turns that into an ok:false ack
    // without the child ever touching its own last-known-good DOM (see
    // boxel-sandbox-runtime.gts's draft() — it only mutates
    // renderedComponent/error AFTER redeserialize+render both succeed, so
    // any throw before that point — whichever stage produced it — leaves
    // the previous render fully untouched by construction, not by a
    // try/catch that restores it after the fact).
    //
    // This process-level test proves the PARENT half of that guarantee,
    // using the one failure mode this unit-test harness (no real child
    // origin) can actually produce on its own — a connect timeout, not a
    // genuine compile/render throw: pushDraft() failure never disturbs the
    // mounted iframe, and the shared draftState carries the failure as
    // state alongside whatever lastKnownGoodGeneration already existed,
    // rather than clearing it. The CHILD half (a redeserialize()/render
    // throw specifically never clearing renderedComponent/error) is
    // covered directly by direct-boxel-runtime-test.ts's redeserialize
    // failure case and by this file's own RP-18.4 test's control-flow
    // guarantee.
    let runtime = createRuntime();
    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      let iframeBeforeDraft = runtime.iframe;
      let lastKnownGoodBefore = runtime.draftState.lastKnownGoodGeneration;

      let result = await runtime.pushDraft({
        moduleIdentifier: 'https://realm.example/card.gts',
        source: 'export default class {}',
        moduleGraph: [],
        documentDeclaredModules: [],
      });

      assert.false(result.ok);
      assert.strictEqual(runtime.draftState.phase, 'failed');
      assert.ok(runtime.draftState.error, 'the failure is carried as state');
      assert.strictEqual(
        runtime.draftState.lastKnownGoodGeneration,
        lastKnownGoodBefore,
        'a failed generation never clobbers the last-known-good generation',
      );
      assert.strictEqual(
        runtime.iframe,
        iframeBeforeDraft,
        'the previously mounted render (its iframe) is left exactly as it was — a failed generation never remounts',
      );
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('RP-18.6: no draft generation ever changes iframe identity — only reloadSandbox() remints, with a new bootstrap identity, cleared draft overrides, reset module authority, and an onReload notification for placeholder invalidation', async function (assert) {
    let runtime = createRuntime();
    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      let iframeBeforeDraft = runtime.iframe;
      let parentBeforeDraft = iframeBeforeDraft.parentElement;
      let url = 'https://realm.example/card.gts';

      await runtime.pushDraft({
        moduleIdentifier: url,
        source: 'export default class {}',
        moduleGraph: ['https://realm.example/helper.gts'],
        documentDeclaredModules: [],
      });

      assert.strictEqual(
        runtime.iframe,
        iframeBeforeDraft,
        'an ordinary draft generation never changes iframe identity',
      );
      assert.strictEqual(runtime.iframe.parentElement, parentBeforeDraft);
      assert.true(runtime.hasDraftOverride(url));
      assert.true(runtime.isModuleAdmitted('https://realm.example/helper.gts'));

      let reloadCount = 0;
      let stopReload = runtime.onReload(() => {
        reloadCount++;
      });

      runtime.reloadSandbox();

      assert.notStrictEqual(
        runtime.iframe,
        iframeBeforeDraft,
        'only the explicit hard reload remints the process — a new iframe, and therefore a new bootstrap identity on its next connect()',
      );
      assert.strictEqual(
        runtime.iframe.parentElement,
        slotElement,
        'remounted into the same slot it was already in',
      );
      assert.false(
        runtime.hasDraftOverride(url),
        'draft overrides are cleared',
      );
      assert.false(
        runtime.isModuleAdmitted('https://realm.example/helper.gts'),
        'module authority is reset to nothing granted',
      );
      assert.strictEqual(
        reloadCount,
        1,
        'onReload fires — the signal a placeholder keyed on the old identity must invalidate on',
      );

      stopReload();
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });

  test('RP-18.7: an ordinary draft never re-enters the placeholder — the only mechanism that would (unmount(), which resets paint state and clears its listeners) is never invoked by a draft generation', async function (assert) {
    let runtime = createRuntime();
    let slotElement = document.createElement('div');
    document.body.append(slotElement);

    try {
      runtime.mount(slotElement);
      let iframeBeforeDraft = runtime.iframe;
      let paintedBefore = runtime.hasPainted;
      let firstPaintFired = false;
      let stopWatching = runtime.onFirstPaint(() => {
        firstPaintFired = true;
      });

      await runtime.pushDraft({
        moduleIdentifier: 'https://realm.example/card.gts',
        source: 'export default class {}',
        moduleGraph: [],
        documentDeclaredModules: [],
      });

      // unmount() is the ONLY code path that resets `painted` and clears
      // paintListeners (sandbox-runtime-process.ts); this draft provably
      // left the iframe exactly as it was (RP-18.6), so paint/placeholder-
      // handoff state is provably undisturbed too — a draft generation
      // never re-arms (or spuriously fires) the placeholder hand-off.
      assert.strictEqual(runtime.iframe, iframeBeforeDraft);
      assert.strictEqual(
        runtime.hasPainted,
        paintedBefore,
        'a draft generation does not touch paint state at all',
      );
      assert.false(
        firstPaintFired,
        'a failed (or, by the same never-touched-paint-state guarantee, a successful) ordinary draft never spuriously (re-)fires onFirstPaint',
      );

      stopWatching();
    } finally {
      runtime.destroy();
      slotElement.remove();
    }
  });
});
