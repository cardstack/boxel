import { module, test } from 'qunit';

import {
  DynamicRRIResolution,
  Loader,
  VirtualNetwork,
} from '@cardstack/runtime-common';

import { prepareDynamicRRIResponses } from '@cardstack/host/services/network';

const CURRENT_URL = 'https://realms.example/acme/current/';
const LEGACY_URL = 'https://realms.example/acme/legacy/';
const PALETTE_URL = 'https://realms.example/catalog/palette/';
const PALETTE_V1_URL = 'https://realms.example/catalog/palette@1.0.0/';
const PALETTE_V2_URL = 'https://realms.example/catalog/palette@2.0.0/';
const CAPABILITIES = '.deck/capabilities';

type Fixture = Record<
  string,
  { body: string; realmURL?: string; contentType?: string }
>;

function json(value: unknown): string {
  return JSON.stringify(value);
}

function makeRuntime() {
  let fixture: Fixture = {
    [`${CURRENT_URL}scene.js`]: {
      body: `
        import { paletteName } from 'palette';
        export function render() { return paletteName('current'); }
      `,
      realmURL: CURRENT_URL,
    },
    [`${CURRENT_URL}package.json`]: {
      body: json({ name: '@acme/current', version: '1.0.0' }),
    },
    [`${CURRENT_URL}${CAPABILITIES}`]: {
      body: json({ deckCollaboration: true, realmRRI: '@acme/current/' }),
      contentType: 'application/json',
    },
    [`${CURRENT_URL}importmap.json`]: {
      body: json({
        imports: {
          palette: '@catalog/palette@2.0.0/index.js',
          'palette/': '@catalog/palette@2.0.0/',
        },
      }),
    },
    [`${LEGACY_URL}scene.js`]: {
      body: `
        import { paletteName } from 'palette';
        export function render() { return paletteName('legacy'); }
      `,
      realmURL: LEGACY_URL,
    },
    [`${LEGACY_URL}package.json`]: {
      body: json({ name: '@acme/legacy', version: '1.0.0' }),
    },
    [`${LEGACY_URL}${CAPABILITIES}`]: {
      body: json({ deckCollaboration: true, realmRRI: '@acme/legacy/' }),
      contentType: 'application/json',
    },
    [`${LEGACY_URL}importmap.json`]: {
      body: json({
        imports: {
          palette: '@catalog/palette@1.0.0/index.js',
          'palette/': '@catalog/palette@1.0.0/',
        },
      }),
    },
    [`${PALETTE_V1_URL}index.js`]: {
      body: `export function paletteName(name) { return name + ' / v1'; }`,
      realmURL: PALETTE_URL,
    },
    [`${PALETTE_V1_URL}package.json`]: {
      body: json({ name: '@catalog/palette', version: '1.0.0' }),
    },
    [`${PALETTE_URL}${CAPABILITIES}`]: {
      body: json({ deckCollaboration: true, realmRRI: '@catalog/palette/' }),
      contentType: 'application/json',
    },
    [`${PALETTE_V1_URL}importmap.json`]: { body: json({ imports: {} }) },
    [`${PALETTE_V2_URL}index.js`]: {
      body: `export function paletteName(name) { return name + ' / v2'; }`,
      realmURL: PALETTE_URL,
    },
    [`${PALETTE_V2_URL}package.json`]: {
      body: json({ name: '@catalog/palette', version: '2.0.0' }),
    },
    [`${PALETTE_V2_URL}importmap.json`]: { body: json({ imports: {} }) },
  };
  let fetch: typeof globalThis.fetch = async (input) => {
    let url = input instanceof Request ? input.url : input.toString();
    let entry = fixture[url];
    if (!entry) {
      return new Response(`missing fixture: ${url}`, { status: 404 });
    }
    return new Response(entry.body, {
      headers: {
        'content-type': entry.contentType ?? 'text/javascript',
        ...(entry.realmURL ? { 'X-Boxel-Realm-Url': entry.realmURL } : {}),
        ...(url.endsWith(CAPABILITIES)
          ? { 'X-Boxel-Deck-Collaboration': 'true' }
          : {}),
      },
    });
  };
  let virtualNetwork = new VirtualNetwork(fetch);
  let resolution = new DynamicRRIResolution(virtualNetwork, fetch, {
    enabled: true,
  });
  let loader = new Loader(fetch, virtualNetwork.resolveImport, {
    prepareModuleResolution: (url, response) =>
      resolution.prepare(url, response),
    virtualNetwork,
  });
  return { fixture, loader, resolution, virtualNetwork };
}

module('Unit | Loader | dynamic RRI resolution', function () {
  test('bootstraps a known Realm before a persisted RRI is resolved', async function (assert) {
    let { resolution, virtualNetwork } = makeRuntime();

    await resolution.prepareRealm(new URL(CURRENT_URL));

    assert.strictEqual(
      virtualNetwork.toURLHref('@acme/current/incident'),
      `${CURRENT_URL}incident`,
    );
  });

  test('authenticated Realm responses prepare RRI mappings before callers consume them', async function (assert) {
    let { resolution, virtualNetwork } = makeRuntime();
    let response = new Response(json({ data: [] }), {
      headers: { 'X-Boxel-Realm-Url': CURRENT_URL },
    });
    Object.defineProperty(response, 'url', {
      value: `${CURRENT_URL}_search`,
    });
    let fetch: typeof globalThis.fetch = async () => response;

    let preparedFetch = prepareDynamicRRIResponses(fetch, resolution);
    let result = await preparedFetch(`${CURRENT_URL}_search`);

    assert.strictEqual(result, response, 'the original response is preserved');
    assert.strictEqual(
      virtualNetwork.toURLHref('@acme/current/incident'),
      `${CURRENT_URL}incident`,
      'a search response prepares its Realm before embedded RRI ids are read',
    );
  });

  test('is inert unless the Host pilot flag is enabled', async function (assert) {
    let virtualNetwork = new VirtualNetwork();
    let resolution = new DynamicRRIResolution(virtualNetwork, globalThis.fetch);

    await resolution.prepare(
      new URL(`${CURRENT_URL}incident`),
      new Response('{}', {
        headers: { 'X-Boxel-Realm-Url': CURRENT_URL },
      }),
    );

    assert.throws(() => virtualNetwork.toURLHref('@acme/current/incident'));
  });

  test('trusts only a matching server-authoritative capability', async function (assert) {
    let { fixture, resolution, virtualNetwork } = makeRuntime();
    fixture[`${CURRENT_URL}${CAPABILITIES}`].body = json({
      deckCollaboration: true,
      realmRRI: '@other/package/',
    });

    await resolution.prepare(
      new URL(`${CURRENT_URL}incident`),
      new Response('{}', {
        headers: { 'X-Boxel-Realm-Url': CURRENT_URL },
      }),
    );

    assert.throws(() => virtualNetwork.toURLHref('@acme/current/incident'));
  });

  test('prepares a package mapping before an RRI card document is deserialized', async function (assert) {
    let { resolution, virtualNetwork } = makeRuntime();

    await resolution.prepare(
      new URL(`${CURRENT_URL}incident`),
      new Response(
        json({
          data: {
            id: '@acme/current/incident',
            meta: {
              adoptsFrom: {
                module: '@acme/current/scene',
                name: 'Scene',
              },
            },
          },
        }),
        { headers: { 'X-Boxel-Realm-Url': CURRENT_URL } },
      ),
    );

    assert.strictEqual(
      virtualNetwork.toURLHref('@acme/current/incident'),
      `${CURRENT_URL}incident`,
    );
    assert.strictEqual(
      virtualNetwork.toURLHref('@acme/current/scene'),
      `${CURRENT_URL}scene`,
    );
  });

  test('applies adoptsFrom specificity: portable dependency refs use the lock while explicit identities bypass it', async function (assert) {
    let { resolution, virtualNetwork } = makeRuntime();

    await resolution.prepare(
      new URL(`${CURRENT_URL}incident`),
      new Response(
        json({
          data: {
            id: '@acme/current/incident',
            meta: {
              adoptsFrom: {
                module: 'palette/card',
                name: 'PaletteCard',
              },
            },
          },
        }),
        { headers: { 'X-Boxel-Realm-Url': CURRENT_URL } },
      ),
    );

    assert.strictEqual(
      virtualNetwork.resolveImport('palette/card', '@acme/current/incident'),
      `${PALETTE_V2_URL}card`,
      'a portable dependency specifier follows the importing package lock',
    );
    assert.strictEqual(
      virtualNetwork.resolveImport(
        '@catalog/palette/card',
        '@acme/current/incident',
      ),
      `${PALETTE_URL}card`,
      'an explicit mutable RRI deliberately selects live package identity',
    );
    assert.strictEqual(
      virtualNetwork.resolveImport(
        '@catalog/palette@1.0.0/card',
        '@acme/current/incident',
      ),
      `${PALETTE_V1_URL}card`,
      'an explicit exact RRI deliberately pins that immutable Version',
    );
    assert.strictEqual(
      virtualNetwork.resolveImport(
        `${PALETTE_V1_URL}card`,
        '@acme/current/incident',
      ),
      `${PALETTE_V1_URL}card`,
      'a hardcoded absolute URL is already resolved and bypasses RRI locking',
    );
  });

  test('discovers bare imports from package documents at runtime', async function (assert) {
    let { loader, virtualNetwork } = makeRuntime();

    let current = await loader.import<{ render(): string }>(
      `${CURRENT_URL}scene.js`,
    );

    assert.strictEqual(current.render(), 'current / v2');
    assert.strictEqual(
      virtualNetwork.resolveImport('palette', '@acme/current/scene.js'),
      `${PALETTE_V2_URL}index.js`,
    );
    loader.dispose();
  });

  test('keeps different exact Versions for independently locked packages', async function (assert) {
    let { loader } = makeRuntime();

    let [current, legacy] = await Promise.all([
      loader.import<{ render(): string }>(`${CURRENT_URL}scene.js`),
      loader.import<{ render(): string }>(`${LEGACY_URL}scene.js`),
    ]);

    assert.strictEqual(current.render(), 'current / v2');
    assert.strictEqual(legacy.render(), 'legacy / v1');
    assert.true(loader.isModuleLoaded(`${PALETTE_V1_URL}index.js`));
    assert.true(loader.isModuleLoaded(`${PALETTE_V2_URL}index.js`));
    loader.dispose();
  });

  test('re-reads a changed lock after runtime invalidation', async function (assert) {
    let { fixture, loader, resolution } = makeRuntime();
    let before = await loader.import<{ render(): string }>(
      `${CURRENT_URL}scene.js`,
    );
    assert.strictEqual(before.render(), 'current / v2');

    fixture[`${CURRENT_URL}importmap.json`].body = json({
      imports: { palette: '@catalog/palette@1.0.0/index.js' },
    });
    resolution.invalidate();
    let replacement = Loader.cloneLoader(loader);
    loader.dispose();
    let after = await replacement.import<{ render(): string }>(
      `${CURRENT_URL}scene.js`,
    );

    assert.strictEqual(after.render(), 'current / v1');
    replacement.dispose();
  });
});
