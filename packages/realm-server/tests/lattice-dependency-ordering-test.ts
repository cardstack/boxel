import QUnit from 'qunit';
import { VirtualNetwork } from '@cardstack/runtime-common/virtual-network';
import { IndexRunnerDependencyManager } from '@cardstack/runtime-common/index-runner/dependency-resolver';

const { module, test } = QUnit;

module('Lattice dependency ordering', function () {
  test('orders dependencies across batches without retaining a realm-sized row result', async function (assert) {
    let urls = Array.from(
      { length: 1001 },
      (_, i) => new URL(`http://test/realm/card-${i}.json`),
    );
    let css = `http://test/realm/view.gts.${'YQ'.repeat(5000)}.glimmer-scoped.css`;
    let rows = new Map(
      urls.map((url, i) => [
        url.href,
        {
          url: url.href,
          type: 'instance' as const,
          deps: i < urls.length - 1 ? [urls[i + 1].href, css] : [css],
        },
      ]),
    );
    let largestRead = 0;
    let manager = new IndexRunnerDependencyManager({
      realmURL: new URL('http://test/realm/'),
      virtualNetwork: new VirtualNetwork(),
      readDefinitionCacheEntries: async () => ({}),
      getDependencyRows: async () => [],
      getInvalidations: () => urls.map((url) => url.href),
      getOrderingDependencyRows: async (requested) => {
        largestRead = Math.max(largestRead, requested.length);
        return requested.map((url) => rows.get(url)!);
      },
    });
    assert.deepEqual(
      (await manager.orderInvalidationsByDependencies(urls)).map(
        (url) => url.href,
      ),
      [...urls].reverse().map((url) => url.href),
      'the full cross-batch chain is ordered before its dependents',
    );
    assert.true(largestRead <= 250, 'stored payload reads remain bounded');
  });
});
