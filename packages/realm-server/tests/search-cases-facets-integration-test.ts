import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupTalkCorpus } from './helpers/talk-corpus.ts';
import { searchStatementsJit } from './helpers/jit-guard.ts';

// Search cases for facet counts, on a corpus of talks seeded fresh for each
// test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, search, byScore } = shared;

  test('collapse takes the filter anchor, and facets count every match', async function (assert) {
    let { titles, meta } = await search({
      filter: { on, range: { hnScore: { gte: 10 } } },
      sort: byScore,
      collapse: 'channel',
      facets: [{ by: 'channel' }],
    });
    assert.deepEqual(titles, ['d', 'b']);
    assert.deepEqual(meta.facets?.channel, [
      { value: 'Strange Loop', count: 3 },
      { value: 'GOTO', count: 2 },
    ]);
  });

  // jit off for every statement of a search: its page, its exact total and
  // its facets (search-session.ts; helpers/jit-guard.ts)
  test('a page, its total and its facets never compile', async function (assert) {
    let { value, checked, compiled } = await searchStatementsJit(() =>
      search({
        filter: { on, range: { hnScore: { gte: 1 } } },
        sort: byScore,
        page: { size: 2, total: 'exact' } as any,
        facets: [{ by: 'channel', measure: { avg: 'hnScore' } }],
      }),
    );
    assert.deepEqual(value.titles, ['d', 'e'], 'the page');
    assert.ok(checked >= 2, `statements explained: ${checked}`);
    assert.deepEqual(compiled, [], 'none would compile');
  });
});
