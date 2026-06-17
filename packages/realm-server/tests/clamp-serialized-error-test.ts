import { module, test } from 'qunit';
import { basename } from 'path';
import {
  clampSerializedError,
  ERROR_DOC_MAX_ADDITIONAL_ERRORS,
  ERROR_DOC_MAX_BYTES,
  type SerializedError,
} from '@cardstack/runtime-common';

// Verifies the progressive clamp applied to error_doc on its way
// into the database (boxel_index.error_doc / modules.error_doc).
// Postgres jsonb arrays cap at 256 MiB of element bytes — a format-
// level constraint, not a column setting — and dependency-error
// fan-out has produced rows that hit that ceiling in production. The
// clamp is the chokepoint that guarantees we never persist more than
// `ERROR_DOC_MAX_BYTES` (8 MiB) per error doc.
//
// In normal operation the clamp is a pure pass-through: when the doc
// already fits, the input is returned unchanged. Each test below
// exercises one step of the over-budget shedding ladder and asserts
// that *only* that step ran (the doc fit afterwards) and that the
// later steps left the doc alone.

function jsonByteSize(value: unknown): number {
  return JSON.stringify(value).length;
}

function bigString(byteCount: number): string {
  return 'x'.repeat(byteCount);
}

function isOmittedSentinel(entry: any): boolean {
  return (
    entry &&
    typeof entry === 'object' &&
    entry.title === 'Errors omitted' &&
    typeof entry.message === 'string' &&
    /omitted to satisfy error_doc size budget/.test(entry.message)
  );
}

module(basename(import.meta.filename), function () {
  test('returns the input unchanged when the doc fits the budget', function (assert) {
    let input: SerializedError = {
      message: 'boom',
      status: 500,
      title: 'Internal Server Error',
      stack: 'Error: boom\n    at thing (/x.js:1:1)',
      additionalErrors: [
        {
          status: 500,
          message: 'inner err',
          stack: 'Error: inner\n    at thing (/y.js:1:1)',
          additionalErrors: [
            {
              status: 500,
              message: 'inner inner',
              additionalErrors: null,
            },
          ],
        },
      ],
      diagnostics: { invalidationId: 'abc', launchMs: 1234 },
      deps: ['a', 'b', 'c'],
    };
    let clamped = clampSerializedError(input);
    assert.strictEqual(clamped, input, 'identity preserved when under budget');
  });

  test('step 1 only: trims per-entry stacks when that is enough', function (assert) {
    // 100 entries × 1 MiB stack each ≈ 100 MiB → over the 8 MiB
    // budget. After trimming each stack to 64 KiB the doc fits, so
    // steps 2-7 must NOT run.
    let entries = Array.from({ length: 100 }, (_, i) => ({
      status: 500,
      message: `dep err ${i}`,
      stack: bigString(1024 * 1024),
      additionalErrors: [
        { status: 500, message: 'nested', additionalErrors: null },
      ],
    }));
    let topLevelStack = bigString(2_000);
    let topLevelMessage = bigString(2_000);
    let input: SerializedError = {
      message: topLevelMessage,
      status: 500,
      stack: topLevelStack,
      additionalErrors: entries,
    };

    let clamped = clampSerializedError(input);

    assert.ok(
      jsonByteSize(clamped) <= ERROR_DOC_MAX_BYTES,
      `clamped doc fits the budget (${jsonByteSize(clamped)} bytes)`,
    );
    assert.strictEqual(
      clamped.stack,
      topLevelStack,
      'step 2 did NOT run: top-level stack untouched',
    );
    assert.strictEqual(
      clamped.message,
      topLevelMessage,
      'step 3+ did NOT run: top-level message untouched',
    );
    assert.strictEqual(
      clamped.additionalErrors!.length,
      100,
      'step 5 did NOT run: entry count preserved',
    );
    let entry = clamped.additionalErrors![0];
    assert.strictEqual(
      entry.message,
      'dep err 0',
      'step 3 did NOT run: per-entry message untouched',
    );
    assert.ok(
      Array.isArray(entry.additionalErrors),
      'step 4 did NOT run: nested additionalErrors retained',
    );
    assert.ok(
      entry.stack.length < 1024 * 1024,
      'step 1 DID run: per-entry stack was trimmed',
    );
  });

  test('step 2: trims top-level stack when per-entry stacks alone are not enough', function (assert) {
    let entries = Array.from({ length: 5 }, (_, i) => ({
      status: 500,
      message: `dep err ${i}`,
      stack: 'short',
      additionalErrors: [
        { status: 500, message: 'nested', additionalErrors: null },
      ],
    }));
    let input: SerializedError = {
      message: 'parent',
      status: 500,
      stack: bigString(9 * 1024 * 1024),
      additionalErrors: entries,
    };

    let clamped = clampSerializedError(input);

    assert.ok(
      jsonByteSize(clamped) <= ERROR_DOC_MAX_BYTES,
      'clamped doc fits the budget',
    );
    assert.ok(
      clamped.stack!.length < 9 * 1024 * 1024,
      'step 2 DID run: top-level stack trimmed',
    );
    assert.strictEqual(
      clamped.message,
      'parent',
      'step 3+ did NOT run: top-level message untouched',
    );
    let entry = clamped.additionalErrors![0];
    assert.strictEqual(
      entry.message,
      'dep err 0',
      'step 3 did NOT run: per-entry messages untouched',
    );
    assert.ok(
      Array.isArray(entry.additionalErrors),
      'step 4 did NOT run: nested additionalErrors retained',
    );
  });

  test('step 3: trims per-entry messages once stacks are not the offender', function (assert) {
    let entries = Array.from({ length: 100 }, (_, i) => ({
      status: 500,
      message: `dep err ${i} ${bigString(200_000)}`,
      additionalErrors: [
        { status: 500, message: 'nested', additionalErrors: null },
      ],
    }));
    let input: SerializedError = {
      message: 'parent',
      status: 500,
      additionalErrors: entries,
    };

    let clamped = clampSerializedError(input);

    assert.ok(
      jsonByteSize(clamped) <= ERROR_DOC_MAX_BYTES,
      'clamped doc fits the budget',
    );
    let entry = clamped.additionalErrors![0];
    assert.ok(
      entry.message.length < 200_000,
      'step 3 DID run: per-entry message trimmed',
    );
    assert.ok(
      Array.isArray(entry.additionalErrors),
      'step 4 did NOT run: nested additionalErrors retained',
    );
    assert.strictEqual(
      clamped.additionalErrors!.length,
      100,
      'step 5 did NOT run: entry count preserved',
    );
  });

  test('step 4: collapses nested additionalErrors of inherited entries', function (assert) {
    let entries = Array.from({ length: 100 }, (_, i) => ({
      status: 500,
      message: `dep err ${i}`,
      additionalErrors: Array.from({ length: 200 }, (_, j) => ({
        status: 500,
        message: `nested ${i}/${j} ${bigString(2_000)}`,
        additionalErrors: null,
      })),
    }));
    let input: SerializedError = {
      message: 'parent',
      status: 500,
      additionalErrors: entries,
    };

    let clamped = clampSerializedError(input);

    assert.ok(
      jsonByteSize(clamped) <= ERROR_DOC_MAX_BYTES,
      'clamped doc fits the budget',
    );
    assert.strictEqual(
      clamped.additionalErrors!.length,
      100,
      'step 5 did NOT run: parent entry count preserved',
    );
    for (let entry of clamped.additionalErrors!) {
      assert.strictEqual(
        entry.additionalErrors,
        null,
        'step 4 DID run: nested additionalErrors collapsed',
      );
    }
  });

  test('step 5: caps entry count with a sentinel when collapsing nesting was not enough', function (assert) {
    let count = 5_000;
    let entries = Array.from({ length: count }, (_, i) => ({
      status: 500,
      message: `dep err ${i} ${bigString(2_500)}`,
      additionalErrors: null,
    }));
    let input: SerializedError = {
      message: 'parent',
      status: 500,
      additionalErrors: entries,
    };

    let clamped = clampSerializedError(input);

    assert.ok(
      jsonByteSize(clamped) <= ERROR_DOC_MAX_BYTES,
      'clamped doc fits the budget',
    );
    assert.strictEqual(
      clamped.additionalErrors!.length,
      ERROR_DOC_MAX_ADDITIONAL_ERRORS,
      'step 5 DID run: array length matches the constant (MAX-1 entries + sentinel)',
    );
    let sentinel =
      clamped.additionalErrors![ERROR_DOC_MAX_ADDITIONAL_ERRORS - 1];
    assert.ok(
      isOmittedSentinel(sentinel),
      'sentinel entry recorded the omission',
    );
    assert.ok(
      new RegExp(`${count - (ERROR_DOC_MAX_ADDITIONAL_ERRORS - 1)}`).test(
        sentinel.message,
      ),
      'sentinel records the original count minus the preserved entries',
    );
  });

  test('step 6: drops additionalErrors when capping at MAX is still not enough', function (assert) {
    let count = 1_000;
    let entries = Array.from({ length: count }, (_, i) => ({
      status: 500,
      message: `dep err ${i}`,
      stack: bigString(64 * 1024),
      additionalErrors: null,
    }));
    let input: SerializedError = {
      message: 'parent',
      status: 500,
      additionalErrors: entries,
    };

    let clamped = clampSerializedError(input);

    assert.ok(
      jsonByteSize(clamped) <= ERROR_DOC_MAX_BYTES,
      'clamped doc fits the budget',
    );
    assert.strictEqual(
      clamped.additionalErrors!.length,
      1,
      'step 6 DID run: only sentinel left',
    );
    let sentinel = clamped.additionalErrors![0];
    assert.ok(
      isOmittedSentinel(sentinel),
      'lone entry is the omitted-sentinel',
    );
    assert.ok(
      new RegExp(`\\b${count}\\b`).test(sentinel.message),
      'step 6 sentinel reports the ORIGINAL additionalErrors count, not the post-step-5 count',
    );
  });

  test('step 7: shrinks the top-level message/stack as a last resort', function (assert) {
    let input: SerializedError = {
      message: bigString(9 * 1024 * 1024),
      status: 500,
      stack: bigString(9 * 1024 * 1024),
      additionalErrors: null,
    };

    let clamped = clampSerializedError(input);

    assert.ok(
      jsonByteSize(clamped) <= ERROR_DOC_MAX_BYTES,
      'clamped doc fits the budget',
    );
    assert.ok(
      clamped.message.length < 9 * 1024 * 1024,
      'step 7 DID run: top-level message shrunk',
    );
    assert.ok(
      (clamped.stack?.length ?? 0) < 9 * 1024 * 1024,
      'top-level stack shrunk',
    );
  });

  test('preserves diagnostics on the top-level error', function (assert) {
    let input: SerializedError = {
      message: 'parent',
      status: 500,
      additionalErrors: null,
      diagnostics: { invalidationId: 'abc', launchMs: 1234 },
    };
    let clamped = clampSerializedError(input);
    assert.deepEqual(clamped.diagnostics, {
      invalidationId: 'abc',
      launchMs: 1234,
    });
  });

  test('does not mutate the input when shedding', function (assert) {
    let input: SerializedError = {
      message: 'parent',
      status: 500,
      stack: bigString(9 * 1024 * 1024),
      additionalErrors: [
        {
          status: 500,
          message: 'kept-by-reference',
          stack: bigString(1_000_000),
          additionalErrors: null,
        },
      ],
    };
    let originalEntry = input.additionalErrors![0];

    let clamped = clampSerializedError(input);

    assert.notStrictEqual(clamped, input, 'returns a new object when shedding');
    assert.strictEqual(
      input.stack!.length,
      9 * 1024 * 1024,
      'input stack untouched',
    );
    assert.strictEqual(
      originalEntry.stack.length,
      1_000_000,
      'original additionalErrors entry untouched',
    );
  });
});
