import QUnit from 'qunit';
import { basename } from 'node:path';
import { evaluateBxl, prepareBxl, type BxlOptions } from '@cardstack/bxl';
import {
  LatticeBxlWorker,
  type LatticeBxlManifest,
} from '../lib/lattice-bxl-derivation.ts';
import {
  expectedStats,
  expectedWeird,
  generateAdversarial,
} from './helpers/lattice-adversarial-fixture.ts';

const { module, test } = QUnit;
const realmURL = 'https://adversarial-bxl.example/';

// Small explicit budgets for these adversarial fixtures. The worker test sets
// its step budget before spawning the worker; production defaults leave more
// room for compositional cards and are not the refusal threshold tested here.
const WORKER_LIMITS = {
  maxSteps: 100_000,
  maxMillis: 100,
  maxOutputs: 1,
  maxOutputBytes: 65_536,
};
const CORE: BxlOptions = { libraries: ['core'], readableSyntax: false };

function attrsOf(
  records: ReturnType<typeof generateAdversarial>['records'],
  path: string,
) {
  return records.get(path)!.data.attributes;
}

// Pure layer: the formulas the adversarial owners declare, run through the
// same engine and the same limits the native worker uses, with no realm,
// database or browser. Wrong formulas must fail the same way every time;
// expensive ones must either finish inside the budget or be refused by it;
// nothing may leave the engine in a state that changes the next answer.
module(basename(import.meta.filename), function () {
  const { records, ids } = generateAdversarial({ realmURL, statsEntries: 500 });
  const statsInput = {
    entries: ids.statsEntries.map((path) => attrsOf(records, path)),
  };
  const smallInput = {
    entries: ids.smallEntries.map((path) => attrsOf(records, path)),
    bucket: 'small',
  };

  test('the expensive statistics formulas finish inside the worker budget and equal the oracle', function (assert) {
    const expected = expectedStats(records, ids.stats);
    const formulas: Record<string, string> = {
      mean: '([.entries[].n] | add // 0) / (([.entries[].n] | length) | if . == 0 then 1 else . end)',
      variance:
        '[.entries[].n] as $xs | ($xs | length) as $k | if $k == 0 then 0 else (($xs | map(. * .) | add) / $k) - ((($xs | add) / $k) * (($xs | add) / $k)) end',
      p90: '[.entries[].n] | sort as $s | ($s | length) as $k | if $k == 0 then 0 else $s[(($k * 9 / 10) | floor) | if . >= $k then $k - 1 else . end] end',
      distinctTexts: '[.entries[].text] | unique | length',
    };
    for (const [field, expression] of Object.entries(formulas)) {
      const started = performance.now();
      const result = evaluateBxl(expression, statsInput, {
        ...CORE,
        runtimeLimits: WORKER_LIMITS,
      });
      const ms = performance.now() - started;
      console.log(
        `LATTICE_ADVERSARIAL bxl ${field} over 500 entries: ${ms.toFixed(1)} ms`,
      );
      if (typeof expected[field] === 'number')
        assert.true(
          Math.abs((result.value as number) - (expected[field] as number)) <
            1e-9,
          `${field} equals the oracle (${result.value} vs ${expected[field]})`,
        );
      else
        assert.strictEqual(
          result.value,
          expected[field],
          `${field} equals the oracle`,
        );
    }
    const empty = evaluateBxl(formulas.p90, { entries: [] }, CORE);
    assert.strictEqual(empty.value, 0, 'p90 of no entries is 0, not an error');
  });

  test('the weird-but-legal formulas produce the values the oracle predicts', function (assert) {
    const expected = expectedWeird(records, ids.weird);
    assert.strictEqual(
      evaluateBxl('null', smallInput, CORE).value,
      null,
      'an explicit null is a blank, not a failure',
    );
    assert.strictEqual(
      evaluateBxl('9007199254740993', smallInput, CORE).value,
      expected.big,
      'an integer past 2^53 loses precision the same way JSON does',
    );
    assert.strictEqual(
      evaluateBxl('[.entries[].text] | sort | join("|")', smallInput, CORE)
        .value,
      expected.joined,
      'sort and join agree with the oracle',
    );
    // BXL string literals do not accept `\u` escapes (a finding on its own),
    // so hostile bytes arrive through the data, as they would from a card.
    assert.throws(
      () => prepareBxl('"caf\\u00e9"', CORE),
      /escape/,
      'a `\\u` escape in a formula literal is refused at preparation',
    );
    const nul = evaluateBxl(
      '.entries[0].text',
      { entries: [{ text: 'a\u0000b' }] },
      CORE,
    ).value as string;
    assert.true(
      nul.includes('\u0000'),
      'a NUL byte in the data passes through the engine untouched; it is the database that refuses it',
    );
    // A field named after a BXL keyword cannot be read with dot syntax; the
    // whole module fails to load if a formula tries. Bracket syntax works.
    assert.throws(
      () => prepareBxl('.label', CORE),
      /keyword/,
      '`.label` is refused because `label` is a keyword',
    );
    assert.strictEqual(
      evaluateBxl('.["label"]', { label: 'ok' }, CORE).value,
      'ok',
      'bracket access reads a keyword-named field',
    );
    const nfc = 'caf\u00e9';
    const nfd = 'cafe\u0301';
    const keyed = evaluateBxl(`.["${nfc}"]`, { [nfc]: 1, [nfd]: 2 }, CORE);
    assert.strictEqual(
      keyed.value,
      1,
      'NFC and NFD spellings of the same key are different keys',
    );
  });

  test('each bad formula behaves the same way every time, and the engine stays clean', function (assert) {
    // What each does today is itself a finding: division by zero and
    // iterating a null both yield a value rather than an error, so the owner
    // publishes something. The catalog records the value; this test pins it.
    const bad: Record<string, { expression: string; errors: boolean }> = {
      BadRuntime: {
        expression:
          '(.entries | length) / ((.entries | length) - (.entries | length))',
        errors: false,
      },
      BadType: { expression: '.bucket + 1', errors: true },
      BadNull: { expression: '[.missing[]] | length', errors: false },
    };
    for (const [name, { expression, errors }] of Object.entries(bad)) {
      const outcomes: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          outcomes.push(
            'value ' +
              JSON.stringify(
                evaluateBxl(expression, smallInput, {
                  ...CORE,
                  runtimeLimits: WORKER_LIMITS,
                }).value,
              ),
          );
        } catch (error) {
          outcomes.push('error ' + (error as Error).message);
        }
      }
      console.log(`LATTICE_ADVERSARIAL bxl ${name}: ${outcomes[0]}`);
      assert.strictEqual(
        outcomes[0].startsWith('error'),
        errors,
        `${name} ${errors ? 'errors' : 'yields a value'}: ${outcomes[0]}`,
      );
      assert.strictEqual(
        outcomes[0],
        outcomes[1],
        `${name} gives the same outcome on a second run`,
      );
    }
    const shape = evaluateBxl('{ a: (.entries | length) }', smallInput, CORE);
    assert.deepEqual(
      shape.value,
      { a: 4 },
      'BadShape evaluates to an object; the shape check that refuses it lives in the worker, not the engine',
    );
    assert.throws(
      () => prepareBxl('.count | | foo', CORE),
      'a syntax error is refused at preparation, before any input is read',
    );
    assert.strictEqual(
      evaluateBxl('.entries | length', smallInput, CORE).value,
      4,
      'a healthy formula still evaluates after the failures',
    );
  });

  test('a formula that runs hot is refused by the step budget, not by luck', function (assert) {
    const hot = '[range(400000)] | length';
    // Either budget may fire first; the wall-clock one usually does. Both
    // are the same refusal from the caller's side.
    assert.throws(
      () =>
        evaluateBxl(hot, smallInput, { ...CORE, runtimeLimits: WORKER_LIMITS }),
      /runtime limit/,
      'the worker budget refuses a 400k-element range',
    );
    const withinChrome = evaluateBxl(hot, smallInput, {
      ...CORE,
      runtimeLimits: {
        ...WORKER_LIMITS,
        maxSteps: 5_000_000,
        maxMillis: 5_000,
      },
    });
    assert.strictEqual(
      withinChrome.value,
      400000,
      'the same formula completes under a larger budget, so the refusal is the budget, not the formula',
    );
    let outputRefusal = '';
    try {
      evaluateBxl('[range(500)] | map(tostring) | join("x")', smallInput, {
        ...CORE,
        runtimeLimits: {
          maxSteps: 5_000_000,
          maxMillis: 5_000,
          maxOutputs: 1,
          maxOutputBytes: 1_000,
        },
      });
    } catch (error) {
      outputRefusal = (error as Error).message;
    }
    console.log(`LATTICE_ADVERSARIAL bxl output budget: ${outputRefusal}`);
    assert.true(
      outputRefusal.length > 0,
      `an oversized output is refused by the output budget: ${outputRefusal}`,
    );
  });

  test('the worker enforces its batch bounds and survives a refused formula', async function (assert) {
    const previousSteps = process.env.LATTICE_NATIVE_BXL_MAX_STEPS;
    process.env.LATTICE_NATIVE_BXL_MAX_STEPS = String(WORKER_LIMITS.maxSteps);
    const worker = new LatticeBxlWorker();
    const manifest = (expression: string): LatticeBxlManifest => ({
      version: 1,
      definition: { module: realmURL + 'cards', name: 'Stats', revision: 'r1' },
      field: 'value',
      expression,
      input: { object: { xs: { array: 'number' } } },
      output: 'number',
    });
    const input = (id: string, xs: number[]) => ({
      id,
      revision: 'v1',
      json: JSON.stringify({ xs }),
    });
    try {
      const ok = await worker.evaluate(manifest('[.xs[]] | add // 0'), [
        input('a', [1, 2, 3]),
        input('b', []),
      ]);
      assert.deepEqual(
        ok.artifacts.map((artifact) => artifact.value),
        [6, 0],
        'a healthy batch evaluates every input',
      );
      await assert.rejects(
        worker.evaluate(manifest('[range(400000)] | length'), [
          input('a', [1]),
        ]),
        /runtime limit/,
        'the worker surfaces the budget refusal',
      );
      const again = await worker.evaluate(manifest('[.xs[]] | add // 0'), [
        input('a', [4, 5]),
      ]);
      assert.deepEqual(
        again.artifacts.map((artifact) => artifact.value),
        [9],
        'the worker is usable again after a refused formula',
      );
      await assert.rejects(
        worker.evaluate(manifest('.xs | length'), [input('a', [1])], 0),
        /Invalid BXL deadline/,
        'a zero deadline is refused before any work',
      );
      await assert.rejects(
        worker.evaluate(
          manifest('.xs | length'),
          Array.from({ length: 513 }, (_, i) => input(`c${i}`, [i])),
        ),
        /exceeds 512 cards/,
        'a batch over 512 cards is refused',
      );
      await assert.rejects(
        worker.evaluate(manifest('.xs | length'), [
          {
            ...input('big', [1]),
            // Trailing whitespace is valid JSON. Exercise the wire-byte cap
            // without allocating millions of array elements in the test runner.
            json: JSON.stringify({ xs: [1] }) + ' '.repeat(16 * 1_048_576),
          },
        ]),
        /exceeds 16 MiB/,
        'an input batch over 16 MiB is refused',
      );
      await assert.rejects(
        worker.evaluate(manifest('.xs | length'), [
          input('shape', ['not', 'numbers'] as unknown as number[]),
        ]),
        'an input that does not match the declared shape is refused',
      );
      await assert.rejects(
        worker.evaluate(manifest('{ a: 1 }'), [input('a', [1])]),
        'an output that does not match the declared shape is refused',
      );
    } finally {
      await worker.close();
      if (previousSteps === undefined)
        delete process.env.LATTICE_NATIVE_BXL_MAX_STEPS;
      else process.env.LATTICE_NATIVE_BXL_MAX_STEPS = previousSteps;
    }
  });
});
