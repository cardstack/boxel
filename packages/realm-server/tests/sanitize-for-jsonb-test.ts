import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { sanitizeForJsonb } from '@cardstack/runtime-common';

// `sanitizeForJsonb` replaces the code points Postgres rejects in a
// `jsonb` value (NUL, unpaired UTF-16 surrogates) while leaving clean
// values untouched.

const NUL = String.fromCharCode(0x0000);
const LONE_HIGH_SURROGATE = String.fromCharCode(0xd800);
const LONE_LOW_SURROGATE = String.fromCharCode(0xdc00);
const REPLACEMENT = String.fromCharCode(0xfffd);

function hasIllegalCodePoint(value: string): boolean {
  // eslint-disable-next-line no-control-regex -- matching the NUL control character is the whole point
  return /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    value,
  );
}

module(basename(import.meta.filename), function () {
  test('returns clean values unchanged', function (assert) {
    assert.strictEqual(sanitizeForJsonb('plain text'), 'plain text');
    assert.strictEqual(sanitizeForJsonb(42 as unknown), 42);
    assert.true(sanitizeForJsonb(true as unknown));
    assert.strictEqual(sanitizeForJsonb(null as unknown), null);
    assert.strictEqual(sanitizeForJsonb(undefined as unknown), undefined);
  });

  test('preserves well-formed multi-byte text and surrogate pairs', function (assert) {
    // A valid astral-plane code point (😀 = U+1F600) is a *paired* high+
    // low surrogate in UTF-16 and must survive untouched.
    let input = 'café — 😀 — naïve';
    assert.strictEqual(sanitizeForJsonb(input), input);
    assert.notOk(hasIllegalCodePoint(sanitizeForJsonb(input)));
  });

  test('replaces a NUL character', function (assert) {
    let result = sanitizeForJsonb(`load${NUL}links`);
    assert.strictEqual(result, `load${REPLACEMENT}links`);
    assert.notOk(hasIllegalCodePoint(result));
  });

  test('replaces unpaired surrogate halves', function (assert) {
    let highOnly = sanitizeForJsonb(`a${LONE_HIGH_SURROGATE}b`);
    let lowOnly = sanitizeForJsonb(`a${LONE_LOW_SURROGATE}b`);
    assert.strictEqual(highOnly, `a${REPLACEMENT}b`);
    assert.strictEqual(lowOnly, `a${REPLACEMENT}b`);
    assert.notOk(hasIllegalCodePoint(highOnly));
    assert.notOk(hasIllegalCodePoint(lowOnly));
  });

  test('recurses through nested objects, arrays, and keys', function (assert) {
    let result = sanitizeForJsonb({
      message: `Unexpected token ${NUL}${LONE_HIGH_SURROGATE} JFIF`,
      additionalErrors: [{ detail: `nested ${NUL} binary` }],
      [`key${NUL}`]: 'value',
    }) as Record<string, any>;

    assert.notOk(
      hasIllegalCodePoint(JSON.stringify(result)),
      'whole tree clean',
    );
    assert.true(result.message.includes('JFIF'), 'readable remainder kept');
    assert.notOk(hasIllegalCodePoint(result.message));
    assert.notOk(hasIllegalCodePoint(result.additionalErrors[0].detail));
    assert.strictEqual(
      result[`key${REPLACEMENT}`],
      'value',
      'illegal code points in object keys are sanitized too',
    );
  });
});
