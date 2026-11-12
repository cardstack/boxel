import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type {
  IncrementalIndexEventContent,
  RealmWideIncrementalIndexEventContent,
} from '@cardstack/base/matrix-event';
import { incrementalCompletionThatFits } from '@cardstack/runtime-common';

const realmURL = 'http://127.0.0.1:4444/test/';

// What one Matrix event may carry, the limit every completion must stay under.
const MATRIX_EVENT_LIMIT = 65536;

function encodedBytes(event: unknown) {
  return new TextEncoder().encode(JSON.stringify(event)).length;
}

// `count` card URLs about `length` bytes each, plus the modules named.
function completion(
  count: number,
  extra: Partial<IncrementalIndexEventContent> = {},
  modules: string[] = [],
): IncrementalIndexEventContent {
  return {
    eventName: 'index',
    indexType: 'incremental',
    invalidations: [
      ...modules,
      ...Array.from(
        { length: count },
        (_, i) =>
          `${realmURL}cards/${String(i).padStart(5, '0')}-${'x'.repeat(80)}`,
      ),
    ],
    generation: 7,
    realmURL,
    ...extra,
  };
}

module(basename(import.meta.filename), function () {
  test('a completion that fits goes out as listed', function (assert) {
    let content = completion(10, { clientRequestId: 'instance:small' });
    let { event, warning } = incrementalCompletionThatFits(content);
    assert.strictEqual(event, content, 'the listed form is sent unchanged');
    assert.strictEqual(warning, undefined, 'and nothing is reported');
  });

  test('a completion that would overrun the event goes out realm-wide with its modules and request id', function (assert) {
    let modules = [`${realmURL}person.gts`, `${realmURL}pet.gts`];
    let content = completion(
      2000,
      { clientRequestId: 'instance:bulk' },
      modules,
    );
    assert.ok(
      encodedBytes(content) > MATRIX_EVENT_LIMIT,
      'the listed form is over the Matrix limit',
    );
    let { event, warning } = incrementalCompletionThatFits(content);
    let realmWide = event as RealmWideIncrementalIndexEventContent;
    assert.true(realmWide.realmWide, 'the completion is realm-wide');
    assert.false('invalidations' in realmWide, 'and carries no list');
    assert.deepEqual(
      realmWide.invalidatedModules,
      modules,
      'it names the modules the pass invalidated',
    );
    assert.strictEqual(realmWide.clientRequestId, 'instance:bulk');
    assert.strictEqual(realmWide.generation, 7);
    assert.ok(
      encodedBytes(realmWide) < MATRIX_EVENT_LIMIT,
      'it fits in a Matrix event',
    );
    assert.ok(warning, 'the overflow is reported for the sender to log');
  });

  test('authorship degrades toward re-reading: a list too large is emptied, and shared writers keep only their ids', function (assert) {
    let base = completion(2000);
    let content: IncrementalIndexEventContent = {
      ...base,
      clientRequestId: 'instance:bulk',
      clientAuthored: base.invalidations,
      coalescedWrites: [
        {
          clientRequestId: 'instance:bulk',
          changed: base.invalidations,
        },
        { clientRequestId: 'instance:other', changed: [base.invalidations[0]] },
      ],
    };
    let event = incrementalCompletionThatFits(content)
      .event as RealmWideIncrementalIndexEventContent;
    assert.deepEqual(
      event.clientAuthored,
      [],
      'the writer is told to re-read every card rather than keep any',
    );
    assert.deepEqual(
      event.coalescedWrites,
      [
        { clientRequestId: 'instance:bulk', changed: null },
        { clientRequestId: 'instance:other', changed: null },
      ],
      'each shared writer keeps its id with changed: null',
    );

    let small: IncrementalIndexEventContent = {
      ...base,
      clientRequestId: 'instance:bulk',
      clientAuthored: [base.invalidations[0]],
    };
    let kept = incrementalCompletionThatFits(small)
      .event as RealmWideIncrementalIndexEventContent;
    assert.deepEqual(
      kept.clientAuthored,
      [base.invalidations[0]],
      'a writer list that fits is kept as it was',
    );
  });

  test('a completion whose modules alone overrun the event goes out bare', function (assert) {
    let modules = Array.from(
      { length: 2000 },
      (_, i) =>
        `${realmURL}modules/${String(i).padStart(5, '0')}-${'m'.repeat(80)}.gts`,
    );
    let content = completion(0, { clientRequestId: 'instance:code' }, modules);
    let event = incrementalCompletionThatFits(content)
      .event as RealmWideIncrementalIndexEventContent;
    assert.strictEqual(
      event.invalidatedModules,
      undefined,
      'without the module list, a subscriber assumes any module may have changed',
    );
    assert.strictEqual(event.clientRequestId, 'instance:code');
    assert.ok(encodedBytes(event) < MATRIX_EVENT_LIMIT);
  });
});
