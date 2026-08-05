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
