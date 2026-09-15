import QUnit from 'qunit';
import { basename } from 'node:path';
import { bxl, getBxlComputeDefinition } from '@cardstack/bxl';
import type { Definition } from '@cardstack/runtime-common/definitions';
import { rri } from '@cardstack/runtime-common/realm-identifiers';
import { serialize as serializeNumber } from '@cardstack/runtime-common/serializers/number';
import { LatticeBxlWorker } from '../lib/lattice-bxl-derivation.ts';
import {
  makeLatticeCardComputePlan,
  makeLatticeCardPrerequisitePlan,
} from '../lib/lattice-card-compute.ts';
import type { LatticeCardComputePlan } from '../lib/lattice-card-compute.ts';

const { module, test } = QUnit;
const expression = '[.rows[]? | .score // 0] | add // 0';
const program = (source: string) =>
  getBxlComputeDefinition(
    bxl(source, { libraries: ['core'], readableSyntax: false }),
  )!;
const primitive = {
  type: 'contains' as const,
  isPrimitive: true,
  isComputed: true,
  fieldOrCard: { module: rri('@cardstack/base/card-api'), name: 'NumberField' },
};
function definition(): Definition {
  return {
    type: 'card-def',
    displayName: 'Tally',
    codeRef: { module: rri('https://example.com/tally'), name: 'Tally' },
    fields: {
      doubled: 'double',
      total: 'sum',
      cardTitle: 'title',
      cardDescription: 'description',
      cardTheme: 'theme',
      cardThumbnailURL: 'thumbnail',
    },
    fieldDefs: {
      double: { ...primitive, bxl: program('.total * 2') },
      sum: { ...primitive, bxl: program(expression) },
      title: { ...primitive, baseCompute: 'cardTitle' },
      description: { ...primitive, baseCompute: 'cardDescription' },
      theme: { ...primitive, baseCompute: 'cardTheme' },
      thumbnail: { ...primitive, baseCompute: 'cardThumbnailURL' },
    },
  };
}
const shape: LatticeCardComputePlan['input'] = {
  object: {
    rows: { array: { object: { score: 'number' } } },
    studentName: 'string',
    tallyDate: 'string',
    cardInfo: {
      object: {
        name: 'string',
        summary: 'string',
        theme: { object: { id: 'string' } },
        cardThumbnailURL: 'string',
        cardThumbnail: { object: { url: 'string' } },
      },
    },
  },
};
const outputs = {
  doubled: 'number',
  total: 'number',
  cardTitle: 'string',
  cardDescription: 'string',
  cardTheme: { object: { id: 'string' } },
  cardThumbnailURL: 'string',
} as const;
function input(value: object, revision = 'input-1') {
  return {
    id: 'https://example.com/Tally/one',
    revision,
    json: JSON.stringify(value),
  };
}

module(basename(import.meta.filename), function (hooks) {
  let worker: LatticeBxlWorker;
  hooks.beforeEach(function () {
    worker = new LatticeBxlWorker();
  });
  hooks.afterEach(async function () {
    await worker.close();
  });

  test('evaluates BXL dependencies and trusted base computations in one job', async function (assert) {
    const plan = makeLatticeCardComputePlan(
      definition(),
      'module-1',
      shape,
      outputs,
    );
    const theme = { id: 'https://example.com/Theme/one' };
    const result = await worker.evaluateCard(plan, [
      {
        ...input({
          rows: [{ score: 8 }, { score: 3 }],
          cardInfo: {
            name: ' Avery ',
            summary: 'Notes',
            theme,
            cardThumbnailURL: 'authored.png',
          },
        }),
        thumbnailURL: 'fallback.png',
      },
    ]);
    assert.deepEqual(result.artifacts[0], {
      id: 'https://example.com/Tally/one',
      inputRevision: 'input-1',
      definitionRevision: 'module-1',
      values: {
        total: 11,
        doubled: 22,
        cardTitle: ' Avery ',
        cardDescription: 'Notes',
        cardTheme: theme,
        cardThumbnailURL: 'authored.png',
      },
    });
    assert.strictEqual(
      serializeNumber(result.artifacts[0].values.total as number),
      11,
    );
  });

  test('a clock-reading field carries its time grain and the clock never reaches the output', async function (assert) {
    // The engine supplies `.__clock` as data; the field declares when its
    // value next changes. The worker returns the raw grain per field; the
    // caller stores the earliest.
    const grained = getBxlComputeDefinition(
      bxl(
        '(.tallyDate | split("-") | map(tonumber)) as [$y,$m,$d] | (.__clock.today | split("-") | map(tonumber)) as [$ty,$tm,$td] | if [$ty,$tm,$td] >= [$y,$m,$d] then "past" else "future" end',
        {
          libraries: ['core'],
          readableSyntax: false,
          validUntil:
            'if (.__clock.today < .tallyDate) then .tallyDate else null end',
        },
      ),
    )!;
    assert.deepEqual(
      grained.deps.sort(),
      ['__clock', 'tallyDate'],
      'the grain program roots join the dependencies',
    );
    const def = definition();
    def.fields.phase = 'phase';
    def.fieldDefs.phase = { ...primitive, bxl: grained };
    const plan = makeLatticeCardComputePlan(
      def,
      'module-clock',
      {
        object: {
          ...shape.object,
          __clock: { object: { today: 'string', now: 'string' } },
        },
      },
      { ...outputs, phase: 'string' },
    );
    const result = await worker.evaluateCard(plan, [
      input({
        rows: [],
        tallyDate: '2026-12-31',
        cardInfo: { name: 'x' },
        __clock: { today: '2026-09-15', now: '2026-09-15T05:00:00.000Z' },
      }),
    ]);
    assert.strictEqual(result.artifacts[0].values.phase, 'future');
    assert.deepEqual(
      result.artifacts[0].grains,
      { phase: '2026-12-31' },
      'the grain is the date the value next changes',
    );
    assert.notOk(
      '__clock' in result.artifacts[0].values,
      'the clock is an input, never an output',
    );
    const later = await worker.evaluateCard(plan, [
      input({
        rows: [],
        tallyDate: '2026-12-31',
        cardInfo: { name: 'x' },
        __clock: { today: '2027-01-01', now: '2027-01-01T05:00:00.000Z' },
      }),
    ]);
    assert.strictEqual(later.artifacts[0].values.phase, 'past');
    assert.deepEqual(
      later.artifacts[0].grains,
      { phase: null },
      'a value that never changes again has no grain',
    );
  });

  test('does not reuse values after input or program changes', async function (assert) {
    const def = definition();
    let plan = makeLatticeCardComputePlan(def, 'module-1', shape, outputs);
    await worker.evaluateCard(plan, [input({ rows: [{ score: 8 }] })]);
    const edited = await worker.evaluateCard(plan, [
      input({ rows: [{ score: 9 }] }, 'input-2'),
    ]);
    def.fieldDefs.sum.bxl = program(
      '([.rows[]? | .score // 0] | add // 0) + 1',
    );
    plan = makeLatticeCardComputePlan(def, 'module-2', shape, outputs);
    const changed = await worker.evaluateCard(plan, [
      input({ rows: [{ score: 9 }] }, 'input-2'),
    ]);
    assert.strictEqual(edited.artifacts[0].values.doubled, 18);
    assert.strictEqual(changed.artifacts[0].values.doubled, 20);
    assert.strictEqual(changed.artifacts[0].definitionRevision, 'module-2');
    assert.strictEqual(changed.artifacts[0].inputRevision, 'input-2');
  });

  test('field timings cross the worker boundary without changing data or repeating dependencies', async function (assert) {
    const plan = makeLatticeCardComputePlan(definition(), 'v1', shape, outputs);
    const result = await worker.evaluateCard(plan, [
      input({ rows: [{ score: 3 }] }),
      input({ rows: [{ score: 5 }] }, 'input-2'),
    ]);
    assert.deepEqual(
      result.artifacts.map((a) => a.values.doubled),
      [6, 10],
    );
    for (const cardIndex of [0, 1]) {
      const timings = result.measurements.fields.filter(
        (field) => field.cardIndex === cardIndex,
      );
      assert.deepEqual(
        timings.map((field) => field.field).sort(),
        Object.keys(outputs).sort(),
        'each field is measured once, including the reused total prerequisite',
      );
      for (const timing of timings) {
        assert.strictEqual(timing.status, 'fulfilled');
        assert.true(Number.isFinite(timing.elapsedMs));
        assert.true(timing.elapsedMs >= 0);
        assert.true(Number.isFinite(timing.cpuMs));
        assert.true(timing.cpuMs >= 0);
      }
      assert.strictEqual(
        timings.find((t) => t.field === 'total')?.evaluator,
        'bxl',
      );
      assert.strictEqual(
        timings.find((t) => t.field === 'cardTitle')?.evaluator,
        'base',
      );
    }
  });

  test('a rejected budget identifies the field across the worker boundary and still prevents publication', async function (assert) {
    // The production budget is sized for a whole day's records; a worker
    // started with a small one still names the field that overran it.
    const previous = process.env.LATTICE_NATIVE_BXL_MAX_STEPS;
    process.env.LATTICE_NATIVE_BXL_MAX_STEPS = '100000';
    const bounded = new LatticeBxlWorker();
    try {
      const def = definition();
      def.fieldDefs.sum.bxl = program('[range(0; 200000) | . + 1] | add');
      await assert.rejects(
        bounded.evaluateCard(
          makeLatticeCardComputePlan(def, 'v1', shape, outputs),
          [input({})],
        ),
        /Lattice computation Tally\.total \[bxl\/evaluate, wall=[\d.]+ms, threadCPU=[\d.]+ms\]: .*limit/,
      );
      const recovered = await bounded.evaluateCard(
        makeLatticeCardComputePlan(definition(), 'v2', shape, outputs),
        [input({ rows: [{ score: 4 }] })],
      );
      assert.strictEqual(recovered.artifacts[0].values.doubled, 8);
      assert.strictEqual(
        recovered.measurements.fields.length,
        Object.keys(outputs).length,
      );
    } finally {
      if (previous === undefined)
        delete process.env.LATTICE_NATIVE_BXL_MAX_STEPS;
      else process.env.LATTICE_NATIVE_BXL_MAX_STEPS = previous;
      await bounded.close();
    }
  });

  test('large batches bound field diagnostics without dropping computation results', async function (assert) {
    const result = await worker.evaluateCard(
      makeLatticeCardComputePlan(definition(), 'v1', shape, outputs),
      Array.from({ length: 200 }, (_, score) => input({ rows: [{ score }] })),
    );
    assert.strictEqual(result.artifacts.length, 200);
    assert.strictEqual(result.artifacts[199].values.doubled, 398);
    assert.strictEqual(result.measurements.fields.length, 1024);
    assert.strictEqual(result.measurements.omittedFieldTimings, 176);
  });

  test('query prerequisites evaluate their computed dependencies without forcing unrelated fields', async function (assert) {
    const def = definition();
    def.fieldDefs.title = { ...primitive };
    const plan = makeLatticeCardPrerequisitePlan(
      def,
      'module-1',
      { object: { rows: shape.object.rows } },
      outputs,
      ['doubled'],
    );
    assert.deepEqual(plan.requestedFields, ['doubled']);
    const result = await worker.evaluateCard(plan, [
      input({ rows: [{ score: 3 }, { score: 4 }] }),
    ]);
    assert.deepEqual(result.artifacts[0].values, { total: 7, doubled: 14 });
    assert.throws(
      () => makeLatticeCardComputePlan(def, 'module-1', shape, outputs),
      /Unported application computation: cardTitle/,
      'partial prerequisite success cannot qualify an incomplete card for publication',
    );
  });

  test('a prerequisite cannot accept a computed value as authored input or conceal a missing dependency hint', async function (assert) {
    assert.throws(
      () =>
        makeLatticeCardPrerequisitePlan(
          definition(),
          'module-1',
          { object: { ...shape.object, total: 'number' } },
          outputs,
          ['doubled'],
        ),
      /must be evaluated/,
    );
    const def = definition();
    def.fieldDefs.double.bxl!.deps = [];
    const plan = makeLatticeCardPrerequisitePlan(
      def,
      'module-1',
      { object: { rows: shape.object.rows } },
      outputs,
      ['doubled'],
    );
    await assert.rejects(
      worker.evaluateCard(plan, [input({ rows: [] })]),
      /Unadmitted computed input: total/,
    );
  });

  test('declines an unported field, unsupported options and supplied computed values', function (assert) {
    const def = definition();
    delete def.fieldDefs.sum.bxl;
    assert.throws(
      () => makeLatticeCardComputePlan(def, 'v1', shape, outputs),
      /Unported application computation: total/,
    );
    def.fieldDefs.sum.bxl = { ...program(expression), materializesClass: true };
    assert.throws(
      () => makeLatticeCardComputePlan(def, 'v1', shape, outputs),
      /Unsupported/,
    );
    def.fieldDefs.sum.bxl = { ...program(expression), libraries: ['formula'] };
    assert.throws(
      () => makeLatticeCardComputePlan(def, 'v1', shape, outputs),
      /Unsupported/,
    );
    def.fieldDefs.sum.bxl = program(expression);
    assert.throws(
      () =>
        makeLatticeCardComputePlan(
          def,
          'v1',
          { object: { ...shape.object, total: 'number' } },
          outputs,
        ),
      /must be evaluated/,
    );
  });

  test('a cyclic or failed sibling prevents the complete artifact and the worker recovers', async function (assert) {
    const def = definition();
    def.fieldDefs.sum.bxl = program('.doubled + 1');
    await assert.rejects(
      worker.evaluateCard(
        makeLatticeCardComputePlan(def, 'v1', shape, outputs),
        [input({})],
      ),
      /Cyclic native/,
    );
    def.fieldDefs.sum.bxl = program('"wrong output"');
    await assert.rejects(
      worker.evaluateCard(
        makeLatticeCardComputePlan(def, 'v2', shape, outputs),
        [input({})],
      ),
      /shape mismatch/,
    );
    const recovered = await worker.evaluateCard(
      makeLatticeCardComputePlan(definition(), 'v3', shape, outputs),
      [input({})],
    );
    assert.strictEqual(recovered.artifacts[0].values.total, 0);
    assert.strictEqual(
      recovered.artifacts[0].values.cardTitle,
      'Untitled Tally',
    );
  });

  test('ordering respects conditional dependencies without rejecting an unexecuted cycle', async function (assert) {
    const def = definition();
    def.fieldDefs.double.bxl = program(
      'if ((.rows // []) | length) > 0 then .total * 2 else 0 end',
    );
    def.fieldDefs.sum.bxl = program('.doubled + 1');
    const plan = makeLatticeCardComputePlan(def, 'conditional', shape, outputs);
    const result = await worker.evaluateCard(plan, [input({ rows: [] })]);
    assert.strictEqual(result.artifacts[0].values.doubled, 0);
    assert.strictEqual(result.artifacts[0].values.total, 1);
    await assert.rejects(
      worker.evaluateCard(plan, [input({ rows: [{ score: 1 }] })]),
      /Cyclic native/,
      'an executed cycle still prevents publication',
    );
  });

  test('missing input coverage cannot silently become an empty aggregate', async function (assert) {
    const def = definition();
    def.fieldDefs.sum.bxl = program('[.roster[]?] | length');
    assert.throws(
      () => makeLatticeCardComputePlan(def, 'v1', shape, outputs),
      /Unadmitted computed input: roster/,
    );
    // Stale persisted hints cannot bypass the actual compiled program's roots.
    def.fieldDefs.sum.bxl.deps = [];
    const plan = makeLatticeCardComputePlan(def, 'v1', shape, outputs);
    await assert.rejects(
      worker.evaluateCard(plan, [input({})]),
      /Unadmitted computed input: roster/,
    );
  });

  test('missing nested input cannot be hidden by an optional path', async function (assert) {
    const def = definition();
    def.fieldDefs.sum.bxl = program('[.rows[]? | .maximum?] | add // 0');
    const plan = makeLatticeCardComputePlan(def, 'v1', shape, outputs);
    await assert.rejects(
      worker.evaluateCard(plan, [input({ rows: [{ score: 3 }] })]),
      /Unadmitted computed input/,
    );
  });
});
