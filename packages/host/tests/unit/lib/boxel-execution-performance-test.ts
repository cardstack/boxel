import { module, test } from 'qunit';

import { BoxelExecutionPerformanceRecorder } from '@cardstack/host/lib/boxel-execution-performance';

module('Unit | Boxel execution performance', function () {
  test('records ordered, exactly-once, data-only stage completions', function (assert) {
    let ticks = [10, 15, 20, 28];
    let recorder = new BoxelExecutionPerformanceRecorder(
      true,
      10,
      () => ticks.shift()!,
    );
    let first = recorder.start({
      operationId: 'operation:one',
      occurrenceId: 'surface:one',
      stage: 'classify',
    });
    assert.true(first.finish({ counters: { modules: 4 } }));
    assert.false(first.finish(), 'a stage can finish only once');
    recorder
      .start({
        operationId: 'operation:two',
        occurrenceId: 'surface:two',
        stage: 'runtime-create',
        tier: 'sandbox',
      })
      .finish({ status: 'error' });

    assert.deepEqual(recorder.snapshot(), {
      droppedRecords: 0,
      records: [
        {
          operationId: 'operation:one',
          occurrenceId: 'surface:one',
          sequence: 1,
          stage: 'classify',
          status: 'ok',
          startedAt: 10,
          endedAt: 15,
          durationMs: 5,
          counters: { modules: 4 },
        },
        {
          operationId: 'operation:two',
          occurrenceId: 'surface:two',
          sequence: 2,
          stage: 'runtime-create',
          tier: 'sandbox',
          status: 'error',
          startedAt: 20,
          endedAt: 28,
          durationMs: 8,
        },
      ],
    });
  });

  test('is bounded and keeps operation occurrences separate', function (assert) {
    let tick = 0;
    let recorder = new BoxelExecutionPerformanceRecorder(true, 2, () => tick++);
    for (let index = 1; index <= 3; index++) {
      recorder
        .start({
          operationId: `operation:${index}`,
          occurrenceId: `surface:${index}`,
          stage: 'generation',
        })
        .finish();
    }

    let snapshot = recorder.snapshot();
    assert.strictEqual(snapshot.droppedRecords, 1);
    assert.deepEqual(
      snapshot.records.map(({ operationId, occurrenceId }) => ({
        operationId,
        occurrenceId,
      })),
      [
        { operationId: 'operation:2', occurrenceId: 'surface:2' },
        { operationId: 'operation:3', occurrenceId: 'surface:3' },
      ],
    );
  });

  test('disabled recording is a no-op', function (assert) {
    let calls = 0;
    let recorder = new BoxelExecutionPerformanceRecorder(
      false,
      10,
      () => calls++,
    );
    let token = recorder.start({
      operationId: 'operation:disabled',
      occurrenceId: 'surface:disabled',
      stage: 'request',
    });

    assert.false(token.finish());
    assert.strictEqual(
      calls,
      0,
      'the disabled recorder does not read the clock',
    );
    assert.deepEqual(recorder.snapshot(), {
      droppedRecords: 0,
      records: [],
    });

    recorder.enable();
    recorder
      .start({
        operationId: 'operation:enabled',
        occurrenceId: 'surface:enabled',
        stage: 'request',
      })
      .finish();
    recorder.disable();
    assert.strictEqual(calls, 2, 'explicit activation records one span');
  });

  test('snapshots and counter records cannot mutate recorder state', function (assert) {
    let tick = 0;
    let recorder = new BoxelExecutionPerformanceRecorder(
      true,
      10,
      () => tick++,
    );
    let counters = { passes: 2 };
    recorder
      .start({
        operationId: 'operation:immutable',
        occurrenceId: 'surface:immutable',
        stage: 'projection-settle',
      })
      .finish({ counters });
    counters.passes = 99;
    let first = recorder.snapshot();
    assert.strictEqual(first.records[0]?.counters?.passes, 2);

    first.records[0]!.operationId = 'mutated';
    let second = recorder.snapshot();
    assert.strictEqual(second.records[0]?.operationId, 'operation:immutable');

    recorder.reset();
    assert.deepEqual(recorder.snapshot(), {
      droppedRecords: 0,
      records: [],
    });
  });
});
