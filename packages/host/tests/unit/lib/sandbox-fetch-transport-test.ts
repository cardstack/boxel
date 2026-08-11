import { module, test } from 'qunit';

import {
  SandboxFetchClient,
  SandboxFetchServer,
} from '@cardstack/host/lib/sandbox-fetch-transport';
import SandboxModuleAuthority from '@cardstack/host/lib/sandbox-module-authority';
import {
  isImplicitSandboxModule,
  isTrustedImport,
} from '@cardstack/host/lib/trusted-modules';

module('Unit | Sandbox module fetch transport', function () {
  test('authored resource reads use exact non-executable authority', async function (assert) {
    let channel = new MessageChannel();
    let requested: Request[] = [];
    let observedModules: string[] = [];
    let allowedResource = 'https://realm.example/files/annual-report.pdf';
    let server = new SandboxFetchServer(
      channel.port1,
      async (input, init) => {
        requested.push(new Request(input, init));
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          headers: {
            'content-type': 'application/pdf',
            'x-realm-internal': 'must-not-cross',
          },
        });
      },
      () => false,
      async (url) => {
        observedModules.push(url);
      },
      undefined,
      undefined,
      (url) => url === allowedResource,
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      let response = await client.fetchResource(allowedResource, {
        credentials: 'include',
        headers: {
          Accept: 'application/pdf',
          Authorization: 'must-not-cross',
        },
      });

      assert.deepEqual(
        [...new Uint8Array(await response.arrayBuffer())],
        [0x25, 0x50, 0x44, 0x46],
        'the linked binary response crosses as data',
      );
      assert.strictEqual(requested.length, 1);
      assert.strictEqual(
        requested[0]?.headers.get('accept'),
        'application/pdf',
      );
      assert.false(
        requested[0]?.headers.has('authorization'),
        'child-provided authority is stripped',
      );
      assert.strictEqual(
        response.headers.get('x-realm-internal'),
        null,
        'private response headers do not cross',
      );
      assert.deepEqual(
        observedModules,
        [],
        'a resource response never grows executable module authority',
      );

      await assert.rejects(
        client.fetchResource('https://realm.example/files/payroll.pdf'),
        /outside its projected links/,
        'a sibling URL that was not linked is denied',
      );
      assert.strictEqual(requested.length, 1, 'the denied URL never fetches');
      await assert.rejects(
        client.fetchResource(allowedResource, { method: 'POST' }),
        /support only GET/,
        'the data capability cannot mutate a resource',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('the child can read only an admitted module through the Host broker', async function (assert) {
    let channel = new MessageChannel();
    let requests: Request[] = [];
    let allowed = new Set(['https://realm.example/card.gts']);
    let server = new SandboxFetchServer(
      channel.port1,
      async (input, init) => {
        let request = new Request(input, init);
        requests.push(request);
        return new Response('export const answer = 42;', {
          status: 200,
          headers: {
            'content-type': 'text/javascript',
            'x-realm-internal': 'must-not-cross',
          },
        });
      },
      (url) => allowed.has(url),
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      let response = await client.fetch('https://realm.example/card.gts', {
        headers: {
          Accept: 'application/javascript',
          Authorization: 'must-not-cross',
          'X-Boxel-Private': 'must-not-cross',
        },
      });

      assert.strictEqual(await response.text(), 'export const answer = 42;');
      assert.strictEqual(response.headers.get('x-realm-internal'), null);
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(
        requests[0]?.headers.get('accept'),
        'application/javascript',
        'ordinary module negotiation crosses the boundary',
      );
      assert.false(
        requests[0]?.headers.has('authorization'),
        'child-provided authority does not cross the boundary',
      );
      assert.false(
        requests[0]?.headers.has('x-boxel-private'),
        'unrecognized headers do not cross the boundary',
      );

      await assert.rejects(
        client.fetch('https://realm.example/private.json'),
        /outside its classified graph/,
        'an unclassified URL cannot use the Host authenticated fetch',
      );
      assert.strictEqual(
        requests.length,
        1,
        'the denied request never fetches',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('an admitted module recursively admits only its literal ESM graph', async function (assert) {
    let channel = new MessageChannel();
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    authority.allow(['https://cdn.example/package@1.0.0']);
    let sources: Record<string, string> = {
      'https://cdn.example/package@1.0.0':
        "export * from '/package@1.0.0/es2022/package.mjs';",
      'https://cdn.example/package@1.0.0/es2022/package.mjs':
        'export const answer = 42;',
    };
    let server = new SandboxFetchServer(
      channel.port1,
      async (input) => {
        let url = String(input);
        let source = sources[url];
        return source === undefined
          ? new Response('not found', { status: 404 })
          : new Response(source, {
              status: 200,
              headers: { 'content-type': 'text/javascript' },
            });
      },
      (url) => authority.has(url),
      (url, contentType, body) => authority.observe(url, contentType, body),
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      await client.fetch('https://cdn.example/package@1.0.0');
      let dependency = await client.fetch(
        'https://cdn.example/package@1.0.0/es2022/package.mjs',
      );
      assert.strictEqual(await dependency.text(), 'export const answer = 42;');
      await assert.rejects(
        client.fetch('https://cdn.example/unrelated@1.0.0'),
        /outside its classified graph/,
        'same-origin package access is not granted implicitly',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('a trusted Base alias is authorized and fetched through the configured Base URL', async function (assert) {
    let channel = new MessageChannel();
    let localBaseURL = 'https://localhost:4201/base/card-api';
    let configuredBaseURL = 'https://realms-staging.stack.cards/base/card-api';
    let resolveModuleURL = (identifier: string) =>
      identifier === localBaseURL ? configuredBaseURL : identifier;
    let authority = new SandboxModuleAuthority(resolveModuleURL, (identifier) =>
      identifier.startsWith('https://realms-staging.stack.cards/base/'),
    );
    let requested: string[] = [];
    let server = new SandboxFetchServer(
      channel.port1,
      async (input) => {
        requested.push(String(input));
        return new Response('export const trusted = true;', {
          headers: { 'content-type': 'text/javascript' },
        });
      },
      (url) => authority.has(url),
      (url, contentType, body) => authority.observe(url, contentType, body),
      undefined,
      resolveModuleURL,
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      let response = await client.fetch(localBaseURL);
      assert.strictEqual(
        await response.text(),
        'export const trusted = true;',
        'the known Base alias remains readable as trusted framework code',
      );
      assert.deepEqual(
        requested,
        [configuredBaseURL],
        "the Host reads its configured Base URL, never the viewer's localhost alias",
      );

      await assert.rejects(
        client.fetch('https://localhost:4201/private/card-api'),
        /outside its classified graph/,
        'the resolution rule does not broaden trust to another localhost path',
      );
      assert.strictEqual(requested.length, 1, 'the denied URL never fetches');
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test("Chris's BXL prototype is an exact lazy-import exception without boxel.site origin trust", async function (assert) {
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      (identifier) =>
        isTrustedImport(identifier) || isImplicitSandboxModule(identifier),
    );

    assert.false(
      isTrustedImport('https://bxl.boxel.site/bxl.ts'),
      'the prototype is not promoted into the Host-trusted Direct/Capsule module set',
    );
    assert.true(
      authority.has('https://bxl.boxel.site/bxl.ts'),
      'the one BXL prototype URL is available inside the Sandbox even when a static graph cannot discover the lazy import',
    );
    assert.false(
      authority.has('https://bxl.boxel.site/private.ts'),
      'boxel.site is a user-publishing domain, so the exception never grants origin-wide access',
    );

    await authority.observe(
      'https://bxl.boxel.site/bxl.ts',
      'text/javascript',
      new TextEncoder().encode("export * from './runtime/evaluate.js';")
        .buffer as ArrayBuffer,
    );
    assert.true(
      authority.has('https://bxl.boxel.site/runtime/evaluate.js'),
      "the admitted entry's own literal dependency graph remains loadable",
    );
    assert.false(
      authority.has('https://bxl.boxel.site/runtime/secrets.js'),
      'an undeclared sibling remains unavailable',
    );
  });

  test('a third-party CDN response admits its own declared imports without a hostname allowlist', async function (assert) {
    // jsdelivr's `/+esm` bundles are extensionless and are not esm.sh, the
    // only CDN `isJavaScript` used to special-case. This mirrors the existing
    // esm.sh growth case one CDN over: growth must generalize to "did the
    // response parse as an ES module", not a hardcoded list of CDN hosts.
    let channel = new MessageChannel();
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    authority.allow(['https://cdn.jsdelivr.net/npm/some-color-lib@1.0.0/+esm']);
    let sources: Record<string, string> = {
      'https://cdn.jsdelivr.net/npm/some-color-lib@1.0.0/+esm':
        "export * from '/npm/three@0.128.0/+esm';",
      'https://cdn.jsdelivr.net/npm/three@0.128.0/+esm':
        'const REVISION = "128"; export { REVISION };',
    };
    let server = new SandboxFetchServer(
      channel.port1,
      async (input) => {
        let url = String(input);
        let source = sources[url];
        return source === undefined
          ? new Response('not found', { status: 404 })
          : new Response(source, {
              status: 200,
              headers: {
                'content-type': 'application/javascript; charset=utf-8',
              },
            });
      },
      (url) => authority.has(url),
      (url, contentType, body) => authority.observe(url, contentType, body),
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      await client.fetch(
        'https://cdn.jsdelivr.net/npm/some-color-lib@1.0.0/+esm',
      );
      let dependency = await client.fetch(
        'https://cdn.jsdelivr.net/npm/three@0.128.0/+esm',
      );
      assert.true(
        (await dependency.text()).includes('128'),
        "the entry module's own declared sub-import is admitted on a non-esm.sh CDN",
      );
      await assert.rejects(
        client.fetch('https://cdn.jsdelivr.net/npm/unrelated-package@1.0.0'),
        /outside its classified graph/,
        'admission does not widen to sibling jsdelivr packages the module never declared',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('a bare specifier inside an observed third-party module is not silently admitted as a same-origin sibling URL', async function (assert) {
    // `new URL('three', 'https://cdn.example/npm/wrapper@1.0.0/+esm')` does
    // not throw — it resolves to a nonsense same-origin sibling path
    // (`https://cdn.example/npm/wrapper@1.0.0/three`), not a URL anything
    // will ever request. A bare package specifier is meant to stay inside
    // VirtualNetwork's package shim handler, a resolution path this observed
    // response never goes through, so it must not be admitted at all.
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    authority.allow(['https://cdn.example/npm/wrapper@1.0.0/+esm']);

    await authority.observe(
      'https://cdn.example/npm/wrapper@1.0.0/+esm',
      'application/javascript',
      new TextEncoder().encode(
        "import * as THREE from 'three'; export { THREE };",
      ).buffer as ArrayBuffer,
    );

    assert.false(
      authority.has('https://cdn.example/npm/wrapper@1.0.0/three'),
      'the bare specifier is not manufactured into an admitted sibling URL',
    );
    assert.false(
      authority.has('three'),
      'the bare specifier itself is not admitted either',
    );
  });

  test('RP-15.3: a draft override serves the unsaved edit instead of the realm, keyed by exact URL, and never reaches the network for that URL', async function (assert) {
    let channel = new MessageChannel();
    let networkRequests: string[] = [];
    let drafts = new Map<string, string>([
      ['https://realm.example/card.gts', 'export const answer = 43; // edited'],
    ]);
    let allowed = new Set([
      'https://realm.example/card.gts',
      'https://realm.example/sibling.gts',
    ]);
    let server = new SandboxFetchServer(
      channel.port1,
      async (input) => {
        networkRequests.push(String(input));
        return new Response('export const answer = 42; // saved', {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        });
      },
      (url) => allowed.has(url),
      undefined,
      (url) => drafts.get(url),
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      let draft = await client.fetch('https://realm.example/card.gts');
      assert.strictEqual(
        await draft.text(),
        'export const answer = 43; // edited',
        'a URL with a draft override serves the unsaved edit',
      );
      assert.deepEqual(
        networkRequests,
        [],
        'the drafted URL never reaches the network — the override is served without an authenticated fetch',
      );

      let sibling = await client.fetch('https://realm.example/sibling.gts');
      assert.strictEqual(
        await sibling.text(),
        'export const answer = 42; // saved',
        'a URL with no draft override still falls through to the network — the override is exact-URL only, never pattern-matched',
      );
      assert.deepEqual(networkRequests, ['https://realm.example/sibling.gts']);

      drafts.set(
        'https://realm.example/card.gts',
        'export const answer = 44; // edited again',
      );
      let second = await client.fetch('https://realm.example/card.gts');
      assert.strictEqual(
        await second.text(),
        'export const answer = 44; // edited again',
        'a later draft for the same URL replaces the previous one',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a draft override still fails closed for a URL outside the classified graph', async function (assert) {
    let channel = new MessageChannel();
    let drafts = new Map<string, string>([
      ['https://realm.example/outside.gts', 'export const x = 1;'],
    ]);
    let server = new SandboxFetchServer(
      channel.port1,
      async () => new Response('unreachable'),
      () => false,
      undefined,
      (url) => drafts.get(url),
    );
    let client = new SandboxFetchClient(channel.port2);
    channel.port1.start();
    channel.port2.start();

    try {
      await assert.rejects(
        client.fetch('https://realm.example/outside.gts'),
        /outside its classified graph/,
        'a draft entry does not bypass the authority check — it still has to be an admitted URL',
      );
    } finally {
      client.destroy();
      server.destroy();
      channel.port1.close();
      channel.port2.close();
    }
  });

  test('RP-15.3: a new import introduced only by an edited (not the original) source is admitted once its graph is re-allowed — Sandbox HMR authority growth', async function (assert) {
    // Edge case 8: "new imports added mid-session must be admitted through
    // the same observe()-grown mechanism as initial load." allow() is
    // additive (a Set), so re-calling it with the draft's own classified
    // module graph before admitting its source (SandboxRuntimeProcess.
    // pushDraft) is sufficient — this proves that growth actually reaches a
    // module the ORIGINAL (pre-edit) source never imported.
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    // The original source's own classified graph — no reference to the
    // helper module the edit is about to introduce.
    authority.allow(['https://realm.example/card.gts']);
    assert.false(
      authority.has('https://realm.example/color-helpers.gts'),
      'a module the original source never imported starts out ungranted',
    );

    // The edited source now imports a sibling helper — classification of
    // the DRAFT (not the original) discovers it, and the Host re-allows the
    // draft's own module graph before ever admitting its source (mirrors
    // SandboxRuntimeProcess.pushDraft's authority-growth step).
    authority.allow([
      'https://realm.example/card.gts',
      'https://realm.example/color-helpers.gts',
    ]);
    assert.true(
      authority.has('https://realm.example/color-helpers.gts'),
      'the import the edit alone introduced is admitted once its graph is re-allowed',
    );
    assert.true(
      authority.has('https://realm.example/card.gts'),
      'growth is additive — the original grant is never revoked by a later allow()',
    );
  });

  test('RP-15.3: reset() discards every admitted URL — only an explicit hard reload calls it, never an ordinary draft push', async function (assert) {
    let authority = new SandboxModuleAuthority(
      (identifier) => identifier,
      () => false,
    );
    authority.allow(['https://realm.example/card.gts']);
    assert.true(authority.has('https://realm.example/card.gts'));

    authority.reset();
    assert.false(
      authority.has('https://realm.example/card.gts'),
      'reset() clears even a grant made before it was called',
    );
  });

  test('teardown rejects pending reads and releases the port listener', async function (assert) {
    let channel = new MessageChannel();
    let client = new SandboxFetchClient(channel.port2);
    channel.port2.start();
    let pending = client.fetch('https://realm.example/card.gts');

    client.destroy();

    await assert.rejects(
      pending,
      /module fetch was destroyed/,
      'a destroyed runtime leaves no unresolved module read',
    );
    channel.port1.close();
    channel.port2.close();
  });
});
