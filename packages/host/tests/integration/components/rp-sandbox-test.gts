import 'ses';

import { waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { LooseCardResource } from '@cardstack/runtime-common';

import CardRenderer from '@cardstack/host/components/card-renderer';

import { classifyBoxelSource } from '@cardstack/host/lib/boxel-source-classifier';
import {
  SandboxFetchClient,
  SandboxFetchServer,
} from '@cardstack/host/lib/sandbox-fetch-transport';
import SandboxModuleAuthority from '@cardstack/host/lib/sandbox-module-authority';
import { installSandboxRuntimeErrorReporter } from '@cardstack/host/lib/sandbox-runtime-host';

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

  test('RP-15.3: the child reports its first post-ready uncaught error or unhandled rejection to the parent as a single runtime-error control message', async function (assert) {
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

    let stop = installSandboxRuntimeErrorReporter(channel.port1);
    try {
      // A modifier's async WebGL/Three.js setup or a rejected texture load
      // runs well after any render() has already acked; only a global
      // handler can observe it. Fire two, to prove the terminal-signal
      // dedupe: a runtime-error is a signal the process is done for, not a
      // stream the parent has to keep listening to.
      window.dispatchEvent(
        new ErrorEvent('error', { error: new Error('boom'), message: 'boom' }),
      );
      window.dispatchEvent(
        new ErrorEvent('error', {
          error: new Error('second'),
          message: 'second',
        }),
      );

      await waitUntil(() => received.length > 0, { timeout: 2000 });
      // Give a second failure a macrotask to (incorrectly) arrive too.
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.strictEqual(
        received.length,
        1,
        'only the first post-ready failure is reported',
      );
      let [message] = received;
      assert.strictEqual(message?.kind, 'boxel-sandbox-control');
      assert.strictEqual(message?.type, 'runtime-error');
      assert.strictEqual(message?.error.name, 'Error');
      assert.strictEqual(message?.error.message, 'boom');
    } finally {
      stop();
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
});
