import QUnit from 'qunit';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  configureLatticeTrace,
  startLatticeTrace,
} from '@cardstack/runtime-common/lattice-trace';
const { module, test } = QUnit;
module(basename(import.meta.filename), function (hooks) {
  hooks.afterEach(() => configureLatticeTrace());
  test('disabled diagnostics do not instantiate traces or evaluate payloads', (assert) => {
    configureLatticeTrace();
    let touched = false;
    const trace = startLatticeTrace('off', 'owner');
    trace?.event('payload', { value: (touched = true) });
    assert.strictEqual(trace, undefined);
    assert.false(touched);
  });
  test('sequential spans, nested spans and terminal outcomes stay distinct', async (assert) => {
    const events: Record<string, any>[] = [];
    configureLatticeTrace({
      identity: 'test',
      hash: (s) => createHash('sha256').update(s).digest('hex'),
      write: (e) => events.push(e),
    });
    const trace = startLatticeTrace('one', 'owner')!;
    trace.stage('read');
    assert.strictEqual(await trace.measure('sql', async () => 42), 42);
    trace.stage('compute');
    trace.entries(
      'receipts',
      Array.from({ length: 130 }, (_, i) => i),
    );
    trace.finish('published');
    trace.finish('rejected');
    trace.stage('late');
    assert.deepEqual(
      events.filter((e) => e.scope === 'sequential').map((e) => e.phase),
      ['read', 'compute'],
    );
    assert.deepEqual(
      events.filter((e) => e.scope === 'nested').map((e) => e.phase),
      ['sql'],
    );
    assert.deepEqual(
      events.filter((e) => e.event === 'receipts').map((e) => e.items.length),
      [64, 64, 2],
    );
    assert.strictEqual(events.filter((e) => e.event === 'finish').length, 1);
    assert.strictEqual(events.at(-1)?.outcome, 'published');
  });
  test('diagnostic failures do not alter results or replace computation errors', async (assert) => {
    configureLatticeTrace({
      identity: 'broken',
      hash: () => {
        throw new Error('hash');
      },
      write: () => {
        throw new Error('sink');
      },
    });
    const trace = startLatticeTrace('one', 'owner')!;
    assert.strictEqual(trace.hash('private data'), undefined);
    assert.strictEqual(await trace.measure('work', async () => 7), 7);
    const failure = new Error('computation');
    await assert.rejects(
      trace.measure('work', async () => {
        throw failure;
      }),
      (error: Error) => error === failure,
    );
    trace.finish('error');
  });
});
