import { module, test } from 'qunit';

import {
  SandboxFetchClient,
  SandboxFetchServer,
} from '@cardstack/host/lib/sandbox-fetch-transport';
import SandboxModuleAuthority from '@cardstack/host/lib/sandbox-module-authority';

module('Unit | Sandbox module fetch transport', function () {
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
