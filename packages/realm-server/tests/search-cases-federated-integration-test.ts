import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { combineSearchEntryResults } from '@cardstack/runtime-common';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for federated merge, on a corpus of talks seeded fresh for
// each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  setupTalkCorpus(hooks);

  test('a facet measure merges across realms', function (assert) {
    let merged = combineSearchEntryResults([
      {
        data: [],
        meta: {
          page: { total: 2 },
          facets: { brand: [{ value: 'X', count: 1, measure: { avg: 10 } }] },
        },
      },
      {
        data: [],
        meta: {
          page: { total: 3 },
          facets: { brand: [{ value: 'X', count: 3, measure: { avg: 30 } }] },
        },
      },
    ] as any);
    assert.deepEqual((merged as any).meta.facets.brand, [
      { value: 'X', count: 4, measure: { avg: 25 } },
    ]);
  });
});
