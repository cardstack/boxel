import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  RunTelemetryAggregator,
  type RunTelemetryConfig,
} from '../src/run-telemetry.ts';

const CONFIG: RunTelemetryConfig = {
  briefUrl: 'https://realms.example.test/wiki/run-telemetry',
  targetRealmUrl: 'https://realms.example.test/user/rt',
  controlRealmUrl: 'https://realms.example.test/user/rt-control',
  targetPhase: 'hardening',
  factoryCommit: 'abc1234',
  startedAtMs: 1_000_000,
};

function agg() {
  return new RunTelemetryAggregator({ ...CONFIG });
}

module('run-telemetry > aggregator', function () {
  test('a closed inference turn becomes a turn with the preceding usage', function (assert) {
    let a = agg();
    a.consume({
      c: 'inference',
      n: 'usage',
      sumOut: 300,
      sumIn: 40,
      sumCacheRead: 1_500_000,
    });
    a.consume({
      c: 'inference',
      n: 'build',
      t: 1_000_500,
      d: 120_000,
      issue: 'Sticky Note',
      model: 'claude-sonnet-5',
      effort: 'medium',
    });

    let attrs = a.toCardAttributes(2_000_000) as any;
    assert.strictEqual(attrs.turns.length, 1);
    let turn = attrs.turns[0];
    assert.strictEqual(turn.turnType, 'build');
    assert.strictEqual(turn.durationSeconds, 120);
    assert.strictEqual(turn.outputTokens, 300);
    assert.strictEqual(turn.freshInputTokens, 40);
    assert.strictEqual(turn.cacheReadTokens, 1_500_000);
    assert.strictEqual(attrs.totals.inferenceSeconds, 120);
    assert.strictEqual(attrs.totals.cacheReadTokens, 1_500_000);
  });

  test('turn-start with no matching close renders as a live turn (no duration)', function (assert) {
    let a = agg();
    a.consume({
      c: 'inference',
      n: 'turn-start',
      t: 1_500_000,
      turnType: 'design',
      issue: 'Design foundation',
      model: 'inherit',
      effort: 'inherit',
    });

    let attrs = a.toCardAttributes(1_560_000) as any;
    assert.strictEqual(attrs.turns.length, 1, 'the live turn shows');
    assert.strictEqual(attrs.turns[0].turnType, 'design');
    assert.strictEqual(
      attrs.turns[0].durationSeconds,
      undefined,
      'live turn carries no duration',
    );
    assert.strictEqual(attrs.config.outcome, 'running');
    assert.strictEqual(attrs.config.endedAt, null);
    // Wall clock ticks from startedAt while running.
    assert.strictEqual(attrs.totals.wallClockSeconds, 560);
  });

  test('a live turn is superseded by its closing span', function (assert) {
    let a = agg();
    a.consume({
      c: 'inference',
      n: 'turn-start',
      t: 1_500_000,
      turnType: 'design',
    });
    a.consume({
      c: 'inference',
      n: 'build',
      t: 1_600_000,
      d: 60_000,
      issue: 'X',
    });
    // The design live turn is still open (build closed, not design).
    let attrs = a.toCardAttributes(1_700_000) as any;
    let live = attrs.turns.filter((t: any) => t.durationSeconds === undefined);
    assert.strictEqual(live.length, 1, 'design still live');

    a.consume({
      c: 'inference',
      n: 'design',
      t: 1_500_000,
      d: 90_000,
      issue: 'X',
    });
    let after = a.toCardAttributes(1_700_000) as any;
    assert.strictEqual(
      after.turns.filter((t: any) => t.durationSeconds === undefined).length,
      0,
      'no live turn once design closes',
    );
  });

  test('machinery spans and a compaction event aggregate', function (assert) {
    let a = agg();
    a.consume({ c: 'validation', n: 'pipeline', t: 1, d: 33_000 });
    a.consume({ c: 'render-gate', n: 'capture', t: 1, d: 31_000 });
    a.consume({ c: 'sync', n: 'workspace', t: 1, d: 500 });
    a.consume({ c: 'sync', n: 'workspace', t: 1, d: 500 });
    a.consume({ c: 'startup', n: 'load-brief', t: 1, d: 2_000 });
    a.consume({ c: 'inference', n: 'sdk-compact_boundary', t: 42 });

    let attrs = a.toCardAttributes() as any;
    assert.strictEqual(attrs.totals.validationSeconds, 33);
    assert.strictEqual(attrs.totals.renderGateSeconds, 31);
    assert.strictEqual(attrs.totals.syncSeconds, 1);
    assert.strictEqual(attrs.totals.syncCallCount, 2);
    assert.strictEqual(attrs.totals.startupSeconds, 2);
    assert.strictEqual(attrs.events.length, 1);
    assert.strictEqual(attrs.events[0].kind, 'compaction');
  });

  test('markFinished stamps the outcome, endedAt, and freezes wall clock', function (assert) {
    let a = agg();
    a.consume({ c: 'run', n: 'issue-loop', t: 1_000_000, d: 2_100_000 });
    a.markFinished('all_issues_done', 3_200_000);
    let attrs = a.toCardAttributes(9_999_999) as any;
    assert.strictEqual(attrs.config.outcome, 'all_issues_done');
    assert.strictEqual(
      attrs.totals.wallClockSeconds,
      2100,
      'uses the run span, not now',
    );
    assert.notStrictEqual(attrs.config.endedAt, null);
  });

  test('turns of the same issue collapse into one issue summary with iteration count', function (assert) {
    let a = agg();
    a.consume({ c: 'inference', n: 'design', t: 1, d: 1000, issue: 'RT-1' });
    a.consume({ c: 'inference', n: 'build', t: 2, d: 1000, issue: 'RT-1' });
    a.consume({ c: 'inference', n: 'fix', t: 3, d: 1000, issue: 'RT-1' });
    let attrs = a.toCardAttributes() as any;
    assert.strictEqual(attrs.issues.length, 1);
    assert.strictEqual(attrs.issues[0].iterationCount, 3);
  });
});
