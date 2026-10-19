import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { projectRRIImportMap, rri as deckRRI } from '@cardstack/deck';
import {
  DeckPackageResolver,
  Loader,
  VirtualNetwork,
  resolveImportThroughDeck,
  type DeckResolutionChange,
} from '@cardstack/runtime-common';

const DASHBOARD_URL = 'https://realms.example/acme/dashboard/';
const PALETTE_V1_URL = 'https://packages.example/catalog/palette/1.0.0/';
const PALETTE_V2_URL = 'https://packages.example/catalog/palette/2.0.0/';

// `palette` resolves to 2.0.0 everywhere except under the legacy viewer,
// whose scope pins 1.0.0.
const LOCK = {
  imports: { palette: deckRRI('@catalog/palette@2.0.0/index.js') },
  scopes: {
    '@acme/dashboard/legacy-viewer/': {
      palette: deckRRI('@catalog/palette@1.0.0/index.js'),
    },
  },
};

function makeNetwork() {
  let network = new VirtualNetwork();
  network.addRealmMapping('@acme/dashboard/', DASHBOARD_URL);
  // An exact Version root is an ordinary RRI prefix, so the network needs no
  // Deck-specific code to resolve one.
  network.addRealmMapping('@catalog/palette@1.0.0/', PALETTE_V1_URL);
  network.addRealmMapping('@catalog/palette@2.0.0/', PALETTE_V2_URL);
  return network;
}

module(basename(import.meta.filename), function () {
  module('resolving through a lock', function (hooks) {
    let network: VirtualNetwork;
    let resolver: DeckPackageResolver;
    let resolveImport: (id: string, relativeTo?: string) => string;

    hooks.beforeEach(function () {
      network = makeNetwork();
      resolver = new DeckPackageResolver();
      resolver.setLock(LOCK);
      resolveImport = resolveImportThroughDeck(resolver, network);
    });

    test('one specifier resolves to a different exact Version per importer', function (assert) {
      assert.strictEqual(
        resolveImport('palette', `${DASHBOARD_URL}scene.js`),
        `${PALETTE_V2_URL}index.js`,
        'the global import serves the current Version',
      );
      assert.strictEqual(
        resolveImport('palette', `${DASHBOARD_URL}legacy-viewer/scene.js`),
        `${PALETTE_V1_URL}index.js`,
        "the importer's scope serves the legacy Version",
      );
      assert.strictEqual(
        resolveImport(
          'palette',
          `${DASHBOARD_URL}legacy-viewer-experiments/scene.js`,
        ),
        `${PALETTE_V2_URL}index.js`,
        'a sibling directory does not inherit the scope',
      );
    });

    test('the resolver answers in RRIs and never in URLs', function (assert) {
      assert.strictEqual(
        resolver.resolve('palette', '@acme/dashboard/legacy-viewer/scene.js'),
        '@catalog/palette@1.0.0/index.js',
      );
    });

    test('a request with no importer uses global imports but never a scope', function (assert) {
      assert.strictEqual(
        resolver.resolve('palette'),
        '@catalog/palette@2.0.0/index.js',
      );
    });

    test('an importer that is not an RRI gets no answer', function (assert) {
      assert.strictEqual(
        resolver.resolve('palette', 'https://unmapped.example/realm/scene.js'),
        undefined,
      );
      assert.strictEqual(
        resolveImport('palette', 'https://unmapped.example/realm/scene.js'),
        network.resolveImport('palette'),
        'the network resolves it as it would without Deck',
      );
    });

    test('a specifier already shaped as an RRI is left to the network', function (assert) {
      network.addImportMap(
        '@babel/runtime/',
        (rest) => `https://npm.example/${rest}`,
      );
      assert.strictEqual(
        resolver.resolve('@babel/runtime/helpers/objectSpread2'),
        undefined,
      );
      assert.strictEqual(
        resolveImport('@babel/runtime/helpers/objectSpread2'),
        'https://npm.example/helpers/objectSpread2',
        'the existing shim still answers',
      );
    });

    test('a browser import map can be projected from the lock without changing it', function (assert) {
      let projected = projectRRIImportMap(resolver.getLock(), (identifier) =>
        network.toURLHref(identifier),
      );
      assert.deepEqual(projected, {
        imports: { palette: `${PALETTE_V2_URL}index.js` },
        scopes: {
          [`${DASHBOARD_URL}legacy-viewer/`]: {
            palette: `${PALETTE_V1_URL}index.js`,
          },
        },
      });
      assert.deepEqual(resolver.getLock(), LOCK, 'the lock keeps its RRIs');
    });
  });

  module('the lock', function () {
    test('accepts only exact Version RRIs as targets', function (assert) {
      let resolver = new DeckPackageResolver();
      assert.throws(
        () =>
          resolver.setLock({
            imports: { palette: `${PALETTE_V2_URL}index.js` },
            scopes: {},
          }),
        /canonical Deck locks require RRI targets/,
        'a transport URL is refused',
      );
      assert.throws(
        () =>
          resolver.setLock({
            imports: { palette: '@catalog/palette/index.js' },
            scopes: {},
          }),
        /must be exact Versions/,
        'an unversioned RRI is refused',
      );
    });

    test('reports a change only when what it would answer changes', function (assert) {
      let resolver = new DeckPackageResolver();
      let changes: DeckResolutionChange[] = [];
      resolver.onChange((change) => changes.push(change));

      resolver.setLock(LOCK);
      assert.deepEqual(changes, ['additive'], 'a first lock only adds');
      resolver.setLock(resolver.getLock());
      assert.deepEqual(changes, ['additive'], 'the same lock again is inert');
      resolver.setLock({
        ...LOCK,
        scopes: {
          ...LOCK.scopes,
          '@acme/dashboard/reports/': {
            palette: deckRRI('@catalog/palette@1.0.0/index.js'),
          },
        },
      });
      assert.deepEqual(
        changes,
        ['additive', 'additive'],
        'a new scope only adds',
      );
      resolver.clear();
      assert.deepEqual(
        changes,
        ['additive', 'additive', 'destructive'],
        'removing entries is destructive',
      );
    });
  });

  module('loading through a lock', function () {
    const sources: Record<string, string> = {
      [`${DASHBOARD_URL}scene.js`]: `
        import { paletteName } from 'palette';
        export function render() { return paletteName('Tokyo Night'); }
      `,
      [`${DASHBOARD_URL}legacy-viewer/scene.js`]: `
        import { legacyPalette } from 'palette';
        export function render() { return legacyPalette('Mochalatte'); }
      `,
      [`${PALETTE_V1_URL}index.js`]: `
        export function legacyPalette(name) { return name + ' via palette v1'; }
        export function paletteName(name) { return name + ' via palette v1'; }
      `,
      [`${PALETTE_V2_URL}index.js`]: `
        export function paletteName(name) { return name + ' via palette v2'; }
      `,
    };

    function makeLoader() {
      let network = makeNetwork();
      let resolver = new DeckPackageResolver();
      resolver.setLock(LOCK);
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
      let loader = new Loader(
        fetch,
        resolveImportThroughDeck(resolver, network),
        {
          virtualNetwork: network,
          onResolutionChange: (listener) => resolver.onChange(listener),
        },
      );
      return { loader, resolver };
    }

    test('two exact Versions of one package stay resident for different importers', async function (assert) {
      let { loader } = makeLoader();
      let current = await loader.import<{ render(): string }>(
        `${DASHBOARD_URL}scene.js`,
      );
      let legacy = await loader.import<{ render(): string }>(
        `${DASHBOARD_URL}legacy-viewer/scene.js`,
      );
      assert.strictEqual(current.render(), 'Tokyo Night via palette v2');
      assert.strictEqual(legacy.render(), 'Mochalatte via palette v1');
    });

    test('an additive lock change keeps registered modules', async function (assert) {
      let { loader, resolver } = makeLoader();
      let before = await loader.import<object>(`${DASHBOARD_URL}scene.js`);
      resolver.setLock({
        ...LOCK,
        scopes: {
          ...LOCK.scopes,
          '@acme/dashboard/reports/': {
            palette: deckRRI('@catalog/palette@1.0.0/index.js'),
          },
        },
      });
      let after = await loader.import<object>(`${DASHBOARD_URL}scene.js`);
      assert.strictEqual(after, before, 'the same module instance is reused');
    });

    test('a destructive lock change re-resolves registered modules', async function (assert) {
      let { loader, resolver } = makeLoader();
      let before = await loader.import<{ render(): string }>(
        `${DASHBOARD_URL}scene.js`,
      );
      assert.strictEqual(before.render(), 'Tokyo Night via palette v2');
      resolver.setLock({
        imports: { palette: deckRRI('@catalog/palette@1.0.0/index.js') },
        scopes: {},
      });
      let after = await loader.import<{ render(): string }>(
        `${DASHBOARD_URL}scene.js`,
      );
      assert.strictEqual(after.render(), 'Tokyo Night via palette v1');
    });
  });
});
