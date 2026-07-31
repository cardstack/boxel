import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  RunTelemetryAggregator,
  type RunTelemetryConfig,
} from '../src/run-telemetry.ts';

const CONFIG: RunTelemetryConfig = {
  runTitle: 'run-telemetry',
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

  test('machinery is attributed to the ticket whose turn triggered it', function (assert) {
    let a = agg();
    // BOOT-1 runs, then its validation + sync.
    a.consume({
      c: 'inference',
      n: 'bootstrap',
      t: 1,
      d: 60_000,
      issue: 'Process brief',
      issueId: 'BOOT-1',
    });
    a.consume({
      c: 'validation',
      n: 'pipeline',
      t: 2,
      d: 4_000,
      passed: true,
      steps: 5,
    });
    a.consume({ c: 'sync', n: 'workspace', t: 3, d: 1_000 });
    // SN-1 runs, then its own validation (failing), render gate, sync.
    a.consume({
      c: 'inference',
      n: 'build',
      t: 4,
      d: 90_000,
      issue: 'Implement Sticky Note card',
      issueId: 'SN-1',
    });
    a.consume({
      c: 'validation',
      n: 'pipeline',
      t: 5,
      d: 6_000,
      passed: false,
      steps: 5,
    });
    a.consume({ c: 'render-gate', n: 'capture', t: 6, d: 42_000 });
    a.consume({ c: 'sync', n: 'workspace', t: 7, d: 2_000 });

    let attrs = a.toCardAttributes() as any;
    let [boot, sn] = attrs.issues;
    assert.strictEqual(boot.issueId, 'BOOT-1');
    assert.strictEqual(boot.validationSeconds, 4);
    assert.strictEqual(boot.validationStepsRun, 5);
    assert.true(boot.validationPassed);
    assert.strictEqual(boot.renderGateSeconds, 0, 'no gate ran for bootstrap');
    assert.strictEqual(boot.syncSeconds, 1);
    assert.strictEqual(boot.syncCallCount, 1);

    assert.strictEqual(sn.issueId, 'SN-1');
    assert.strictEqual(sn.validationSeconds, 6);
    assert.false(sn.validationPassed, 'the failing pipeline is its verdict');
    assert.strictEqual(sn.renderGateSeconds, 42);
    assert.strictEqual(sn.syncSeconds, 2);

    // Run-level totals still cover every span, attributed or not.
    assert.strictEqual(attrs.totals.validationSeconds, 10);
    assert.strictEqual(attrs.totals.renderGateSeconds, 42);
    assert.strictEqual(attrs.totals.syncSeconds, 3);
  });

  test('machinery before the first turn stays run-level only', function (assert) {
    let a = agg();
    a.consume({ c: 'sync', n: 'workspace', t: 1, d: 5_000 });
    a.consume({
      c: 'inference',
      n: 'bootstrap',
      t: 2,
      d: 1_000,
      issue: 'Process brief',
      issueId: 'BOOT-1',
    });
    let attrs = a.toCardAttributes() as any;
    assert.strictEqual(attrs.totals.syncSeconds, 5);
    assert.strictEqual(
      attrs.issues[0].syncSeconds,
      0,
      'the pre-turn pull is nobody’s ticket',
    );
  });

  test('a ticket with no validation pipeline does not report a pass', function (assert) {
    let a = agg();
    a.consume({
      c: 'inference',
      n: 'design-foundation',
      t: 1,
      d: 1_000,
      issue: 'Establish the design language',
      issueId: 'DESIGN-0',
    });
    let attrs = a.toCardAttributes() as any;
    assert.strictEqual(attrs.issues[0].validationStepsRun, 0);
    assert.false(attrs.issues[0].validationPassed);
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
    assert.strictEqual(attrs.config.outcome, 'completed');
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

  test('a turn carries the board key its span was tagged with', function (assert) {
    let a = agg();
    a.consume({
      c: 'inference',
      n: 'turn-start',
      t: 1_500_000,
      turnType: 'build',
      issue: 'Implement Sticky Note card',
      issueId: 'SN-1',
    });
    let live = a.toCardAttributes(1_500_500) as any;
    assert.strictEqual(
      live.turns[0].issueId,
      'SN-1',
      'the live turn is attributed too',
    );

    a.consume({
      c: 'inference',
      n: 'build',
      t: 1_500_000,
      d: 60_000,
      issue: 'Implement Sticky Note card',
      issueId: 'SN-1',
    });
    let attrs = a.toCardAttributes(1_600_000) as any;
    assert.strictEqual(attrs.turns[0].issueId, 'SN-1');
    assert.strictEqual(attrs.turns[0].issueTitle, 'Implement Sticky Note card');
  });

  test('issue summaries key by board key, so each ticket gets its own row', function (assert) {
    let a = agg();
    a.consume({
      c: 'inference',
      n: 'bootstrap',
      t: 1,
      d: 1000,
      issue: 'Process brief and create project artifacts',
      issueId: 'BOOT-1',
    });
    a.consume({
      c: 'inference',
      n: 'design-foundation',
      t: 2,
      d: 1000,
      issue: 'Establish the design language',
      issueId: 'DESIGN-0',
    });
    a.consume({
      c: 'inference',
      n: 'build',
      t: 3,
      d: 1000,
      issue: 'Implement Sticky Note card',
      issueId: 'SN-1',
    });
    // Untagged turns (the shared-context prime turn) fall back to the title.
    a.consume({
      c: 'inference',
      n: 'prime',
      t: 4,
      d: 1000,
      issue: 'shared design context',
    });

    let attrs = a.toCardAttributes() as any;
    assert.deepEqual(
      attrs.issues.map((i: any) => i.issueId),
      ['BOOT-1', 'DESIGN-0', 'SN-1', 'shared design context'],
      'summary ids match the keys the card groups turns by',
    );
    assert.deepEqual(
      attrs.issues.map((i: any) => i.iterationCount),
      [1, 1, 1, 1],
      'distinct tickets never merge',
    );
  });

  test('loop outcomes translate to the card vocabulary', function (assert) {
    let outcomeFor = (loopOutcome: string) => {
      let a = agg();
      a.markFinished(loopOutcome, 3_200_000);
      return (a.toCardAttributes() as any).config.outcome;
    };
    assert.strictEqual(outcomeFor('all_issues_done'), 'completed');
    assert.strictEqual(outcomeFor('no_unblocked_issues'), 'stopped');
    assert.strictEqual(outcomeFor('max_outer_cycles'), 'stopped');
    assert.strictEqual(outcomeFor('failed'), 'failed', 'passes its own words');
    assert.strictEqual(outcomeFor('something-new'), 'stopped', 'safe default');
  });

  test('the first settled outcome wins over a later cleanup call', function (assert) {
    let a = agg();
    a.markFinished('all_issues_done', 3_200_000);
    // The wiring's `finally` reports a generic stop on every exit path.
    a.markFinished('stopped', 3_300_000);
    let attrs = a.toCardAttributes() as any;
    assert.strictEqual(attrs.config.outcome, 'completed');
    assert.strictEqual(
      attrs.config.endedAt,
      new Date(3_200_000).toISOString(),
      'endedAt stays at the real finish',
    );
  });

  test('board snapshots give every ticket a status, started or not', function (assert) {
    let a = agg();
    let board = (issueId: string, status: string, title: string) =>
      a.consume({ c: 'scheduler', n: 'board', issueId, status, issue: title });
    board('BOOT-1', 'done', 'Process brief');
    board('SN-1', 'in_progress', 'Implement Sticky Note card');
    board('SN-2', 'backlog', 'Sticky Note — second pass polish');
    board('SN-3', 'blocked', 'Blocked on SN-1');
    a.consume({
      c: 'inference',
      n: 'bootstrap',
      t: 1,
      d: 1_000,
      issue: 'Process brief',
      issueId: 'BOOT-1',
    });

    let attrs = a.toCardAttributes() as any;
    assert.deepEqual(
      attrs.issues.map((i: any) => [i.issueId, i.status]),
      [['BOOT-1', 'done']],
      'only tickets with turns are issue rows',
    );
    assert.deepEqual(
      attrs.board.map((b: any) => [b.issueId, b.status, b.started]),
      [
        ['BOOT-1', 'done', true],
        ['SN-1', 'in_progress', false],
        ['SN-2', 'backlog', false],
        ['SN-3', 'blocked', false],
      ],
      'the board carries never-started tickets too',
    );
  });

  test('a turn in flight reports running even while the board lags', function (assert) {
    let a = agg();
    // The index still says backlog — it lags the loop by seconds.
    a.consume({
      c: 'scheduler',
      n: 'board',
      issueId: 'SN-1',
      status: 'backlog',
      issue: 'Implement Sticky Note card',
    });
    a.consume({
      c: 'inference',
      n: 'turn-start',
      t: 1_000_000,
      turnType: 'build',
      issue: 'Implement Sticky Note card',
      issueId: 'SN-1',
    });
    let attrs = a.toCardAttributes(1_000_500) as any;
    assert.strictEqual(attrs.issues[0].status, 'running');
  });

  test('a settled ticket keeps running status while a later turn is live', function (assert) {
    let a = agg();
    a.consume({
      c: 'inference',
      n: 'design',
      t: 1,
      d: 1_000,
      issue: 'Implement Sticky Note card',
      issueId: 'SN-1',
    });
    a.consume({
      c: 'inference',
      n: 'turn-start',
      t: 2_000,
      turnType: 'build',
      issue: 'Implement Sticky Note card',
      issueId: 'SN-1',
    });
    let attrs = a.toCardAttributes(3_000) as any;
    assert.strictEqual(
      attrs.issues[0].status,
      'running',
      'the live turn wins even though the first turn settled',
    );
  });

  test('board snapshots stay out of the timeline event ticks', function (assert) {
    let a = agg();
    a.consume({
      c: 'scheduler',
      n: 'board',
      issueId: 'SN-1',
      status: 'backlog',
      issue: 'x',
    });
    a.consume({ c: 'scheduler', n: 'load-issues', t: 5, count: 3 });
    let attrs = a.toCardAttributes() as any;
    assert.strictEqual(attrs.events.length, 1);
    assert.strictEqual(attrs.events[0].kind, 'load-issues');
  });

  test('skills in context are grouped per phase, ordered by weight', function (assert) {
    let a = agg();
    // Bootstrap turn: two skills, the smaller one second in the row order.
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'bootstrap',
      skill: 'boxel',
      chars: 40_000,
      refs: 6,
    });
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'bootstrap',
      skill: 'software-factory-bootstrap',
      chars: 5_000,
    });
    // The same skill on two implementation turns is one row, two turns.
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'design',
      skill: 'boxel-design',
      chars: 9_000,
    });
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'build',
      skill: 'boxel',
      chars: 30_000,
      refs: 4,
    });
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'fix',
      skill: 'boxel',
      chars: 42_000,
      refs: 7,
    });

    let attrs = a.toCardAttributes() as any;
    assert.deepEqual(
      attrs.skills.map((s: any) => [s.phase, s.name, s.turnCount]),
      [
        ['bootstrap', 'boxel', 1],
        ['bootstrap', 'software-factory-bootstrap', 1],
        ['design', 'boxel-design', 1],
        ['implementation', 'boxel', 2],
      ],
      'one row per skill per phase, phases in lifecycle order',
    );
    let implBoxel = attrs.skills[3];
    assert.strictEqual(
      implBoxel.turnTypes,
      'build, fix',
      'names every turn type that carried it',
    );
    assert.strictEqual(
      implBoxel.characters,
      42_000,
      'characters is the peak, not the sum of re-sends',
    );
    assert.strictEqual(implBoxel.referenceCount, 7);
  });

  test('skill rows record whether the turn loaded or inherited them', function (assert) {
    let a = agg();
    // Fresh session: the design turn pays to send it.
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'design',
      skill: 'boxel-design',
      chars: 900,
    });
    // Forked session: the build turn inherits its prefix.
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'build',
      skill: 'boxel',
      chars: 900,
      resumed: true,
    });
    // Same skill, same phase, both ways.
    a.consume({
      c: 'skills',
      n: 'in-context',
      turnType: 'fix',
      skill: 'boxel',
      chars: 900,
    });

    let attrs = a.toCardAttributes() as any;
    let deliveryOf = (name: string) =>
      attrs.skills.find((s: any) => s.name === name)?.delivery;
    assert.strictEqual(deliveryOf('boxel-design'), 'injected');
    assert.strictEqual(deliveryOf('boxel'), 'mixed');
  });

  test('a skill event with no skill name is ignored', function (assert) {
    let a = agg();
    a.consume({ c: 'skills', n: 'in-context', turnType: 'build', chars: 10 });
    a.consume({ c: 'skills', n: 'load', skills: 'boxel,boxel-design' });
    let attrs = a.toCardAttributes() as any;
    assert.strictEqual(attrs.skills.length, 0);
  });

  test('the card title comes from cardInfo.name', function (assert) {
    let attrs = agg().toCardAttributes() as any;
    assert.strictEqual(attrs.cardInfo.name, 'Run telemetry — run-telemetry');
    assert.strictEqual(attrs.title, undefined, 'no dead top-level title');
  });
});
