import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { Loader, VirtualNetwork } from '@cardstack/runtime-common';
import { transpileJS } from '@cardstack/runtime-common/transpile';

// The realm transpiles card source before the loader ever sees it, and that
// transpile is what turns `import(spec)` into
// `import.meta.loader.import(spec)`. Going through it here is the point:
// these tests are about the loader's own resolution of the rewritten call,
// so a change to either half that breaks the pair shows up as a failure
// rather than as agreement between two stale halves.
const CONSUMER_URL = 'https://loader-dynamic-import.test/consumer.ts';
const CONSUMER_SOURCE = `
  export async function load(specifier) {
    return await import(specifier);
  }
  export async function loadSync() {
    return await import('sync-shimmed-pkg');
  }
  export async function loadAsync() {
    return await import('async-shimmed-pkg');
  }
  export async function loadPrefixed() {
    return await import('@shimmed-prefix/thing');
  }
  export async function loadUnshimmed() {
    return await import('nobody-shimmed-this');
  }
`;

// A regression here leaves a promise pending forever, which under a bare
// QUnit run means the process sits until the suite's own timeout with
// nothing said about which promise stalled. Racing a deadline turns that
// into an assertion about this call.
const SETTLE_DEADLINE_MS = 5000;
async function settleWithin<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} did not settle within ${SETTLE_DEADLINE_MS}ms`,
              ),
            ),
          SETTLE_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

type Consumer = Record<string, (specifier?: string) => Promise<any>>;

async function makeConsumer(
  shim: (virtualNetwork: VirtualNetwork) => void,
): Promise<{ loader: Loader; consumer: Consumer }> {
  let virtualNetwork = new VirtualNetwork();
  shim(virtualNetwork);
  let source = await transpileJS(CONSUMER_SOURCE, CONSUMER_URL);
  let loader = new Loader(
    async (urlOrRequest: any) => {
      let url = String(urlOrRequest?.url ?? urlOrRequest);
      if (url === CONSUMER_URL) {
        return new Response(source, {
          headers: { 'content-type': 'text/javascript' },
        });
      }
      // Anything else reaching the network means the shim registry did not
      // answer — the failure this suite exists to catch. Answering 404 keeps
      // it a rejection with the requested URL in it rather than a real
      // network call out of the test process.
      return new Response(`no module at ${url}`, { status: 404 });
    },
    virtualNetwork.resolveImport,
    { virtualNetwork },
  );
  return { loader, consumer: await loader.import<Consumer>(CONSUMER_URL) };
}

module(basename(import.meta.filename), function () {
  // Card code reaches host-provided packages through a runtime `import()` —
  // the natural spelling for a capture-only component that wants an engine
  // only at capture time. It resolves through the shim registry, the same as
  // the static form. An import that instead neither resolves nor rejects
  // burns a render's whole readiness budget and surfaces as an
  // unrelated-looking timeout.
  module('dynamic import of a shimmed bare specifier', function () {
    test('resolves a specifier registered with shimModule', async function (assert) {
      let { consumer } = await makeConsumer((virtualNetwork) =>
        virtualNetwork.shimModule('sync-shimmed-pkg', { value: 'sync' }),
      );
      let module = await settleWithin(
        consumer.loadSync(),
        `import('sync-shimmed-pkg')`,
      );
      assert.strictEqual(module.value, 'sync');
    });

    test('resolves a specifier registered with shimAsyncModule by id', async function (assert) {
      let { consumer } = await makeConsumer((virtualNetwork) =>
        virtualNetwork.shimAsyncModule({
          id: 'async-shimmed-pkg',
          resolve: async () => ({ value: 'async' }),
        }),
      );
      let module = await settleWithin(
        consumer.loadAsync(),
        `import('async-shimmed-pkg')`,
      );
      assert.strictEqual(module.value, 'async');
    });

    test('resolves a specifier registered with shimAsyncModule by prefix', async function (assert) {
      let { consumer } = await makeConsumer((virtualNetwork) =>
        virtualNetwork.shimAsyncModule({
          prefix: '@shimmed-prefix/',
          resolve: async () => ({ value: 'prefix' }),
        }),
      );
      let module = await settleWithin(
        consumer.loadPrefixed(),
        `import('@shimmed-prefix/thing')`,
      );
      assert.strictEqual(module.value, 'prefix');
    });

    // A shim resolves to one module, so the dynamic and static forms have to
    // hand back the same namespace object — otherwise a card that reaches an
    // engine both ways gets two copies of it, and anything that compares
    // identities across them disagrees.
    test('serves the same module the static form resolves to', async function (assert) {
      let { loader, consumer } = await makeConsumer((virtualNetwork) =>
        virtualNetwork.shimAsyncModule({
          id: 'async-shimmed-pkg',
          resolve: async () => ({ value: 'async' }),
        }),
      );
      let viaDynamic = await settleWithin(
        consumer.loadAsync(),
        `import('async-shimmed-pkg')`,
      );
      let viaStatic = await loader.import<any>('async-shimmed-pkg');
      assert.strictEqual(
        viaDynamic.value,
        viaStatic.value,
        'both forms expose the same export',
      );
      assert.strictEqual(
        loader.canonicalURLFor('async-shimmed-pkg'),
        'https://packages/async-shimmed-pkg',
        'the shim was served from the packages origin, not fetched',
      );
    });

    // A computed specifier can't be rewritten to a URL at build time, so the
    // loader sees the bare string at runtime with nothing else to go on. It
    // has to resolve the same way the literal form does.
    test('resolves a specifier that is only known at runtime', async function (assert) {
      let { consumer } = await makeConsumer((virtualNetwork) =>
        virtualNetwork.shimModule('sync-shimmed-pkg', { value: 'sync' }),
      );
      let module = await settleWithin(
        consumer.load('sync-shimmed-pkg'),
        'import(<computed specifier>)',
      );
      assert.strictEqual(module.value, 'sync');
    });
  });

  // A shim's resolver is caller-supplied, so the one thing that can still
  // park an import forever is a resolver that never answers. The loader
  // awaits it with no clock of its own; the handler's deadline is what keeps
  // that from reaching card code as a promise that never settles.
  module('dynamic import of a shim whose resolver stalls', function () {
    test('rejects with the specifier rather than parking the import forever', async function (assert) {
      let { consumer } = await makeConsumer((virtualNetwork) =>
        virtualNetwork.shimAsyncModule(
          {
            id: 'async-shimmed-pkg',
            resolve: () => new Promise<never>(() => {}),
          },
          // The real timer on a short deadline, so what this exercises is the
          // path a stalled resolver actually takes rather than a stub of it.
          { delay: async () => {}, retryDelaysMs: [], resolveDeadlineMs: 50 },
        ),
      );
      try {
        await settleWithin(consumer.loadAsync(), `import('async-shimmed-pkg')`);
        assert.ok(false, 'expected the import to reject');
      } catch (err: any) {
        assert.ok(
          /async-shimmed-pkg/.test(err.message),
          `rejection names the specifier: ${err.message}`,
        );
        assert.notOk(
          /did not settle/.test(err.message),
          'the rejection came from the shim deadline, not from this test',
        );
      }
    });
  });

  // A specifier nothing serves has to come back as an error naming it, on
  // the same deadline as a successful load — never as a promise that sits.
  module('dynamic import of an unresolvable bare specifier', function () {
    test('rejects with the specifier in the message rather than hanging', async function (assert) {
      let { consumer } = await makeConsumer(() => {});
      try {
        await settleWithin(
          consumer.loadUnshimmed(),
          `import('nobody-shimmed-this')`,
        );
        assert.ok(false, 'expected the import to reject');
      } catch (err: any) {
        assert.ok(
          /nobody-shimmed-this/.test(err.message),
          `rejection names the specifier: ${err.message}`,
        );
        assert.notOk(
          /did not settle/.test(err.message),
          'the rejection came from the loader, not from the deadline',
        );
      }
    });
  });
});
