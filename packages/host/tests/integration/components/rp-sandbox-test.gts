import 'ses';

import { waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  BOXEL_SURFACE_PROTOCOL_VERSION,
  Loader,
  VirtualNetwork,
  fetcher,
  type LooseCardResource,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import {
  createSandboxModuleEvaluator,
  measureRenderedOutput,
  reportIntrinsicHeight,
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
import SandboxRuntimeProcess from '@cardstack/host/lib/sandbox-runtime-process';
import { SandboxSurfaceClient } from '@cardstack/host/lib/sandbox-surface-transport';
import { isBoxelSandboxRuntimeBoot } from '@cardstack/host/routes/boxel-sandbox-runtime';

import type SurfaceServiceType from '@cardstack/host/services/surface-service';

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

  test('RP-15.3, RP-6.4: mounting a Sandbox-routed card creates a real, credentialless iframe BORN inside its own presentation slot, and fails closed to the chrome error presentation when the child cannot complete its bootstrap', async function (assert) {
    let card = await createWidget();

    await renderThroughExecutionRenderer(card, 'isolated');

    // getRenderSlot() no longer awaits the full connect+render handshake
    // before resolving — it can't: the iframe cannot exist until it has a
    // permanent mount point, and that mount point is the slot element this
    // very resolution causes the Host to render. So the Sandbox slot (and
    // the iframe mounted inside it) appears promptly, well before any
    // handshake with the child completes.
    await waitFor('[data-boxel-execution="sandbox"]', { timeout: 5000 });
    let iframeSelector =
      '[data-boxel-execution="sandbox"] iframe.boxel-sandbox-process';
    await waitFor(iframeSelector, { timeout: 5000 });
    let iframe = document.querySelector<HTMLIFrameElement>(iframeSelector);
    assert.ok(
      iframe,
      'a real iframe element is created for the Sandbox process',
    );
    assert.strictEqual(
      iframe?.parentElement,
      document.querySelector('[data-boxel-execution="sandbox"]'),
      'the iframe is a direct child of its presentation slot — born there, not moved there',
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
    // same chrome error presentation Direct/Capsule use, tearing down the
    // Sandbox slot (and the failed process/iframe with it — the presentation
    // slot modifier's own teardown calls unmount()) rather than leaving a
    // dead, booting-forever iframe on screen. (SandboxRuntimeProcess's
    // connect timeout defaults to 15s; onMountFailed is what turns that
    // background failure into this visible state, since getRenderSlot()
    // already returned successfully before the timeout could fire.)
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
        'the Sandbox slot (and its failed iframe) is torn down once the handshake is known to have failed',
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
    let missing = measureRenderedOutput(null, 'isolated');
    assert.strictEqual(missing.format, 'isolated');
    assert.strictEqual(missing.elementCount, 0);
    assert.strictEqual(missing.textLength, 0);
    assert.false(
      missing.hasVisibleContent,
      'a missing render root (the mount point never appeared) measures as no visible content',
    );
    assert.deepEqual(
      missing.rootRect,
      { width: 0, height: 0, top: 0, left: 0 },
      'no element to measure a rect from',
    );
    assert.false(missing.rootHasOffsetParent);
    assert.strictEqual(
      typeof missing.documentVisibilityState,
      'string',
      'reports the real document.visibilityState regardless of root presence',
    );
    assert.true(
      missing.bodyChildElementCount >= 0,
      'reports the real document.body composition regardless of root presence — the paint-diagnosis fields this exists for',
    );
    assert.true(Array.isArray(missing.bodyChildren));

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

    let zeroSize = document.createElement('main');
    zeroSize.textContent = 'Track: corridor-take-one';
    zeroSize.style.width = '0';
    zeroSize.style.height = '0';
    zeroSize.style.overflow = 'hidden';
    document.body.append(zeroSize);
    try {
      let diagnostic = measureRenderedOutput(zeroSize, 'isolated');
      assert.true(
        diagnostic.textLength > 0,
        'has real text content, unlike the empty-root case above',
      );
      assert.false(
        diagnostic.hasVisibleContent,
        'text content alone is not sufficient — a zero-size root (present but unpainted, the exact defect a prior OR-based version of this check missed) must not read as visible',
      );
    } finally {
      zeroSize.remove();
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
        'a render root with real, sized content measures as visible',
      );
      assert.true(
        diagnostic.rootHasOffsetParent,
        'an attached, painted element has an offsetParent',
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

    postRenderDiagnostic(
      channel.port1,
      measureRenderedOutput(null, 'isolated'),
    );

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
    assert.strictEqual(message?.elementCount, 0);
    assert.strictEqual(message?.textLength, 0);
    assert.false(message?.hasVisibleContent);

    channel.port1.close();
    channel.port2.close();
  });

  // False positive below (qunit/resolve-async): the two MessageChannel
  // port.start() calls in this test are plain Web API calls (needed for
  // addEventListener-based ports to dispatch queued messages), not
  // assert.async()/done() callbacks. Every actual async operation in this
  // test is a properly-awaited waitUntil().
  // eslint-disable-next-line qunit/resolve-async
  test('RP-15.3, RP-16.1: reportIntrinsicHeight measures the render root and reports its real height as the surface minimumHeight, deduped and stoppable', async function (assert) {
    // The parent cannot ResizeObserve content inside a cross-origin iframe
    // (unlike SurfaceElementModifier's SurfaceService.attach path for
    // Direct/Capsule) — this is the child's own replacement, driving the
    // existing `layout` capability with a measured `minimumHeight` instead
    // of only the one-time `heightMode` the parent already sets before
    // render. A real SandboxSurfaceClient/port pair drives this exactly as
    // the mounted `attachSurface` modifier does in production.
    let channel = new MessageChannel();
    let layoutRequests: { heightMode: string; minimumHeight?: number }[] = [];
    channel.port1.addEventListener('message', (event) => {
      let request = event.data as {
        kind?: string;
        requestId?: string;
        operation?: string;
        layout?: { heightMode: string; minimumHeight?: number };
      };
      if (request?.kind !== 'boxel-surface-request') {
        return;
      }
      if (request.operation === 'layout' && request.layout) {
        layoutRequests.push(request.layout);
      }
      channel.port1.postMessage({
        kind: 'boxel-surface-response',
        protocolVersion: BOXEL_SURFACE_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
      });
    });
    channel.port1.start();
    channel.port2.start();

    let surface = new SandboxSurfaceClient(
      channel.port2,
      'surface:test' as SurfaceHandle,
    );
    let element = document.createElement('main');
    element.style.width = '200px';
    document.body.append(element);

    try {
      let stopReporting = reportIntrinsicHeight(element, surface);
      await waitUntil(() => layoutRequests.length > 0, { timeout: 2000 });
      assert.deepEqual(
        layoutRequests[0],
        { heightMode: 'intrinsic', minimumHeight: 0 },
        'reports a baseline immediately, before any content has rendered into an empty root',
      );

      element.textContent = 'Track: corridor-take-one';
      element.style.height = '500px';
      await waitUntil(() => layoutRequests.length > 1, { timeout: 2000 });
      let last = layoutRequests[layoutRequests.length - 1];
      assert.strictEqual(last?.heightMode, 'intrinsic');
      assert.strictEqual(
        last?.minimumHeight,
        500,
        "reports the element's real, resized height once the card's content lands",
      );

      let countAfterResize = layoutRequests.length;
      stopReporting();
      element.style.height = '100px';
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.strictEqual(
        layoutRequests.length,
        countAfterResize,
        'stop() disconnects the observer — no further reports after teardown',
      );
    } finally {
      element.remove();
      surface.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: the Sandbox process is born inside its presentation slot element and never re-parented — a repeat mount() is a no-op, and unmount() removes the iframe without moving it elsewhere', function (assert) {
    // RP-15.3: "a live iframe is never re-parented." A cross-origin
    // iframe's document reloads on ANY move — including one meant to
    // preserve it (a parking lot) — so the only correct place to insert it
    // is its permanent presentation slot, exactly once.
    let released: unknown[] = [];
    let surfaceService = {
      register: () => 'surface:test',
      release: (handle: unknown) => released.push(handle),
      layout: () => undefined,
    } as unknown as SurfaceServiceType;
    let process = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: { mode: 'sandbox', principal: 'user:test', surfaceId: 'x' },
      connectTimeout: 60_000,
    });

    assert.false(
      process.iframe.isConnected,
      'the iframe does not exist in the document until mount()',
    );

    let slotElement = document.createElement('div');
    document.body.append(slotElement);
    try {
      process.mount(slotElement);
      let iframe = process.iframe;
      assert.strictEqual(
        iframe.parentElement,
        slotElement,
        'born directly inside its permanent slot element',
      );
      let srcAfterFirstMount = iframe.getAttribute('src');

      process.mount(slotElement);
      assert.strictEqual(
        slotElement.children.length,
        1,
        'a repeat mount() call does not re-append (re-parent) the iframe',
      );
      assert.strictEqual(
        iframe.getAttribute('src'),
        srcAfterFirstMount,
        'a repeat mount() does not reload the iframe',
      );

      process.unmount();
      assert.false(
        iframe.isConnected,
        'unmount() removes the iframe from the document',
      );
      assert.strictEqual(
        iframe.parentElement,
        null,
        'unmount() moves the iframe nowhere — it is simply gone, not relocated',
      );
    } finally {
      process.destroy();
      slotElement.remove();
    }
  });

  test('RP-15.3: a failed connect (the timeout, since the child origin cannot boot here) reaches the Host as onMountFailed rather than an unhandled rejection', async function (assert) {
    // getRenderSlot() no longer awaits the connect+render handshake before
    // resolving (it mounts eagerly so the iframe can be born in its slot),
    // so a background connect failure has to reach the Host some other
    // way — this is that path.
    let surfaceService = {
      register: () => 'surface:test',
      release: () => undefined,
      layout: () => undefined,
    } as unknown as SurfaceServiceType;
    let process = new SandboxRuntimeProcess({
      childURL: 'https://sandbox.example.test/_boxel-sandbox-runtime',
      childOrigin: 'https://sandbox.example.test',
      surfaceService,
      fetch: globalThis.fetch,
      resolveModuleURL: (identifier) => identifier,
      isTrustedModuleURL: () => false,
      identity: { mode: 'sandbox', principal: 'user:test', surfaceId: 'x' },
      // Short on purpose: nothing in this test harness serves the child
      // origin, so this always times out — quickly, instead of the 15s
      // production default.
      connectTimeout: 50,
    });

    let slotElement = document.createElement('div');
    document.body.append(slotElement);
    let failures: Error[] = [];
    process.onMountFailed((error) => failures.push(error));

    try {
      process.mount(slotElement);
      await waitUntil(() => failures.length > 0, { timeout: 2000 });
      assert.strictEqual(failures.length, 1);
      assert.true(
        /timed out/i.test(failures[0]?.message ?? ''),
        'reports the connect timeout',
      );

      // A late subscriber (matches how the Host renderer subscribes only
      // after getRenderSlot() resolves, which can race a fast failure)
      // still gets the already-known failure, immediately.
      let lateFailures: Error[] = [];
      process.onMountFailed((error) => lateFailures.push(error));
      assert.strictEqual(lateFailures.length, 1);
    } finally {
      process.destroy();
      slotElement.remove();
    }
  });
});
