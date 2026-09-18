import QUnit from 'qunit';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { prepareLatticeJsonSource } from '../lib/lattice-json-source.ts';

const { module, test } = QUnit;
const hash = (algorithm: string, source: string) =>
  createHash(algorithm).update(source).digest('hex');
const receipt = (source: string, version = '1') => ({
  version,
  content_hash: hash('md5', source),
  content_size: Buffer.byteLength(source),
});

module(basename(import.meta.filename), function () {
  test('full source fingerprint is reusable only with its exact file receipt', (assert) => {
    const source = JSON.stringify({ text: 'é'.repeat(240_000) });
    const first = prepareLatticeJsonSource(source, receipt(source))!;
    assert.strictEqual(first.fingerprint.digest, hash('sha256', source));
    assert.false(first.reused);
    assert.true(
      prepareLatticeJsonSource(source, receipt(source), first.fingerprint)!
        .reused,
    );
    const changed = source.slice(0, 120_000) + 'x' + source.slice(120_001);
    const next = prepareLatticeJsonSource(
      changed,
      receipt(changed, '2'),
      first.fingerprint,
    )!;
    assert.false(next.reused);
    assert.notStrictEqual(next.fingerprint.digest, first.fingerprint.digest);
    assert.strictEqual(next.fingerprint.digest, hash('sha256', changed));
    assert.strictEqual(
      prepareLatticeJsonSource(changed, receipt(source)),
      undefined,
    );
    assert.false(
      prepareLatticeJsonSource(source, receipt(source, '2'), first.fingerprint)!
        .reused,
    );
  });

  test('legacy, malformed and oversized receipts never authorize hash reuse', (assert) => {
    const source = '{"data":{}}';
    const valid = prepareLatticeJsonSource(
      source,
      receipt(source),
    )!.fingerprint;
    for (const stored of [
      undefined,
      null,
      {},
      'authored',
      { ...valid, digest: 'bad' },
      { ...valid, version: 2 },
      { ...valid, contentSize: 1 },
    ]) {
      const result = prepareLatticeJsonSource(source, receipt(source), stored)!;
      assert.false(result.reused);
      assert.strictEqual(result.fingerprint.digest, hash('sha256', source));
    }
    const large = 'x'.repeat(1_048_577);
    assert.strictEqual(
      prepareLatticeJsonSource(large, receipt(large), valid),
      undefined,
    );
  });
});
