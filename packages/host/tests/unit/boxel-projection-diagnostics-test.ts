import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common/realm-identifiers';

import config from '@cardstack/host/config/environment';
import type { MissingProjectionPath } from '@cardstack/host/lib/boxel-projection-diagnostics';
import { observeMissingProjectionPaths } from '@cardstack/host/lib/boxel-projection-diagnostics';

const personRef = { module: rri('http://test/person'), name: 'Person' };

function watched(model: unknown, reported: MissingProjectionPath[]) {
  return observeMissingProjectionPaths(model, {
    type: personRef,
    format: 'isolated',
    mode: 'direct',
    report: (missing) => reported.push(missing),
  });
}

module('Unit | Boxel projection diagnostics', function () {
  test('a read of a path the projection lacks reports the whole path, the type, the format, and the mode', function (assert) {
    let reported: MissingProjectionPath[] = [];
    let model = watched({ venue: { name: 'Majestic' } }, reported) as Record<
      string,
      Record<string, unknown>
    >;

    model.venue.postcode;

    assert.deepEqual(reported, [
      {
        path: 'model.venue.postcode',
        type: personRef,
        format: 'isolated',
        mode: 'direct',
      },
    ]);
  });

  test('a missing path reads as undefined, so no card renders differently for being watched', function (assert) {
    let reported: MissingProjectionPath[] = [];
    let model = watched({ name: 'Hassan' }, reported) as Record<
      string,
      unknown
    >;

    assert.strictEqual(
      model.nickname,
      undefined,
      'nothing is synthesized in place of the member the projection lacks',
    );
    assert.strictEqual(model.name, 'Hassan', 'and a present member is itself');
    assert.strictEqual(reported.length, 1);
  });

  test('a member whose value is null or undefined is present, not missing', function (assert) {
    let reported: MissingProjectionPath[] = [];
    let model = watched(
      { theme: null, summary: undefined },
      reported,
    ) as Record<string, unknown>;

    model.theme;
    model.summary;

    assert.deepEqual(
      reported,
      [],
      'the projection carries both members; a consumer reading them learns what the card holds',
    );
  });

  test('the language’s own protocol members are not projected paths', function (assert) {
    let reported: MissingProjectionPath[] = [];
    let model = watched({ tags: ['gala'] }, reported) as Record<
      string,
      string[]
    >;

    // Iteration, thenability, and stringification are questions about the
    // wrapper rather than about the card, and each one reaches for a member no
    // projection was ever going to carry.
    [...model.tags];
    void (model as unknown as { then?: unknown }).then;
    String(model.tags);

    assert.deepEqual(reported, []);
  });

  test('a row’s index does not make a gap distinct, so a long list warns once', function (assert) {
    let model = observeMissingProjectionPaths(
      { rows: [{}, {}, {}] },
      { type: personRef, format: 'isolated', mode: 'direct' },
    ) as { rows: Record<string, unknown>[] };
    let warned: string[] = [];
    let original = console.warn;
    console.warn = (message: string) => warned.push(message);
    try {
      for (let row of model.rows) {
        row.total;
      }
    } finally {
      console.warn = original;
    }

    assert.strictEqual(
      warned.length,
      1,
      'an un-deduplicated report buries the second distinct gap under a thousand copies of the first',
    );
    assert.true(
      warned[0].includes('model.rows.0.total'),
      `and it names a concrete path rather than a pattern: ${warned[0]}`,
    );
  });

  test('in a production build the record is handed back untouched', function (assert) {
    let record = { name: 'Hassan' };
    let environment = config.environment;
    config.environment = 'production';
    try {
      assert.strictEqual(
        observeMissingProjectionPaths(record, {
          type: personRef,
          format: 'isolated',
          mode: 'direct',
          report: () => assert.true(false, 'nothing is watched in production'),
        }),
        record,
        'the record itself, not a view of it — no proxy exists to intercept a read',
      );
    } finally {
      config.environment = environment;
    }
  });
});
