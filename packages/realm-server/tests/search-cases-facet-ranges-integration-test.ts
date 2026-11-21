import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for facet ranges and measures, on a corpus of talks seeded
// fresh for each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, search } = shared;

  test('a facet measure aggregates another field per value', async function (assert) {
    let { meta } = await search({
      filter: { type: on },
      facets: [
        { by: 'channel', measure: { avg: 'hnScore' }, order: 'measure' },
      ],
    });
    assert.deepEqual(meta.facets?.channel, [
      { value: 'GOTO', count: 2, measure: { avg: 45 } },
      { value: 'Strange Loop', count: 3, measure: { avg: 20 } },
    ]);
    let max = await search({
      filter: { type: on },
      facets: [{ by: 'channel', measure: { max: 'hnScore' } }],
    });
    assert.deepEqual(max.meta.facets?.channel, [
      { value: 'Strange Loop', count: 3, measure: { max: 30 } },
      { value: 'GOTO', count: 2, measure: { max: 50 } },
    ]);
  });
});
