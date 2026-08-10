import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { md5 } from 'super-fast-md5';
import {
  CONTENT_HASH_HEAD_BYTES,
  CONTENT_HASH_TAIL_BYTES,
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
  computeContentHash,
  isSampledContentHash,
} from '@cardstack/runtime-common';

// Deterministic filler so two buffers differ only where a test says they do.
function bytes(length: number, seed = 1): Uint8Array {
  let out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = (i * 31 + seed) & 0xff;
  }
  return out;
}

const OVER_LIMIT = CONTENT_HASH_WHOLE_LIMIT_BYTES + 1024;

module(basename(import.meta.filename), function () {
  test('content at or below the whole limit keeps its plain md5', function (assert) {
    for (let content of [
      'hello world',
      bytes(1024),
      bytes(CONTENT_HASH_WHOLE_LIMIT_BYTES),
    ]) {
      let expected =
        typeof content === 'string'
          ? md5(new TextEncoder().encode(content))
          : md5(content);
      assert.strictEqual(computeContentHash(content), expected);
      assert.false(isSampledContentHash(computeContentHash(content)));
    }
  });

  test('content above the whole limit is sampled and self-describing', function (assert) {
    let hash = computeContentHash(bytes(OVER_LIMIT));
    assert.true(isSampledContentHash(hash), 'marked as sampled');
    let [marker, length, head, tail] = hash.split(':');
    assert.strictEqual(marker, 's1');
    assert.strictEqual(Number(length), OVER_LIMIT, 'carries the byte length');
    assert.strictEqual(head.length, 32, 'head is an md5');
    assert.strictEqual(tail.length, 32, 'tail is an md5');
  });

  test('a sampled hash can never equal a whole one', function (assert) {
    let big = bytes(OVER_LIMIT);
    assert.notStrictEqual(
      computeContentHash(big),
      md5(big),
      'the format change keeps a re-derived hash from matching a stored whole one',
    );
  });

  test('a change in the head is detected', function (assert) {
    let a = bytes(OVER_LIMIT);
    let b = bytes(OVER_LIMIT);
    b[0] ^= 0xff;
    assert.notStrictEqual(computeContentHash(a), computeContentHash(b));
  });

  test('a change in the tail is detected', function (assert) {
    let a = bytes(OVER_LIMIT);
    let b = bytes(OVER_LIMIT);
    b[b.length - 1] ^= 0xff;
    assert.notStrictEqual(computeContentHash(a), computeContentHash(b));
  });

  test('a change in length alone is detected', function (assert) {
    assert.notStrictEqual(
      computeContentHash(bytes(OVER_LIMIT)),
      computeContentHash(bytes(OVER_LIMIT + 1)),
    );
  });

  test('the sampled middle is the documented blind spot', function (assert) {
    // Two files of identical length whose head and tail match but whose middle
    // differs share a fingerprint. This is the accepted trade for bounding the
    // hash cost; the test exists so the boundary is explicit rather than
    // discovered.
    let a = bytes(OVER_LIMIT);
    let b = bytes(OVER_LIMIT);
    let middle = CONTENT_HASH_HEAD_BYTES + 1;
    assert.ok(
      middle < b.length - CONTENT_HASH_TAIL_BYTES,
      'the probe byte really is between the sampled regions',
    );
    b[middle] ^= 0xff;
    assert.strictEqual(computeContentHash(a), computeContentHash(b));
  });

  test('only the head, tail, and length are consulted', function (assert) {
    // The cost bound follows from this rather than from a stopwatch: if the
    // hash is a function of exactly these three, it cannot grow with file size.
    let huge = bytes(CONTENT_HASH_WHOLE_LIMIT_BYTES * 8);
    let [, length, head, tail] = computeContentHash(huge).split(':');

    assert.strictEqual(Number(length), huge.length);
    assert.strictEqual(
      head,
      md5(huge.subarray(0, CONTENT_HASH_HEAD_BYTES)),
      'head component covers exactly the first HEAD bytes',
    );
    assert.strictEqual(
      tail,
      md5(huge.subarray(huge.length - CONTENT_HASH_TAIL_BYTES)),
      'tail component covers exactly the last TAIL bytes',
    );
  });
});
