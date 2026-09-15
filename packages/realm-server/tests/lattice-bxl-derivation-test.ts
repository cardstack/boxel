import QUnit from 'qunit';
import { bxl } from '@cardstack/bxl';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import type { LatticeBxlManifest } from '../lib/lattice-bxl-derivation.ts';
import { LatticeWorkSuperseded } from '@cardstack/runtime-common/lattice-work';

const { module, test } = QUnit;

const manifest: LatticeBxlManifest = {
  version: 1,
  definition: {
    module: 'https://example.com/bat-tally',
    name: 'BatTally',
    revision: 'v1',
  },
  field: 'total',
  expression: '[.rows[]? | .score // 0] | add // 0',
  input: { object: { rows: { array: { object: { score: 'number' } } } } },
  output: 'number',
};

module('Lattice | BXL data-only worker', function (hooks) {
  let worker: LatticeBxlWorker;
  hooks.beforeEach(function () {
    worker = new LatticeBxlWorker();
  });
  hooks.afterEach(async function () {
    await worker.close();
  });

  function input(json: object, revision = 'input-1') {
    return {
      id: 'https://example.com/BatTally/one',
      revision,
      json: JSON.stringify(json),
    };
  }

  test('matches computeVia sum semantics for admitted inputs', async function (assert) {
    const cases = [
      {},
      { rows: null },
      { rows: [] },
      { rows: [null, {}, { score: null }] },
      { rows: [{ score: 8 }, { score: 4.5 }, { score: 0 }, { score: -1 }] },
    ];
    const compute = bxl(manifest.expression, {
      libraries: ['core'],
      readableSyntax: false,
    });
    const result = await worker.evaluate(
      manifest,
      cases.map((value) => input(value)),
    );
    cases.forEach((value, i) => {
      // Sum normalized score values using the equivalent JavaScript computation.
      const original = (value.rows ?? [])
        .filter(Boolean)
        .reduce((sum: number, row) => sum + (Number(row?.score) || 0), 0);
      assert.strictEqual(result.artifacts[i].value, original);
      assert.strictEqual(result.artifacts[i].value, compute.call(value));
    });
  });

  test('edits and module changes produce revised artifacts without cached values', async function (assert) {
    const [first, second, third] = [
      await worker.evaluate(manifest, [input({ rows: [{ score: 6 }] })]),
      await worker.evaluate(manifest, [
        input({ rows: [{ score: 7 }] }, 'input-2'),
      ]),
      await worker.evaluate(
        {
          ...manifest,
          definition: { ...manifest.definition, revision: 'v2' },
          expression: '([.rows[]? | .score // 0] | add // 0) * 2',
        },
        [input({ rows: [{ score: 7 }] }, 'input-2')],
      ),
    ];
    assert.deepEqual(
      [first, second, third].map((r) => r.artifacts[0].value),
      [6, 7, 14],
    );
    assert.strictEqual(second.artifacts[0].inputRevision, 'input-2');
    assert.strictEqual(third.artifacts[0].definitionRevision, 'v2');
  });

  test('unsupported coercions and multi-output programs fail without an artifact', async function (assert) {
    await assert.rejects(
      worker.evaluate(manifest, [input({ rows: [{ score: '8' }] })]),
      /shape mismatch/,
    );
    await assert.rejects(
      worker.evaluate({ ...manifest, expression: '1, 2' }, [input({})]),
      /output/i,
    );
    await assert.rejects(
      worker.evaluate({ ...manifest, expression: '"wrong type"' }, [input({})]),
      /shape mismatch/,
    );
    await assert.rejects(
      worker.evaluate(manifest, [input({ unexpected: 4 })]),
      /Unadmitted/,
    );
  });

  test('derive validation rejects volatile programs and worker remains recoverable', async function (assert) {
    await assert.rejects(
      worker.evaluate({ ...manifest, expression: 'now' }, [input({})]),
      /derive-call-banned/,
    );
    const result = await worker.evaluate(manifest, [
      input({ rows: [{ score: 9 }] }),
    ]);
    assert.strictEqual(result.artifacts[0].value, 9);
  });

  test('hard deadline abandons work and the next call starts a usable worker', async function (assert) {
    await assert.rejects(worker.evaluate(manifest, [input({})], 1), /deadline/);
    const result = await worker.evaluate(manifest, [input({})]);
    assert.strictEqual(result.artifacts[0].value, 0);
  });

  test('superseded work is rejected before dispatch and does not occupy the worker', async function (assert) {
    const controller = new AbortController();
    const reason = new LatticeWorkSuperseded('newer input');
    controller.abort(reason);
    await assert.rejects(
      worker.evaluate(manifest, [input({})], undefined, controller.signal),
      (error: unknown) => error === reason,
    );
    assert.strictEqual(
      (await worker.evaluate(manifest, [input({})])).artifacts[0].value,
      0,
    );
  });

  test('cancellation stops the active worker before releasing its slot', async function (assert) {
    await worker.evaluate(manifest, [input({})]);
    const controller = new AbortController();
    const reason = new LatticeWorkSuperseded('newer input');
    const running = worker.evaluate(
      manifest,
      Array.from({ length: 512 }, () => input({ rows: [{ score: 3 }] })),
      undefined,
      controller.signal,
    );
    controller.abort(reason);
    await assert.rejects(running, (error: unknown) => error === reason);
    const fresh = await worker.evaluate(manifest, [
      input({ rows: [{ score: 7 }] }, 'newer'),
    ]);
    assert.strictEqual(fresh.artifacts[0].value, 7);
    assert.strictEqual(fresh.artifacts[0].inputRevision, 'newer');
  });

  test('a completed attempt cannot cancel the next use of its worker', async function (assert) {
    const old = new AbortController();
    await worker.evaluate(manifest, [input({})], undefined, old.signal);
    const current = worker.evaluate(manifest, [
      input({ rows: [{ score: 4 }] }),
    ]);
    old.abort(new LatticeWorkSuperseded('late notification'));
    assert.strictEqual((await current).artifacts[0].value, 4);
  });

  test('input batch is bounded before it is copied into the worker', async function (assert) {
    await assert.rejects(
      worker.evaluate(
        manifest,
        Array.from({ length: 513 }, () => input({})),
      ),
      /512/,
    );
    await assert.rejects(
      worker.evaluate(manifest, [input({ rows: 'x'.repeat(16 * 1_048_576) })]),
      /16 MiB/,
    );
  });

  test('a JSON view may exceed the scalar output limit but still has a hard byte bound', async function (assert) {
    const jsonManifest: LatticeBxlManifest = {
      ...manifest,
      expression: '.value',
      input: { object: { value: 'json' } },
      output: 'json',
    };
    // The JSON bound is 8 MiB (sized for the Nucleus day owner); a value just
    // under it publishes, doubling it does not.
    const value = {
      text: 'x'.repeat(4_500_000),
      rows: [{ name: 'Avery', count: 7 }],
    };
    const result = await worker.evaluate(jsonManifest, [input({ value })]);
    assert.deepEqual(result.artifacts[0].value, value);
    await assert.rejects(
      worker.evaluate(
        { ...jsonManifest, expression: '{text: (.value.text + .value.text)}' },
        [input({ value })],
      ),
      /byte|limit/i,
    );
    const recovered = await worker.evaluate(jsonManifest, [
      input({ value: { recovered: true } }),
    ]);
    assert.deepEqual(recovered.artifacts[0].value, { recovered: true });
  });

  test('an explicit BXL minute bucket stays equal until its boundary', async function (assert) {
    const result = await worker.evaluate(
      {
        ...manifest,
        field: 'minute',
        expression: '.timestamp / 60000 | floor',
        input: { object: { timestamp: 'number' } },
      },
      [60000, 60001, 119999, 120000].map((timestamp) => input({ timestamp })),
    );
    assert.deepEqual(
      result.artifacts.map((artifact) => artifact.value),
      [1, 1, 1, 2],
    );
  });
});
