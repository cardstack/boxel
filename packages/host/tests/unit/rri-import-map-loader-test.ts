import { module, test } from 'qunit';

import { Loader, VirtualNetwork } from '@cardstack/runtime-common';

const DASHBOARD_URL = 'https://realms.example/acme/dashboard/';
const PALETTE_URL = 'https://packages.example/catalog/palette/';
const PALETTE_V1_URL = 'https://packages.example/catalog/palette@1.0.0/';
const PALETTE_V2_URL = 'https://packages.example/catalog/palette@2.0.0/';

const fixtureSources: Record<string, string> = {
  [`${DASHBOARD_URL}scene.js`]: `
    import { paletteName } from 'palette';
    export function render() { return paletteName('Tokyo Night'); }
  `,
  [`${DASHBOARD_URL}legacy-viewer/scene.js`]: `
    import { legacyPalette } from 'palette';
    export function render() { return legacyPalette('Mochalatte'); }
  `,
  [`${DASHBOARD_URL}legacy-viewer-experiments/scene.js`]: `
    import { paletteName } from 'palette';
    export function render() { return paletteName('Sibling'); }
  `,
  [`${PALETTE_V1_URL}index.js`]: `
    export function legacyPalette(name) { return name + ' via palette v1'; }
  `,
  [`${PALETTE_V2_URL}index.js`]: `
    export function paletteName(name) { return name + ' via palette v2'; }
  `,
};

function makeLoader() {
  let sources = { ...fixtureSources };
  let virtualNetwork = new VirtualNetwork();
  virtualNetwork.addRealmMapping('@acme/dashboard/', DASHBOARD_URL);
  virtualNetwork.addRealmMapping('@catalog/palette/', PALETTE_URL);
  virtualNetwork.setRRIImportMap({
    imports: { palette: '@catalog/palette@2.0.0/index.js' },
    scopes: {
      '@acme/dashboard/legacy-viewer/': {
        palette: '@catalog/palette@1.0.0/index.js',
      },
    },
  });

  let fetch: typeof globalThis.fetch = async (input) => {
    let url = input instanceof Request ? input.url : input.toString();
    let source = sources[url];
    return source === undefined
      ? new Response(`missing fixture: ${url}`, { status: 404 })
      : new Response(source, {
          status: 200,
          headers: { 'content-type': 'text/javascript' },
        });
  };
  let loader = new Loader(fetch, virtualNetwork.resolveImport, {
    virtualNetwork,
  });
  return { loader, virtualNetwork, sources };
}

module('Unit | Loader | canonical RRI import map', function () {
  test('keeps two exact package Versions resident for different importers', async function (assert) {
    let { loader } = makeLoader();
    let current = await loader.import<{ render(): string }>(
      `${DASHBOARD_URL}scene.js`,
    );
    let legacy = await loader.import<{ render(): string }>(
      `${DASHBOARD_URL}legacy-viewer/scene.js`,
    );

    assert.strictEqual(current.render(), 'Tokyo Night via palette v2');
    assert.strictEqual(legacy.render(), 'Mochalatte via palette v1');
    assert.true(
      loader.isModuleLoaded(`${PALETTE_V1_URL}index.js`),
      'v1 remains loaded',
    );
    assert.true(
      loader.isModuleLoaded(`${PALETTE_V2_URL}index.js`),
      'v2 remains loaded',
    );
    loader.dispose();
  });

  test('does not apply a directory scope to a similarly named sibling', async function (assert) {
    let { loader } = makeLoader();
    let sibling = await loader.import<{ render(): string }>(
      `${DASHBOARD_URL}legacy-viewer-experiments/scene.js`,
    );

    assert.strictEqual(sibling.render(), 'Sibling via palette v2');
    loader.dispose();
  });

  test('replacing the canonical lock invalidates evaluated modules', async function (assert) {
    let { loader, virtualNetwork, sources } = makeLoader();
    let before = await loader.import<{ render(): string }>(
      `${DASHBOARD_URL}scene.js`,
    );
    assert.strictEqual(before.render(), 'Tokyo Night via palette v2');

    virtualNetwork.setRRIImportMap({
      imports: { palette: '@catalog/palette@1.0.0/index.js' },
      scopes: {},
    });
    sources[`${DASHBOARD_URL}scene.js`] = `
      import { legacyPalette } from 'palette';
      export function render() { return legacyPalette('Tokyo Night'); }
    `;
    let after = await loader.import<{ render(): string }>(
      `${DASHBOARD_URL}scene.js`,
    );

    assert.strictEqual(after.render(), 'Tokyo Night via palette v1');
    loader.dispose();
  });
});
