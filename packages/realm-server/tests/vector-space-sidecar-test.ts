import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  cardForVectorSidecar,
  isExactSpace,
  isVectorSidecar,
  parseVectorSidecar,
  sidecarHash,
  spaceDimensions,
  vectorSidecarFor,
  vectorSidecarLine,
  vectorSpace,
} from '@cardstack/runtime-common';

// Vector spaces and sidecars, without a database: what a space string says,
// which types name one exactly, and how a sidecar's lines are read.

const STANDARD = {
  vectorizer: 'qwen/qwen3-embedding-8b@2026-11-05',
  provider: 'openrouter:deepinfra',
  dimensions: 1024,
};

module(basename(import.meta.filename), function () {
  module('spaces', function () {
    test('an exact space names the vectorizer with its revision, the provider and the size', function (assert) {
      assert.true(isExactSpace(STANDARD));
      assert.strictEqual(
        vectorSpace(STANDARD),
        'qwen/qwen3-embedding-8b@2026-11-05 openrouter:deepinfra 1024',
      );
      assert.strictEqual(spaceDimensions(vectorSpace(STANDARD)), 1024);
    });

    test('an alias, a missing revision or a missing provider is not exact', function (assert) {
      assert.false(
        isExactSpace({ ...STANDARD, vectorizer: 'qwen/qwen3-embedding-8b' }),
        'no revision',
      );
      assert.false(
        isExactSpace({
          ...STANDARD,
          vectorizer: 'qwen/qwen3-embedding-8b@latest',
        }),
        'latest is an alias',
      );
      assert.false(
        isExactSpace({ ...STANDARD, provider: undefined }),
        'no provider',
      );
      assert.false(isExactSpace({ ...STANDARD, dimensions: 0 }), 'no size');
    });

    test('a plain vector and a pre-space type read as their own spaces', function (assert) {
      assert.strictEqual(vectorSpace({ dimensions: 8 }), 'vector 8');
      assert.strictEqual(
        vectorSpace({
          dimensions: 256,
          embeddingModel: 'qwen/qwen3-embedding-8b',
        }),
        'legacy:qwen/qwen3-embedding-8b 256',
      );
      assert.notStrictEqual(
        vectorSpace({ dimensions: 1024 }),
        vectorSpace(STANDARD),
        'a plain 1024 vector never shares the standard space',
      );
    });
  });

  module('sidecars', function () {
    const S = 'x@1 p 3';

    test('a sidecar sits beside its card and leads back to it', function (assert) {
      assert.strictEqual(
        vectorSidecarFor('https://r/Talk/keynote.json'),
        'https://r/Talk/keynote.vectors.jsonl',
      );
      assert.strictEqual(
        vectorSidecarFor('https://r/Talk/keynote'),
        'https://r/Talk/keynote.vectors.jsonl',
      );
      assert.strictEqual(
        cardForVectorSidecar('https://r/Talk/keynote.vectors.jsonl'),
        'https://r/Talk/keynote.json',
      );
      assert.true(isVectorSidecar('https://r/Talk/keynote.vectors.jsonl'));
      assert.false(isVectorSidecar('https://r/log.jsonl'));
    });

    test('lines round-trip as float32, keyed by field and item', function (assert) {
      let text = [
        vectorSidecarLine({
          field: 'v',
          space: S,
          components: [0.5, -0.25, 1],
        }),
        vectorSidecarLine({
          field: 'segments.v',
          item: 's1',
          space: S,
          sourceHash: 'sha256:abc',
          components: [1, 0, 0],
        }),
      ].join('\n');
      let { vectors, errors } = parseVectorSidecar(text);
      assert.deepEqual(errors, []);
      assert.deepEqual(
        vectors.map((v) => [
          v.field,
          v.item,
          v.sourceHash,
          Array.from(v.components),
        ]),
        [
          ['v', '', undefined, [0.5, -0.25, 1]],
          ['segments.v', 's1', 'sha256:abc', [1, 0, 0]],
        ],
      );
    });

    test('a bad line is an error on that line alone', function (assert) {
      let good = vectorSidecarLine({
        field: 'v',
        space: S,
        components: [1, 2, 3],
      });
      let text = [
        good,
        good, // the same field twice
        vectorSidecarLine({
          field: 'w',
          space: 'x@1 p 4',
          components: [1, 2, 3],
        }),
        'not json',
        JSON.stringify({ field: 'u', space: S }),
      ].join('\n');
      let { vectors, errors } = parseVectorSidecar(text);
      assert.deepEqual(
        vectors.map((v) => v.field),
        ['v'],
      );
      assert.deepEqual(
        errors.map((e) => [e.line, e.code]),
        [
          [2, 'invalid-sidecar-line'],
          [3, 'vector-space-mismatch'],
          [4, 'invalid-sidecar-line'],
          [5, 'invalid-sidecar-line'],
        ],
      );
    });

    test('the hash moves with the content', async function (assert) {
      let a = await sidecarHash('one');
      assert.strictEqual(a, await sidecarHash('one'));
      assert.notStrictEqual(a, await sidecarHash('two'));
      assert.true(a.startsWith('sha256:'));
    });
  });
});
