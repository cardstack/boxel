import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import type { IndexQueryEngine } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query-v2/query';
import { testRealm } from './helpers/index.ts';
import { setupTalkCorpus } from './helpers/talk-corpus.ts';

// Search cases for relevance and explain, on a corpus of talks seeded fresh
// for each test (helpers/talk-corpus.ts).

module(basename(import.meta.filename), function (hooks) {
  const shared = setupTalkCorpus(hooks);
  const { on } = shared;
  let engine: IndexQueryEngine;
  hooks.beforeEach(function () {
    ({ engine } = shared);
  });

  test('explain gives each result its signals, ranks and shares', async function (assert) {
    let rows = async (query: Query) =>
      (
        await engine.search(
          new URL(testRealm),
          query,
          {},
          { kind: 'renderSet' },
        )
      ).results.map((r: any) => ({
        name: r.url.replace(`${testRealm}Talk/`, '').replace('.json', ''),
        explain: r._explain,
        score: Number(r._blendScore),
        stray: Object.keys(r).filter((k) => /^_x\d+_/.test(k)),
      }));
    let query: Query = {
      filter: { type: on },
      explain: true,
      sort: [
        {
          by: '_blend',
          of: [
            { on, by: 'hnScore' },
            { by: '_when', when: { on, eq: { channel: 'GOTO' } }, weight: -2 },
          ],
        },
      ],
    };
    let all = await rows(query);
    let b = all.find((r) => r.name === 'b')!;
    assert.deepEqual(b.explain.signals, [
      {
        signal: 'hnScore',
        weight: 1,
        value: 30,
        rank: 3,
        contribution: 1 / 63,
      },
      {
        signal: 'when',
        weight: -2,
        inverted: true,
        value: 1,
        rank: 1,
        contribution: 2 / 61,
      },
    ]);
    assert.strictEqual(b.explain.k, 60);
    let d = all.find((r) => r.name === 'd')!;
    assert.strictEqual(
      d.explain.signals[1].rank,
      null,
      'a GOTO talk gets nothing from the inverted boost',
    );
    assert.strictEqual(d.explain.signals[1].contribution, 0);
    for (let r of all) {
      let sum = r.explain.signals.reduce(
        (t: number, x: any) => t + x.contribution,
        0,
      );
      assert.ok(
        Math.abs(sum - r.explain.score) < 1e-9,
        `${r.name}: the shares add up to the score`,
      );
      assert.deepEqual(
        r.stray,
        [],
        `${r.name}: no working columns left on the row`,
      );
    }
    let paged = await rows({ ...query, page: { number: 1, size: 2 } });
    assert.deepEqual(
      paged.map((r) => r.explain.signals[0].rank),
      [5, 6],
      'a page (a, f) carries ranks over the whole match set',
    );
    let plain = await rows({ ...query, explain: undefined });
    assert.strictEqual(plain[0].explain, undefined, 'nothing without explain');
  });

  test('explain names _relevance signals', async function (assert) {
    let { results } = await engine.search(
      new URL(testRealm),
      {
        filter: { on, matches: 'loop', fields: ['channel'] },
        explain: true,
        sort: [{ by: '_relevance', on, weights: { popularity: -1, text: 0 } }],
      },
      {},
      { kind: 'renderSet' },
    );
    let signals = (results[0] as any)._explain.signals;
    assert.deepEqual(
      signals.map((x: any) => [x.signal, x.weight, x.inverted ?? false]),
      [
        ['popularity', -1, true],
        ['recency', 0.5, false],
      ],
    );
    assert.strictEqual(
      (results[0] as any).url,
      `${testRealm}Talk/a.json`,
      'least popular first',
    );
  });
});
