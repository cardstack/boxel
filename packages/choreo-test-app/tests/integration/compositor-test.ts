/**
 * The C1 composition host (docs/choreo-composition.md, Phase C1) — the
 * contract, proven with synthetic actors and a fake run so nothing here
 * depends on a template. The host owns the composition clock, a semantic
 * action bus, timed cues folded through `t`, parameter automation, and
 * `renderAt` as one transaction. Cues are semantic commands, not
 * callbacks: seeking past one includes its state, seeking before it
 * excludes it, and repeated seeks are idempotent.
 */
import { module, test } from 'qunit';
import type { CompositorRun } from 'test-app/lib/compositor';
import { createCompositor } from 'test-app/lib/compositor';

/** A run that records the transport ops the host performs on it. */
class FakeRun implements CompositorRun {
  duration = 15;
  time = 0;
  speed = 1;
  log: string[] = [];
  play() {
    this.log.push('play');
  }
  pause() {
    this.log.push('pause');
  }
}

module('Integration | compositor host', function () {
  test('cues fold through t: forward applies, backward resets and replays', async function (assert) {
    const log: string[] = [];
    const run = new FakeRun();
    const compositor = createCompositor({
      automations: [],
      cues: [
        { action: 'photo.open', at: 0.55, payload: 3, target: 'lightbox' },
        { action: 'compose', at: 4.35, target: 'inbox' },
      ],
      duration: 15,
      runs: () => [run],
    });
    compositor.register('lightbox', {
      actions: {
        'photo.open': (i) => {
          log.push(`open:${String(i)}`);
        },
      },
      reset: () => {
        log.push('lightbox-reset');
      },
    });
    compositor.register('inbox', {
      actions: {
        compose: () => {
          log.push('compose');
        },
      },
      reset: () => {
        log.push('inbox-reset');
      },
    });

    // forward: each cue applies once, in order, as t crosses it
    await compositor.renderAt(0.2);
    assert.deepEqual(log, [], 'nothing before the first cue');
    await compositor.renderAt(1);
    assert.deepEqual(log, ['open:3'], 'the first cue applied');
    await compositor.renderAt(8);
    assert.deepEqual(log, ['open:3', 'compose'], 'the second joined it');

    // repeated: the same t adds nothing
    await compositor.renderAt(8);
    assert.deepEqual(log, ['open:3', 'compose'], 'idempotent at the same t');

    // backward across one cue: reset, then replay only the earlier prefix
    log.length = 0;
    await compositor.renderAt(1);
    assert.deepEqual(
      log,
      ['lightbox-reset', 'inbox-reset', 'open:3'],
      'a backward seek resets and folds the remaining prefix'
    );

    // backward before everything: reset only
    log.length = 0;
    await compositor.renderAt(0.1);
    assert.deepEqual(
      log,
      ['lightbox-reset', 'inbox-reset'],
      'before the first cue the fold is empty'
    );
  });

  test('parameters sample continuously and gate on from', async function (assert) {
    const values: Record<string, number[]> = { progress: [], time: [] };
    const run = new FakeRun();
    const compositor = createCompositor({
      automations: [
        { name: 'time', sample: (t) => t, target: 'demo' },
        {
          from: 7.3,
          name: 'progress',
          sample: (t) => Math.max(0, t - 7.3),
          target: 'demo',
        },
      ],
      cues: [],
      duration: 15,
      runs: () => [run],
    });
    compositor.register('demo', {
      parameters: {
        progress: (v) => values.progress!.push(v),
        time: (v) => values.time!.push(v),
      },
    });

    await compositor.renderAt(2);
    assert.deepEqual(values.time, [2], 'an ungated parameter samples at t');
    assert.deepEqual(values.progress, [], 'a gated parameter waits for from');
    await compositor.renderAt(9);
    assert.strictEqual(values.progress!.length, 1, 'past from, it samples');
    assert.true(
      Math.abs(values.progress![0]! - 1.7) < 1e-9,
      `sampled at t - from (${String(values.progress![0])})`
    );
  });

  test('renderAt is a transaction: runs are paused and seeked around the fold', async function (assert) {
    const run = new FakeRun();
    const compositor = createCompositor({
      automations: [],
      cues: [],
      duration: 15,
      runs: () => [run],
    });
    await compositor.renderAt(8.9);
    assert.strictEqual(run.time, 8.9, 'the run stands at the requested still');
    assert.true(run.log.includes('pause'), 'the transport paused it');
  });

  test('send dispatches immediately and the snapshot records the composition', async function (assert) {
    const log: string[] = [];
    const run = new FakeRun();
    const compositor = createCompositor({
      automations: [],
      cues: [{ action: 'compose', at: 4.35, target: 'inbox' }],
      duration: 15,
      runs: () => [run],
    });
    compositor.register('inbox', {
      actions: {
        compose: () => {
          log.push('compose');
        },
      },
    });
    compositor.send({ action: 'compose', target: 'inbox' });
    assert.deepEqual(log, ['compose'], 'send goes straight through the port');

    await compositor.renderAt(5);
    const snap = compositor.snapshot;
    assert.strictEqual(snap.duration, 15, 'snapshot: duration');
    assert.strictEqual(snap.time, 5, 'snapshot: time');
    assert.deepEqual(snap.actors, ['inbox'], 'snapshot: registered actors');
    assert.strictEqual(snap.appliedCues.length, 1, 'snapshot: folded cues');
    assert.strictEqual(
      snap.recentActions.at(-1)?.action,
      'compose',
      'snapshot: the sent action is on the record'
    );
  });

  test('an unknown target or action is a loud error, not a silent no-op', async function (assert) {
    const run = new FakeRun();
    const compositor = createCompositor({
      automations: [],
      cues: [],
      duration: 15,
      runs: () => [run],
    });
    assert.throws(
      () => compositor.send({ action: 'compose', target: 'nobody' }),
      /nobody/,
      'a missing actor names itself'
    );
    compositor.register('inbox', { actions: {} });
    assert.throws(
      () => compositor.send({ action: 'vanish', target: 'inbox' }),
      /vanish/,
      'a missing action names itself'
    );
  });
});
