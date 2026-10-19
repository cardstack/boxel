import { module, test } from 'qunit';

import {
  DeckPackageResolver,
  DynamicRRIResolution,
  Loader,
  VirtualNetwork,
  resolveImportThroughDeck,
} from '@cardstack/runtime-common';

const CURRENT_URL = 'https://realms.example/acme/current/';
const LEGACY_URL = 'https://realms.example/acme/legacy/';
const PALETTE_URL = 'https://realms.example/catalog/palette/';
const PALETTE_V1_URL = 'https://realms.example/catalog/palette@1.0.0/';
const PALETTE_V2_URL = 'https://realms.example/catalog/palette@2.0.0/';
const CAPABILITIES = '.deck/capabilities';

type Fixture = Record<
  string,
  {
    body: string;
    realmURL?: string;
    contentType?: string;
    headers?: Record<string, string>;
  }
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
        imports: { palette: '@catalog/palette@2.0.0/index.js' },
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
        imports: { palette: '@catalog/palette@1.0.0/index.js' },
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
        ...entry.headers,
        ...(url.endsWith(CAPABILITIES)
          ? { 'X-Boxel-Deck-Collaboration': 'true' }
          : {}),
      },
    });
  };
  let virtualNetwork = new VirtualNetwork(fetch);
  let resolver = new DeckPackageResolver();
  let resolution = new DynamicRRIResolution(resolver, virtualNetwork, fetch, {
    enabled: true,
  });
  let loader = new Loader(
    fetch,
    resolveImportThroughDeck(resolver, virtualNetwork),
    {
      prepareModuleResolution: (url, response) =>
        resolution.prepare(url, response),
      onResolutionChange: (listener) => resolver.onChange(listener),
      virtualNetwork,
    },
  );
  return { fixture, loader, resolution, resolver, virtualNetwork };
}

module('Unit | Loader | dynamic RRI resolution', function () {
  test('is inert unless the Host pilot flag is enabled', async function (assert) {
    let virtualNetwork = new VirtualNetwork();
    let resolution = new DynamicRRIResolution(
      new DeckPackageResolver(),
      virtualNetwork,
      globalThis.fetch,
    );

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

  test('discovers bare imports from package documents at runtime', async function (assert) {
    let { loader, resolver, virtualNetwork } = makeRuntime();

    let current = await loader.import<{ render(): string }>(
      `${CURRENT_URL}scene.js`,
    );

    assert.strictEqual(current.render(), 'current / v2');
    assert.strictEqual(
      resolver.resolve('palette', '@acme/current/scene.js'),
      '@catalog/palette@2.0.0/index.js',
      'the resolver answers with the exact Version RRI',
    );
    assert.strictEqual(
      resolveImportThroughDeck(resolver, virtualNetwork)(
        'palette',
        `${CURRENT_URL}scene.js`,
      ),
      `${PALETTE_V2_URL}index.js`,
      'the network turns that RRI into the Version route',
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

  test('resolves a package hosted inside another package realm', async function (assert) {
    let { fixture, loader } = makeRuntime();
    let kit = 'https://realms.example/acme/kit/';
    let button = `${kit}button/`;
    let buttonV2 = `${kit}button@2.0.0/`;
    Object.assign(fixture, {
      [`${kit}scene.js`]: {
        body: `
          import { size } from 'button';
          export function render() { return 'kit / ' + size; }
        `,
        realmURL: kit,
      },
      [`${kit}package.json`]: {
        body: json({ name: '@acme/kit', version: '1.0.0' }),
      },
      [`${kit}${CAPABILITIES}`]: {
        body: json({
          deckCollaboration: true,
          realmRRI: '@acme/kit/',
          packageRRI: '@acme/kit/',
          packages: { '@acme/kit/': kit, '@acme/button/': button },
        }),
        contentType: 'application/json',
      },
      [`${kit}importmap.json`]: {
        body: json({ imports: { button: '@acme/button@2.0.0/index.js' } }),
      },
      // The Version's URL segments say `kit/button`; its identity is the
      // package the realm hosts there, which the server names.
      [`${buttonV2}index.js`]: {
        body: `export const size = 'large';`,
        realmURL: button,
        headers: { 'X-Boxel-Version-RRI': '@acme/button@2.0.0/index.js' },
      },
      [`${buttonV2}package.json`]: {
        body: json({ name: '@acme/button', version: '2.0.0' }),
      },
      [`${buttonV2}importmap.json`]: { body: json({ imports: {} }) },
      [`${button}${CAPABILITIES}`]: {
        body: json({
          deckCollaboration: true,
          realmRRI: '@acme/kit/',
          packageRRI: '@acme/button/',
          packages: { '@acme/kit/': kit, '@acme/button/': button },
        }),
        contentType: 'application/json',
      },
    });

    let scene = await loader.import<{ render(): string }>(`${kit}scene.js`);

    assert.strictEqual(scene.render(), 'kit / large');
    assert.true(loader.isModuleLoaded(`${buttonV2}index.js`));
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
