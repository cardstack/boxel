// `assertQuery` is the gate in front of every query the platform accepts from
// outside itself — the `/_search` and `/_federated-search` endpoints, the AI
// search tool's model-authored query, and the second opinion on a card
// author's declared `query` operation. A shape it accepts reaches the query
// engine, which compiles whatever it can make of it, so a filter that clears
// validation malformed does not fail loudly: it runs and matches the wrong
// rows.
//
// Every collection in the grammar is therefore validated entry by entry, not
// just at its head. Each case below puts the offending entry in a
// **non-first** position, which is the only position that distinguishes a loop
// that walks the whole collection from one that stops at the first entry.
import type { RealmResourceIdentifier } from '../realm-identifiers.ts';
import type { SharedTests } from '../helpers/index.ts';
import { InvalidQueryError, assertQuery } from '../query.ts';

const sampleRef = {
  module: 'http://localhost:4201/test/person' as RealmResourceIdentifier,
  name: 'Person',
};

const tests = Object.freeze({
  'assertQuery validates every element of an any filter': async (assert) => {
    assert.throws(
      () =>
        assertQuery({
          filter: { any: [{ eq: { status: 'open' } }, 'not a filter'] },
        }),
      (err: Error) =>
        err instanceof InvalidQueryError && /filter\/\[1\]/.test(err.message),
      'the second any element is rejected, and the pointer names it',
    );
  },

  'assertQuery validates every field path of a range filter': async (
    assert,
  ) => {
    assert.throws(
      () =>
        assertQuery({
          filter: { range: { a: { gt: 1 }, b: { bogus: 2 } } },
        }),
      (err: Error) =>
        err instanceof InvalidQueryError && /filter\/b/.test(err.message),
      'the second field path is rejected, and the pointer names it',
    );
  },

  'assertQuery validates every constraint of a range field': async (assert) => {
    assert.throws(
      () => assertQuery({ filter: { range: { a: { gt: 1, bogus: 2 } } } }),
      (err: Error) =>
        err instanceof InvalidQueryError &&
        /filter\/a\/bogus: range item must be gt, gte, lt, or lte/.test(
          err.message,
        ),
      'an unknown constraint key after a valid one is rejected, and the pointer names it',
    );
    assert.throws(
      () => assertQuery({ filter: { range: { a: { gt: 1, lt: {} } } } }),
      (err: Error) =>
        err instanceof InvalidQueryError &&
        /filter\/a\/lt: JSON primitive/.test(err.message),
      'and so is a non-primitive bound after a valid one',
    );
  },

  'assertQuery validates every entry of a nested JSON value': async (
    assert,
  ) => {
    assert.throws(
      () =>
        assertQuery({
          filter: { eq: { title: { a: 1, b: () => {} } } },
        }),
      (err: Error) =>
        err instanceof InvalidQueryError &&
        /filter\/title\/b: value not allowed in json/.test(err.message),
      'the second key of a nested object is rejected',
    );
    assert.throws(
      () =>
        assertQuery({
          filter: {
            contains: {
              meta: { first: { ok: 1 }, second: { deep: undefined } },
            },
          },
        }),
      (err: Error) =>
        err instanceof InvalidQueryError &&
        /filter\/meta\/second\/deep: value not allowed in json/.test(
          err.message,
        ),
      'and so is a non-JSON leaf below the second key, at any depth',
    );
  },

  'assertQuery validates every element of a nested JSON array': async (
    assert,
  ) => {
    assert.throws(
      () => assertQuery({ filter: { eq: { tags: [1, () => {}] } } }),
      (err: Error) =>
        err instanceof InvalidQueryError &&
        /filter\/tags\/\[1\]: value not allowed in json/.test(err.message),
      'the second element of a nested array is rejected',
    );
  },

  'assertQuery accepts the multi-entry shapes the grammar allows': async (
    assert,
  ) => {
    // Walking a whole collection rejects more shapes than walking its head, so
    // these pin the shapes that must keep clearing validation: the search
    // query-builder's OR of a full-text match with two title matches, and a
    // range naming several field paths with several bounds each.
    let accepted = [
      {
        filter: {
          any: [
            { matches: 'mango' },
            { contains: { _title: 'mango' } },
            { contains: { cardTitle: 'mango' } },
          ],
        },
      },
      {
        filter: {
          range: {
            views: { lte: 10, gt: 5 },
            'author.posts': { gte: 1 },
          },
        },
      },
      {
        filter: {
          on: sampleRef,
          every: [
            { eq: { nested: { a: 1, b: 'two', c: null, d: [1, 2, 3] } } },
            { in: { status: ['open', 'closed'] } },
          ],
        },
      },
    ];
    for (let query of accepted) {
      try {
        assertQuery(query);
        assert.ok(true, `accepted ${JSON.stringify(query)}`);
      } catch (err) {
        assert.ok(
          false,
          `unexpected throw for ${JSON.stringify(query)}: ${
            (err as Error).message
          }`,
        );
      }
    }
  },
} as SharedTests<{}>);

export default tests;
