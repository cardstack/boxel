import type { SharedTests } from '../helpers';
import { IndexRunnerDependencyManager } from '../index-runner/dependency-resolver';
import type { DependencyIndexRow } from '../index';

type Row = Pick<DependencyIndexRow, 'url' | 'type' | 'deps'>;

function buildManager(rowsByURL: Record<string, Row>) {
  return new IndexRunnerDependencyManager({
    realmURL: new URL('http://test.localhost/'),
    readModuleCacheEntries: async () => ({}),
    getDependencyRows: async () => [],
    getOrderingDependencyRows: async (urls: string[]) =>
      urls.map((url) => rowsByURL[url] ?? { url, type: 'file', deps: [] }),
    getInvalidations: () => [],
  });
}

function urls(...hrefs: string[]): URL[] {
  return hrefs.map((href) => new URL(href));
}

const tests = Object.freeze({
  'orderInvalidationsByDependencies: empty input': async (assert) => {
    let manager = buildManager({});
    let result = await manager.orderInvalidationsByDependencies([]);
    assert.deepEqual(result.ordered, []);
    assert.strictEqual(result.maxLayerWidth, 0);
    assert.strictEqual(result.topoDepth, 0);
  },

  'orderInvalidationsByDependencies: single URL': async (assert) => {
    let manager = buildManager({});
    let [url] = urls('http://test.localhost/a');
    let result = await manager.orderInvalidationsByDependencies([url!]);
    assert.strictEqual(result.ordered.length, 1);
    assert.strictEqual(result.ordered[0]!.href, url!.href);
    assert.strictEqual(result.maxLayerWidth, 1);
    assert.strictEqual(result.topoDepth, 1);
  },

  'orderInvalidationsByDependencies: flat fan-out reports correct layer width':
    async (assert) => {
      // a depends on root; b depends on root; c depends on root.
      // Layers: [root] (width 1) -> [a, b, c] (width 3). Depth 2.
      let rootURL = 'http://test.localhost/root';
      let manager = buildManager({
        [`${rootURL}`]: { url: rootURL, type: 'file', deps: [] },
        'http://test.localhost/a': {
          url: 'http://test.localhost/a',
          type: 'instance',
          deps: [rootURL],
        },
        'http://test.localhost/b': {
          url: 'http://test.localhost/b',
          type: 'instance',
          deps: [rootURL],
        },
        'http://test.localhost/c': {
          url: 'http://test.localhost/c',
          type: 'instance',
          deps: [rootURL],
        },
      });
      let input = urls(
        rootURL,
        'http://test.localhost/a',
        'http://test.localhost/b',
        'http://test.localhost/c',
      );
      let result = await manager.orderInvalidationsByDependencies(input);
      assert.strictEqual(result.ordered.length, 4);
      assert.strictEqual(result.ordered[0]!.href, rootURL);
      assert.strictEqual(result.maxLayerWidth, 3);
      assert.strictEqual(result.topoDepth, 2);
    },

  'orderInvalidationsByDependencies: linear chain reports width 1 and full depth':
    async (assert) => {
      // a -> b -> c -> d (each depends on the previous one).
      // Every layer has exactly 1 node, depth 4.
      let aURL = 'http://test.localhost/a';
      let bURL = 'http://test.localhost/b';
      let cURL = 'http://test.localhost/c';
      let dURL = 'http://test.localhost/d';
      let manager = buildManager({
        [aURL]: { url: aURL, type: 'file', deps: [] },
        [bURL]: { url: bURL, type: 'file', deps: [aURL] },
        [cURL]: { url: cURL, type: 'file', deps: [bURL] },
        [dURL]: { url: dURL, type: 'file', deps: [cURL] },
      });
      let result = await manager.orderInvalidationsByDependencies(
        urls(aURL, bURL, cURL, dURL),
      );
      assert.strictEqual(result.ordered.length, 4);
      assert.strictEqual(result.ordered[0]!.href, aURL);
      assert.strictEqual(result.ordered[3]!.href, dURL);
      assert.strictEqual(result.maxLayerWidth, 1);
      assert.strictEqual(result.topoDepth, 4);
    },

  'orderInvalidationsByDependencies: diamond reports widest layer': async (
    assert,
  ) => {
    // root -> [a, b] -> tail.
    // Layers: [root] (1), [a, b] (2), [tail] (1). Width 2, depth 3.
    let rootURL = 'http://test.localhost/root';
    let aURL = 'http://test.localhost/a';
    let bURL = 'http://test.localhost/b';
    let tailURL = 'http://test.localhost/tail';
    let manager = buildManager({
      [rootURL]: { url: rootURL, type: 'file', deps: [] },
      [aURL]: { url: aURL, type: 'instance', deps: [rootURL] },
      [bURL]: { url: bURL, type: 'instance', deps: [rootURL] },
      [tailURL]: { url: tailURL, type: 'instance', deps: [aURL, bURL] },
    });
    let result = await manager.orderInvalidationsByDependencies(
      urls(rootURL, aURL, bURL, tailURL),
    );
    assert.strictEqual(result.ordered.length, 4);
    assert.strictEqual(result.ordered[0]!.href, rootURL);
    assert.strictEqual(result.ordered[3]!.href, tailURL);
    assert.strictEqual(result.maxLayerWidth, 2);
    assert.strictEqual(result.topoDepth, 3);
  },
} as SharedTests<unknown>);

export default tests;
