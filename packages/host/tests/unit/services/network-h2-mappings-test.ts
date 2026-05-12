import { module, test } from 'qunit';

import { parseH2OriginMappings } from '@cardstack/host/services/network';

module('Unit | Service | network | parseH2OriginMappings', function () {
  test('returns [] when input is undefined', function (assert) {
    assert.deepEqual(parseH2OriginMappings(undefined), []);
  });

  test('returns [] when input is the empty string', function (assert) {
    assert.deepEqual(parseH2OriginMappings(''), []);
  });

  test('returns [] when input is not valid JSON', function (assert) {
    assert.deepEqual(parseH2OriginMappings('not-json'), []);
  });

  test('returns [] when JSON parses to a non-array', function (assert) {
    assert.deepEqual(parseH2OriginMappings('{"from":"x","to":"y"}'), []);
  });

  test('accepts a single well-formed loopback https mapping', function (assert) {
    let raw = JSON.stringify([
      { from: 'http://localhost:4201', to: 'https://localhost:4203' },
    ]);
    let result = parseH2OriginMappings(raw);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].from.origin, 'http://localhost:4201');
    assert.strictEqual(result[0].to.origin, 'https://localhost:4203');
  });

  test('accepts multiple mappings and preserves order', function (assert) {
    let raw = JSON.stringify([
      { from: 'http://localhost:4201', to: 'https://localhost:4203' },
      { from: 'http://localhost:4202', to: 'https://localhost:4204' },
    ]);
    let result = parseH2OriginMappings(raw);
    assert.deepEqual(
      result.map((m) => [m.from.origin, m.to.origin]),
      [
        ['http://localhost:4201', 'https://localhost:4203'],
        ['http://localhost:4202', 'https://localhost:4204'],
      ],
    );
  });

  test('accepts 127.0.0.1 and ::1 as loopback destinations', function (assert) {
    let raw = JSON.stringify([
      { from: 'http://localhost:4201', to: 'https://127.0.0.1:4203' },
      { from: 'http://localhost:4202', to: 'https://[::1]:4204' },
    ]);
    assert.strictEqual(parseH2OriginMappings(raw).length, 2);
  });

  test('rejects a destination on a non-loopback hostname', function (assert) {
    let raw = JSON.stringify([
      { from: 'http://localhost:4201', to: 'https://example.com:4203' },
    ]);
    assert.deepEqual(parseH2OriginMappings(raw), []);
  });

  test('rejects a destination with http scheme', function (assert) {
    let raw = JSON.stringify([
      { from: 'http://localhost:4201', to: 'http://localhost:4203' },
    ]);
    assert.deepEqual(parseH2OriginMappings(raw), []);
  });

  test('skips malformed entries but keeps valid ones', function (assert) {
    let raw = JSON.stringify([
      { from: 'not-a-url', to: 'https://localhost:4203' },
      { from: 'http://localhost:4201', to: 'https://localhost:4203' },
      'unstructured',
      { from: 'http://localhost:4202', to: 'https://example.com:4204' },
      { from: 'http://localhost:4202', to: 'https://localhost:4204' },
    ]);
    let result = parseH2OriginMappings(raw);
    assert.deepEqual(
      result.map((m) => [m.from.origin, m.to.origin]),
      [
        ['http://localhost:4201', 'https://localhost:4203'],
        ['http://localhost:4202', 'https://localhost:4204'],
      ],
    );
  });

  test('skips entries whose from and to share an origin', function (assert) {
    let raw = JSON.stringify([
      { from: 'https://localhost:4203', to: 'https://localhost:4203' },
    ]);
    assert.deepEqual(parseH2OriginMappings(raw), []);
  });
});
