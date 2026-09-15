import { module, test } from 'qunit';

import { Deferred, Loader, VirtualNetwork } from '@cardstack/runtime-common';

async function hash(source: string): Promise<string> {
  let bytes = new TextEncoder().encode(source);
  let digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

module('Unit | Lattice module source inventory', function () {
  test('captures foreign imports without retaining source and distinguishes shims', async function (assert) {
    let sources: Record<string, string> = {
      'http://lattice-code/root':
        "import { factor } from 'http://lattice-helper/factor'; export const value = factor * 7;",
      'http://lattice-helper/factor': 'export const factor = 2;',
    };
    let fetches = 0;
    let fetchImpl: typeof fetch = async (input) => {
      fetches++;
      let url = new Request(input).url;
      return new Response(sources[url], {
        headers: { 'X-Boxel-Canonical-Path': `${url}.js` },
      });
    };
    let uncaptured = new Loader(fetchImpl);
    await uncaptured.import('http://lattice-code/root');
    assert.strictEqual(uncaptured.moduleSourceInventory, undefined);
    let loader = new Loader(fetchImpl, undefined, {
      captureModuleSources: true,
    });
    loader.shimModule('http://lattice-host/shim', { host: true });
    let result = await loader.import<{ value: number }>(
      'http://lattice-code/root',
    );
    assert.strictEqual(result.value, 14);
    let inventory = loader.moduleSourceInventory!;
    for (let [key, source] of Object.entries(sources)) {
      assert.deepEqual(
        inventory.find((item) => item.key === key),
        {
          key,
          url: `${key}.js`,
          kind: 'source',
          state: 'evaluated',
          sourceHash: await hash(source),
        },
      );
    }
    assert.deepEqual(
      inventory.find((item) => item.kind === 'shim'),
      {
        key: 'http://lattice-host/shim',
        url: 'http://lattice-host/shim',
        kind: 'shim',
        state: 'evaluated',
      },
    );
    let reads = fetches;
    inventory[0].url = 'changed-by-consumer';
    assert.notStrictEqual(
      loader.moduleSourceInventory![0].url,
      inventory[0].url,
    );
    assert.strictEqual(fetches, reads, 'reading inventory performs no fetch');
    let cloned = Loader.cloneLoader(loader);
    assert.deepEqual(
      cloned.moduleSourceInventory?.map((item) => item.kind),
      ['shim'],
      'a fresh loader carries host shims but no old source receipts',
    );
    await cloned.import('http://lattice-code/root');
    assert.strictEqual(cloned.moduleSourceInventory?.length, 3);
    loader.shimModule('http://lattice-helper/factor', { factor: 3 });
    assert.strictEqual(
      loader.moduleSourceInventory?.find(
        (item) => item.key === 'http://lattice-helper/factor',
      )?.kind,
      'shim',
      'a replacement shim cannot retain a source receipt',
    );
  });

  test('mapping invalidation cannot install an old response inventory over a replacement', async function (assert) {
    let started = new Deferred<void>();
    let release = new Deferred<void>();
    let count = 0;
    let oldSource = 'export const value = 2;';
    let newSource = 'export const value = 3;';
    let network = new VirtualNetwork(async () => {
      if (++count === 1) {
        started.fulfill();
        await release.promise;
        return new Response(oldSource);
      }
      return new Response(newSource);
    });
    let loader = new Loader(network.fetch, network.resolveImport, {
      virtualNetwork: network,
      captureModuleSources: true,
    });
    try {
      let first = loader.import<{ value: number }>('http://lattice-code/race');
      await started.promise;
      assert.strictEqual(loader.moduleSourceInventory?.[0].kind, 'unavailable');
      assert.strictEqual(loader.moduleSourceInventory?.[0].state, 'fetching');
      network.addURLMapping(
        new URL('http://lattice-alias/'),
        new URL('http://lattice-target/'),
      );
      assert.deepEqual(loader.moduleSourceInventory, []);
      let replacement = await loader.import<{ value: number }>(
        'http://lattice-code/race',
      );
      assert.strictEqual(replacement.value, 3);
      release.fulfill();
      assert.strictEqual((await first).value, 3);
      assert.deepEqual(loader.moduleSourceInventory, [
        {
          key: 'http://lattice-code/race',
          url: 'http://lattice-code/race',
          state: 'evaluated',
          kind: 'source',
          sourceHash: await hash(newSource),
        },
      ]);
    } finally {
      release.fulfill();
      loader.dispose();
    }
  });

  test('stopping capture keeps resident code and does not capture a late import', async function (assert) {
    let started = new Deferred<void>();
    let release = new Deferred<void>();
    let fetches = 0;
    let loader = new Loader(
      async (input) => {
        fetches++;
        if (new Request(input).url.endsWith('/pending')) {
          started.fulfill();
          await release.promise;
        }
        return new Response('export const value = 7;');
      },
      undefined,
      { captureModuleSources: true },
    );
    try {
      let resident = await loader.import('http://lattice-code/resident');
      assert.strictEqual(loader.moduleSourceInventory?.[0].kind, 'source');
      let pending = loader.import<{ value: number }>(
        'http://lattice-code/pending',
      );
      await started.promise;
      loader.stopModuleSourceCapture();
      assert.strictEqual(loader.moduleSourceInventory, undefined);
      assert.strictEqual(
        await loader.import('http://lattice-code/resident'),
        resident,
        'ending diagnostics preserves the evaluated module instance',
      );
      assert.strictEqual(
        fetches,
        2,
        'the resident module was not fetched again',
      );
      release.fulfill();
      assert.strictEqual((await pending).value, 7);
      assert.strictEqual(
        loader.moduleSourceInventory,
        undefined,
        'a response started during capture cannot publish an inventory afterwards',
      );
      await loader.import('http://lattice-code/ordinary');
      assert.strictEqual(loader.moduleSourceInventory, undefined);
      loader.stopModuleSourceCapture();
      assert.strictEqual(
        await loader.import('http://lattice-code/resident'),
        resident,
        'stopping again is harmless',
      );
      let clone = Loader.cloneLoader(loader);
      try {
        assert.false(clone.isModuleLoaded('http://lattice-code/resident'));
        await clone.import('http://lattice-code/resident');
        assert.strictEqual(
          clone.moduleSourceInventory,
          undefined,
          'a fresh session loader inherits disabled capture, not old receipts',
        );
      } finally {
        clone.dispose();
      }
    } finally {
      release.fulfill();
      loader.dispose();
    }
  });

  test('failed evaluation reports broken source, never successful admission', async function (assert) {
    let loader = new Loader(
      async () => new Response("throw new Error('broken-formula');"),
      undefined,
      { captureModuleSources: true },
    );
    await assert.rejects(
      loader.import('http://lattice-code/broken'),
      /broken-formula/,
    );
    assert.strictEqual(loader.moduleSourceInventory?.[0].state, 'broken');
    assert.strictEqual(loader.moduleSourceInventory?.[0].kind, 'source');
  });

  test('encoded CSS identifiers stay bounded in pending and loaded inventories', async function (assert) {
    let key = `http://lattice-code/style.${'eA'.repeat(40000)}.glimmer-scoped.css`;
    let ready = new Deferred<void>();
    let release = new Deferred<void>();
    let source = 'export const value = 7;';
    let loader = new Loader(
      async () => {
        ready.fulfill();
        await release.promise;
        return new Response(source);
      },
      undefined,
      { captureModuleSources: true },
    );
    let loading = loader.import<{ value: number }>(key);
    try {
      await ready.promise;
      assert.true(JSON.stringify(loader.moduleSourceInventory).length < 1024);
      assert.strictEqual(
        loader.moduleSourceInventory?.[0].identityKind,
        'unavailable',
      );
    } finally {
      release.fulfill();
    }
    assert.strictEqual((await loading).value, 7);
    assert.deepEqual(loader.moduleSourceInventory, [
      {
        key: `sha256:${await hash(key)}`,
        url: `sha256:${await hash(key)}`,
        identityKind: 'sha256',
        kind: 'source',
        state: 'evaluated',
        sourceHash: await hash(source),
      },
    ]);
    assert.true(JSON.stringify(loader.moduleSourceInventory).length < 1024);
  });
});
