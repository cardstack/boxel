import 'ses';

import { waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  fetcher,
  type LooseCardResource,
} from '@cardstack/runtime-common';

import {
  createSandboxModuleEvaluator,
  measureRenderedOutput,
  rewriteDynamicImports,
} from '@cardstack/host/components/boxel-sandbox-runtime';
import CardRenderer from '@cardstack/host/components/card-renderer';

import {
  SandboxMatrixServiceStub,
  initialize as initializeSandboxMatrixServiceStub,
} from '@cardstack/host/instance-initializers/stub-matrix-service-for-sandbox';
import { classifyBoxelSource } from '@cardstack/host/lib/boxel-source-classifier';
import {
  SandboxFetchClient,
  SandboxFetchServer,
} from '@cardstack/host/lib/sandbox-fetch-transport';
import SandboxModuleAuthority from '@cardstack/host/lib/sandbox-module-authority';
import {
  installSandboxRuntimeErrorReporter,
  postRenderDiagnostic,
} from '@cardstack/host/lib/sandbox-runtime-host';
import { isBoxelSandboxRuntimeBoot } from '@cardstack/host/routes/boxel-sandbox-runtime';

import {
  testRealmURL,
  testRRI,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { BaseDef, CardDef, Format } from '@cardstack/base/card-api';

// A CardDef whose module directly imports a raw browser-authority package
// (`ember-modifier`) rather than going through Base's trusted component
// primitives. RP-6.1 (R2) requires the classifier to route this to the
// Sandbox tier: the entry point for the origin-isolated iframe renderer that
// hosts cards like a Three.js WebGL scene.
const webglWidgetSource = `
  import {
    CardDef,
    Component,
    contains,
    field,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';
  import { modifier } from 'ember-modifier';

  const paintLabel = modifier((element, [text]) => {
    element.textContent = text;
  });

  export class WebglWidget extends CardDef {
    static displayName = 'WebglWidget';
    @field label = contains(StringField);
    static isolated = class Isolated extends Component<typeof WebglWidget> {
      <template>
        <div data-test-webgl-widget {{paintLabel @model.label}}></div>
      </template>
    };
  }
`;

async function renderThroughExecutionRenderer(card: BaseDef, format?: Format) {
  await renderComponent(
    class TestDriver extends GlimmerComponent {
      <template>
        <CardRenderer @card={{card}} @format={{format}} @execution='auto' />
      </template>
    },
  );
}

module('Integration | rp-sandbox', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'webgl-widget.gts': webglWidgetSource,
        },
      }),
    );
  });

  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  async function createFromResource(
    resource: LooseCardResource,
  ): Promise<CardDef> {
    let store = getService('store');
    return await store.__dangerousCreateFromSerialized(
      resource,
      { data: resource },
      new URL(testRealmURL),
    );
  }

  async function createWidget(
    overrides: Partial<LooseCardResource> = {},
  ): Promise<CardDef> {
    return await createFromResource({
      attributes: { label: 'hello' },
      meta: {
        adoptsFrom: { module: testRRI('webgl-widget'), name: 'WebglWidget' },
      },
      ...overrides,
    });
  }

  test('RP-6.1: a module that imports a raw browser-authority package classifies to the Sandbox tier', async function (assert) {
    let classification = await classifyBoxelSource(webglWidgetSource);

    assert.strictEqual(
      classification.tier,
      'sandbox',
      'a raw ember-modifier import requires the stronger process boundary (RP-6.1 R2)',
    );
    assert.true(
      classification.reason.startsWith('browser-runtime:'),
      'the routing decision names the browser-runtime signal that triggered it',
    );
    assert.true(
      classification.signals.includes('ember-modifier'),
      'the specific signal detected is the raw ember-modifier import',
    );
  });

  test('RP-15.3, RP-6.4: mounting a Sandbox-routed card creates a real, credentialless iframe and fails closed to the chrome error presentation when the child cannot complete its bootstrap', async function (assert) {
    let card = await createWidget();

    await renderThroughExecutionRenderer(card, 'isolated');

    // SandboxRuntimeProcess.connect() creates the iframe and sets its `src`
    // synchronously as soon as routing selects the Sandbox tier, well before
    // any handshake with the child. It is parked off-screen (never `hidden`,
    // so its layout stays live) until the render slot is granted, in a
    // container appended directly to `document.body` — outside the
    // `#ember-testing` root that `waitFor`/`assert.dom` are scoped to, so
    // this polls the whole document directly instead.
    let iframeSelector =
      '[data-boxel-sandbox-processes] iframe.boxel-sandbox-process';
    await waitUntil(() => document.querySelector(iframeSelector), {
      timeout: 5000,
    });
    let iframe = document.querySelector<HTMLIFrameElement>(iframeSelector);
    assert.ok(
      iframe,
      'a real iframe element is created for the Sandbox process',
    );
    assert.strictEqual(
      iframe?.getAttribute('sandbox'),
      'allow-scripts allow-same-origin',
      'the iframe carries the origin-isolation sandbox attribute',
    );
    assert.true(
      iframe?.hasAttribute('credentialless'),
      'the iframe is credentialless: no ambient cookies or storage cross into it',
    );
    let src = iframe?.getAttribute('src') ?? '';
    assert.true(
      src.includes('/_boxel-sandbox-runtime'),
      'the iframe is addressed at the sandbox bootstrap route',
    );
    assert.true(
      src.includes('bootstrapId='),
      'the bootstrap carries a per-process, unguessable bootstrap id',
    );

    // This integration-test harness does not serve the Sandbox child's
    // origin (`user.localhost`), so the bootstrap handshake this iframe just
    // started can never complete. RP-15.3 requires that a Sandbox render
    // never go silently blank when that happens: it must fail closed to the
    // same chrome error presentation Direct/Capsule use, and never mount the
    // Sandbox slot or any authored content, rather than leaving the viewer
    // looking at an empty rectangle. (SandboxRuntimeProcess's connect
    // timeout defaults to 15s.)
    await waitFor('.boxel-execution-error', { timeout: 20000 });
    assert
      .dom('.boxel-execution-error')
      .hasAttribute(
        'role',
        'alert',
        'chrome owns the error presentation, matching the Direct/Capsule failure contract (RP-15.1)',
      );
    assert
      .dom('[data-test-webgl-widget]')
      .doesNotExist(
        'no authored content ever renders around the failed handshake',
      );
    assert
      .dom('[data-boxel-execution="sandbox"]')
      .doesNotExist(
        'the Sandbox slot never mounts when the child never becomes ready',
      );
  });

  test('RP-15.3: an uncaught error or unhandled rejection before ready is held and released as a single runtime-error control message once ready posts', async function (assert) {
    let channel = new MessageChannel();
    let received: {
      kind: string;
      transportVersion: number;
      type: string;
      error: { name: string; message: string };
    }[] = [];
    channel.port2.addEventListener('message', (event) => {
      received.push(event.data);
    });
    channel.port2.start();
    channel.port1.start();

    // Listeners are installed before module evaluation begins (not after
    // 'ready'), so a module's own top-level side effect, or a promise it
    // eagerly kicks off, can reject in a microtask before bootstrap ever
    // reaches 'ready'. Posting that immediately would race the parent's own
    // bootstrap-vs-failure handling, so it is held until release().
    let reporter = installSandboxRuntimeErrorReporter(channel.port1);
    try {
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: new Error('boom during bootstrap'),
          message: 'boom during bootstrap',
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(
        received.length,
        0,
        'a failure before release() is held, not posted immediately',
      );

      reporter.release();
      await waitUntil(() => received.length > 0, { timeout: 2000 });
      assert.strictEqual(
        received.length,
        1,
        'release() flushes exactly the held failure',
      );
      let [message] = received;
      assert.strictEqual(message?.kind, 'boxel-sandbox-control');
      assert.strictEqual(message?.type, 'runtime-error');
      assert.strictEqual(message?.error.message, 'boom during bootstrap');

      // A runtime-error is a terminal, once-only signal: neither a second
      // pre-release failure nor a post-release one reopens it.
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: new Error('after release'),
          message: 'after release',
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.strictEqual(
        received.length,
        1,
        'a runtime-error is a terminal, once-only signal',
      );
    } finally {
      reporter.stop();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a held pre-release failure is discarded by stop() rather than posted, since a bootstrap failure is already reported as failed', async function (assert) {
    let channel = new MessageChannel();
    let received: unknown[] = [];
    channel.port2.addEventListener('message', (event) => {
      received.push(event.data);
    });
    channel.port2.start();
    channel.port1.start();

    let reporter = installSandboxRuntimeErrorReporter(channel.port1);
    window.dispatchEvent(
      new ErrorEvent('error', { error: new Error('boom'), message: 'boom' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Mirrors the bootstrap catch path: stop(), never release(), because a
    // 'failed' control message already covers this case.
    reporter.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(
      received.length,
      0,
      'a held failure discarded by stop() never posts, so it cannot double-report alongside failed',
    );
    channel.port1.close();
    channel.port2.close();
  });

  test('RP-15.3: rewriteDynamicImports rewrites only real dynamic import() call sites, leaving comments and string contents untouched', function (assert) {
    let source = `
export async function loadThree() {
  // a comment mentioning import(x) should not be rewritten
  let note = "please don't call import(fake) in here";
  const THREE = await import('https://esm.sh/three@0.160.0');
  return { THREE, note };
}
`;
    let rewritten = rewriteDynamicImports(source);

    assert.true(
      rewritten.includes(
        "__boxelDynamicImport__('https://esm.sh/three@0.160.0')",
      ),
      'the real dynamic import call site is rewritten to route through the guarded loader',
    );
    assert.true(
      rewritten.includes(
        '// a comment mentioning import(x) should not be rewritten',
      ),
      'comment text that happens to contain "import(" is untouched',
    );
    assert.true(
      rewritten.includes(`"please don't call import(fake) in here"`),
      'string literal text that happens to contain "import(" is untouched',
    );
  });

  test('RP-15.3: a dynamic import() embedded in authored source is routed through the same Loader and module-authority check as a static import', async function (assert) {
    // `transpileAmd` only rewrites static import/export declarations — a
    // dynamic `import(...)` call inside a module's own body (the common way
    // a card lazily loads a heavyweight third-party library like Three.js)
    // survives untouched into the eval'd factory, where a bare `eval()`
    // would run it as a real native dynamic import: resolved against
    // whatever script happens to be executing, and fetched without ever
    // reaching SandboxFetchClient. createSandboxModuleEvaluator closes that
    // gap by rewriting those call sites to route through the same Loader
    // (and therefore the same authority-checked SandboxFetchClient) as
    // every static import.
    let channel = new MessageChannel();
    let sources: Record<string, string> = {
      'https://realm.example/fabrication-viewer':
        "export async function loadThree() {\n  const THREE = await import('https://esm.sh/three@0.160.0');\n  return THREE;\n}\n",
      'https://esm.sh/three@0.160.0':
        "export * from '/three@0.160.0/es2022/three.mjs';",
      'https://esm.sh/three@0.160.0/es2022/three.mjs':
        'export const REVISION = "160";',
    };
    let requested: string[] = [];
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    authority.allow([
      'https://realm.example/fabrication-viewer',
      'https://esm.sh/three@0.160.0',
    ]);
    let server = new SandboxFetchServer(
      channel.port1,
      async (input) => {
        let url = String(input);
        requested.push(url);
        let source = sources[url];
        return source === undefined
          ? new Response('not found', { status: 404 })
          : new Response(source, { status: 200 });
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
      let mod = await loader.import<{
        loadThree: () => Promise<{ REVISION: string }>;
      }>('https://realm.example/fabrication-viewer');
      let three = await mod.loadThree();

      assert.strictEqual(
        three.REVISION,
        '160',
        'the dynamically imported module evaluates and its export is usable',
      );
      assert.deepEqual(
        requested,
        [
          'https://realm.example/fabrication-viewer',
          'https://esm.sh/three@0.160.0',
          'https://esm.sh/three@0.160.0/es2022/three.mjs',
        ],
        "the dynamic import and its own declared sub-import both crossed the authority-checked SandboxFetchClient broker at esm.sh's real origin, exactly like a static import",
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: an esm.sh third-party module response is admitted and its own declared imports are recursively observed even without a javascript content-type', async function (assert) {
    // Three.js-style cards load third-party packages from esm.sh. The
    // classified graph must admit an esm.sh entry module's own declared
    // sub-imports the same way it does for any other admitted module, even
    // though esm.sh does not reliably label every response as javascript
    // (SandboxModuleAuthority's `isJavaScript` special-cases the esm.sh
    // hostname for exactly this reason).
    let channel = new MessageChannel();
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    authority.allow(['https://esm.sh/three@0.160.0']);
    let sources: Record<string, string> = {
      'https://esm.sh/three@0.160.0':
        "export * from '/three@0.160.0/es2022/three.mjs';",
      'https://esm.sh/three@0.160.0/es2022/three.mjs':
        'export const REVISION = "160";',
    };
    let server = new SandboxFetchServer(
      channel.port1,
      async (input) => {
        let url = String(input);
        let source = sources[url];
        // Deliberately no content-type header: the Fetch spec default for a
        // string body is text/plain, not javascript.
        return source === undefined
          ? new Response('not found', { status: 404 })
          : new Response(source, { status: 200 });
      },
      (url) => authority.has(url),
      (url, contentType, body) => authority.observe(url, contentType, body),
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      await client.fetch('https://esm.sh/three@0.160.0');
      let dependency = await client.fetch(
        'https://esm.sh/three@0.160.0/es2022/three.mjs',
      );
      assert.strictEqual(
        await dependency.text(),
        'export const REVISION = "160";',
        "the entry module's own declared sub-import is admitted despite a non-javascript content-type",
      );
      await assert.rejects(
        client.fetch('https://esm.sh/some-unrelated-package@1.0.0'),
        /outside its classified graph/,
        'admission does not widen to sibling esm.sh packages the module never declared',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.1: isBoxelSandboxRuntimeBoot reflects the current URL, the gate boot-time app-level service startup (matrix/realm/session) consults', function (assert) {
    assert.false(
      isBoxelSandboxRuntimeBoot(),
      'the normal test document is not the Sandbox bootstrap route',
    );

    // history.pushState changes window.location without a real navigation
    // or notifying Ember's own router — exactly what an instance-initializer
    // observes (it runs before the Router has matched anything), and safely
    // reversible for the rest of the suite.
    let originalURL = window.location.href;
    let candidatePathnames = [
      '/_boxel-sandbox-runtime',
      // A deployment's rootURL (an Ember app served under a base path)
      // would prefix the served pathname with strict equality — this is
      // why the check is a substring match, not `pathname === ...`.
      '/host/_boxel-sandbox-runtime',
      // A trailing slash likewise defeats strict equality.
      '/_boxel-sandbox-runtime/',
    ];
    try {
      for (let pathname of candidatePathnames) {
        window.history.pushState(
          null,
          '',
          `${pathname}?bootstrapId=test&parentOrigin=https://host.example`,
        );
        assert.true(
          isBoxelSandboxRuntimeBoot(),
          `the Sandbox bootstrap route is detected for pathname "${pathname}" — instance-initializers (register-auth-service-worker.ts) rely on exactly this to skip eagerly constructing MatrixService, whose constructor otherwise starts requestStorageAccess()/SDK connection inside the credentialless iframe`,
        );
      }
    } finally {
      window.history.pushState(null, '', originalURL);
    }
    assert.false(
      isBoxelSandboxRuntimeBoot(),
      'restored to the non-Sandbox URL after the assertion',
    );
  });

  test('RP-15.1: the Sandbox boot registers a matrix-service stub only on the Sandbox route, and only that one registration', function (assert) {
    // register-auth-service-worker.ts gating its OWN eager matrix-service
    // lookup was not sufficient: ClientTelemetryService's constructor
    // unconditionally reads `this.matrixService.userId`, lazily constructing
    // the real MatrixService (whose constructor immediately starts
    // requestStorageAccess()/SDK load) regardless. This initializer instead
    // wins the `service:matrix-service` registration race for the whole
    // Sandbox app instance, so it doesn't matter which consumer looks it up
    // first — a fake ApplicationInstance stands in for the real one here so
    // the registration call itself is observable without booting an app.
    let registered: { key: string; factory: unknown }[] = [];
    let fakeAppInstance = {
      register: (key: string, factory: unknown) => {
        registered.push({ key, factory });
      },
    } as unknown as Parameters<typeof initializeSandboxMatrixServiceStub>[0];

    initializeSandboxMatrixServiceStub(fakeAppInstance);
    assert.strictEqual(
      registered.length,
      0,
      'outside the Sandbox route, the real matrix-service is left alone',
    );

    let originalURL = window.location.href;
    try {
      window.history.pushState(
        null,
        '',
        '/_boxel-sandbox-runtime?bootstrapId=test&parentOrigin=https://host.example',
      );
      initializeSandboxMatrixServiceStub(fakeAppInstance);
    } finally {
      window.history.pushState(null, '', originalURL);
    }

    assert.strictEqual(
      registered.length,
      1,
      'the Sandbox route registers exactly one replacement for matrix-service',
    );
    assert.strictEqual(registered[0]?.key, 'service:matrix-service');
    assert.strictEqual(
      registered[0]?.factory,
      SandboxMatrixServiceStub,
      'the registered factory is the stub, not the real MatrixService',
    );

    let stub = SandboxMatrixServiceStub.create() as unknown as Record<
      string,
      unknown
    >;
    assert.strictEqual(
      stub['userId'],
      undefined,
      'a property read a lazy-matrix consumer already treats as optional (userId ?? null) degrades to undefined, not a throw',
    );
  });

  test('RP-15.3: measureRenderedOutput distinguishes a populated render root from one that acked but painted nothing', function (assert) {
    assert.deepEqual(
      measureRenderedOutput(null, 'isolated'),
      {
        format: 'isolated',
        elementCount: 0,
        textLength: 0,
        hasVisibleContent: false,
      },
      'a missing render root (the mount point never appeared) measures as no visible content',
    );

    let empty = document.createElement('main');
    document.body.append(empty);
    try {
      let diagnostic = measureRenderedOutput(empty, 'isolated');
      assert.strictEqual(diagnostic.elementCount, 0);
      assert.strictEqual(diagnostic.textLength, 0);
      assert.false(
        diagnostic.hasVisibleContent,
        'an existing but empty render root (render() resolved, nothing rendered inside it) still measures as no visible content — this is the "acked but painted nothing" case',
      );
    } finally {
      empty.remove();
    }

    let populated = document.createElement('main');
    populated.innerHTML = '<div><span>Track: corridor-take-one</span></div>';
    document.body.append(populated);
    try {
      let diagnostic = measureRenderedOutput(populated, 'isolated');
      assert.strictEqual(
        diagnostic.elementCount,
        2,
        'counts every descendant element',
      );
      assert.strictEqual(
        diagnostic.textLength,
        'Track: corridor-take-one'.length,
      );
      assert.true(
        diagnostic.hasVisibleContent,
        'a render root with real content measures as visible',
      );
    } finally {
      populated.remove();
    }
  });

  test('RP-15.3: postRenderDiagnostic posts a bounded render-diagnostic message on the control port', async function (assert) {
    let channel = new MessageChannel();
    let received: unknown[] = [];
    channel.port2.addEventListener('message', (event) => {
      received.push(event.data);
    });
    channel.port2.start();
    channel.port1.start();

    postRenderDiagnostic(channel.port1, {
      format: 'isolated',
      elementCount: 3,
      textLength: 42,
      hasVisibleContent: true,
    });

    await waitUntil(() => received.length > 0, { timeout: 2000 });
    let [message] = received as {
      kind: string;
      transportVersion: number;
      format: string;
      elementCount: number;
      textLength: number;
      hasVisibleContent: boolean;
    }[];
    assert.strictEqual(message?.kind, 'boxel-sandbox-render-diagnostic');
    assert.strictEqual(message?.format, 'isolated');
    assert.strictEqual(message?.elementCount, 3);
    assert.strictEqual(message?.textLength, 42);
    assert.true(message?.hasVisibleContent);

    channel.port1.close();
    channel.port2.close();
  });
});
