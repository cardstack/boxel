import type { RealmResourceIdentifier } from '../realm-identifiers';
import type { SharedTests } from '../helpers';
import type { Filter } from '../query';
import {
  InvalidQueryError,
  assertQuery,
  isAnyFilter,
  isCardTypeFilter,
  isEveryFilter,
  isInFilter,
  isMatchesFilter,
  isNotFilter,
  isRangeFilter,
} from '../query';

const sampleRef = {
  module: 'http://localhost:4201/test/person' as RealmResourceIdentifier,
  name: 'Person',
};

const tests = Object.freeze({
  'isMatchesFilter returns true for a MatchesFilter': async (assert) => {
    let filter: Filter = { matches: 'hello world' };
    assert.true(isMatchesFilter(filter));
  },

  'isMatchesFilter returns true for a MatchesFilter with on': async (
    assert,
  ) => {
    let filter: Filter = { on: sampleRef, matches: 'hello' };
    assert.true(isMatchesFilter(filter));
  },

  'isMatchesFilter accepts empty string': async (assert) => {
    let filter: Filter = { matches: '' };
    assert.true(isMatchesFilter(filter));
  },

  'isMatchesFilter returns false for other filter types': async (assert) => {
    assert.false(isMatchesFilter({ type: sampleRef } as Filter));
    assert.false(isMatchesFilter({ eq: { name: 'Mango' } } as Filter));
    assert.false(isMatchesFilter({ contains: { name: 'Mango' } } as Filter));
    assert.false(isMatchesFilter({ not: { eq: { name: 'Mango' } } } as Filter));
    assert.false(isMatchesFilter({ any: [] } as Filter));
    assert.false(isMatchesFilter({ every: [] } as Filter));
    assert.false(isMatchesFilter({ in: { name: ['Mango'] } } as Filter));
    assert.false(isMatchesFilter({ range: { age: { gt: 1 } } } as Filter));
  },

  'isMatchesFilter does not confuse matches with other guards': async (
    assert,
  ) => {
    let filter: Filter = { matches: 'hello' };
    assert.false(isCardTypeFilter(filter));
    assert.false(isNotFilter(filter));
    assert.false(isRangeFilter(filter));
    assert.false(isEveryFilter(filter));
    assert.false(isAnyFilter(filter));
    assert.false(isInFilter(filter));
  },

  'assertQuery accepts a top-level MatchesFilter': async (assert) => {
    try {
      assertQuery({ filter: { matches: 'search term' } });
      assert.ok(true, 'assertQuery accepted top-level matches filter');
    } catch (err) {
      assert.ok(false, `unexpected throw: ${(err as Error).message}`);
    }
  },

  'assertQuery accepts MatchesFilter composed inside every': async (assert) => {
    try {
      assertQuery({
        filter: {
          every: [
            { matches: 'hello' },
            { eq: { name: 'Mango' } },
            { contains: { title: 'greeting' } },
            { range: { age: { gt: 10 } } },
            { type: sampleRef },
          ],
        },
      });
      assert.ok(true, 'every composition accepted');
    } catch (err) {
      assert.ok(false, `unexpected throw: ${(err as Error).message}`);
    }
  },

  'assertQuery accepts MatchesFilter composed inside any': async (assert) => {
    try {
      assertQuery({
        filter: {
          any: [
            { matches: 'one' },
            { matches: 'two' },
            { eq: { name: 'Mango' } },
          ],
        },
      });
      assert.ok(true, 'any composition accepted');
    } catch (err) {
      assert.ok(false, `unexpected throw: ${(err as Error).message}`);
    }
  },

  'assertQuery accepts MatchesFilter composed inside not': async (assert) => {
    try {
      assertQuery({ filter: { not: { matches: 'unwanted' } } });
      assert.ok(true, 'not composition accepted');
    } catch (err) {
      assert.ok(false, `unexpected throw: ${(err as Error).message}`);
    }
  },

  'assertQuery accepts MatchesFilter nested with on/type': async (assert) => {
    try {
      assertQuery({
        filter: {
          on: sampleRef,
          every: [{ matches: 'hello' }, { not: { matches: 'goodbye' } }],
        },
      });
      assert.ok(true, 'typed composition accepted');
    } catch (err) {
      assert.ok(false, `unexpected throw: ${(err as Error).message}`);
    }
  },

  'assertQuery rejects non-string matches value': async (assert) => {
    assert.throws(
      () => assertQuery({ filter: { matches: 123 } }),
      InvalidQueryError,
    );
    assert.throws(
      () => assertQuery({ filter: { matches: null } }),
      InvalidQueryError,
    );
    assert.throws(
      () => assertQuery({ filter: { matches: { query: 'x' } } }),
      InvalidQueryError,
    );
  },
} as SharedTests<{}>);

export default tests;
