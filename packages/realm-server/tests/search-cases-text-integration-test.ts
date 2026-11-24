import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for text search, on a corpus of talks seeded fresh for each
// test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on, search, byScore } = shared;

  test('matches with fields searches only those fields, any case, stemmed', async function (assert) {
    let titles = async (filter: any) =>
      (
        await search({
          filter: { every: [{ type: on }, filter] },
          sort: byScore,
        })
      ).titles;
    assert.deepEqual(
      await titles({ on, matches: 'loops', fields: ['channel'] }),
      ['b', 'c', 'a'],
      'a stemmed word in the channel',
    );
    assert.deepEqual(
      await titles({ on, matches: 'goto', fields: ['channel'] }),
      ['d', 'e'],
      'case does not matter',
    );
    assert.deepEqual(
      await titles({ on, matches: 'kleppmann', fields: ['channel'] }),
      [],
      'a word in another field does not count',
    );
    assert.deepEqual(
      await titles({
        on,
        matches: 'kleppmann',
        fields: ['channel', 'speakers'],
      }),
      ['a'],
      'a list field counts its values',
    );
    assert.deepEqual(
      await titles({ not: { on, matches: 'strange', fields: ['channel'] } }),
      ['d', 'e', 'f', 'g'],
      'it negates cleanly, keeping cards with no value',
    );
  });
});
