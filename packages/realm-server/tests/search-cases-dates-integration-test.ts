import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { resolveRelativeDate } from '@cardstack/runtime-common/query-v2/query-values';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for dates and time zones, on a corpus of talks seeded fresh
// for each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  setupTalkCorpus(hooks);

  test('relative dates resolve and round in UTC', function (assert) {
    let now = new Date('2026-11-07T15:42:10.500Z');
    assert.strictEqual(
      resolveRelativeDate('now', now),
      '2026-11-07T15:42:10.500Z',
    );
    assert.strictEqual(
      resolveRelativeDate('now-30d', now),
      '2026-10-08T15:42:10.500Z',
    );
    assert.strictEqual(
      resolveRelativeDate('now-1M/M', now),
      '2026-10-01T00:00:00.000Z',
    );
    assert.strictEqual(
      resolveRelativeDate('now/w', now),
      '2026-11-02T00:00:00.000Z',
      'weeks start Monday',
    );
    assert.strictEqual(
      resolveRelativeDate('now+2h/h', now),
      '2026-11-07T17:00:00.000Z',
    );
    assert.strictEqual(
      resolveRelativeDate('2026-01-01', now),
      '2026-01-01',
      'a literal stays',
    );
  });
});
