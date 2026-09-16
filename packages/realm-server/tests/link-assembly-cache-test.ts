import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  LinkAssemblyCache,
  type LinkAssemblyCacheSummary,
  type LinkAssemblyKey,
  type ScreenshotManifest,
} from '@cardstack/runtime-common';

const target = 'http://localhost:4202/test/staff/dr-patel';

function key(overrides?: Partial<LinkAssemblyKey>): LinkAssemblyKey {
  return {
    canonicalURL: target,
    indexedAt: 100,
    generation: 7,
    screenshots: null,
    skipQueryBackedExpansion: false,
    ...overrides,
  };
}

// The manifest travels on the prerendered_html channel, which `indexed_at`
// does not follow — so it has to say for itself when the served
// `meta.screenshots` changed.
function manifest(objectKey: string): ScreenshotManifest {
  return {
    'hero.png': {
      specHash: 'spec-1',
      objectKey,
      contentType: 'image/png',
      width: 100,
      height: 100,
      deviceScaleFactor: 1,
    },
  };
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

module(basename(import.meta.filename), function () {
  module('LinkAssemblyCache', function () {
    test('a resource one search assembled is readable by the next', function (assert) {
      let cache = new LinkAssemblyCache({ telemetryIntervalMs: 0 });

      assert.strictEqual(
        cache.get(key()),
        undefined,
        'nothing is held before the first assembly',
      );
      cache.set(key(), '{"id":"dr-patel"}');

      assert.strictEqual(
        cache.get(key()),
        '{"id":"dr-patel"}',
        'the second search reads the first search’s bytes',
      );
      assert.strictEqual(cache.stats.hits, 1, 'one assembly was spared');
      assert.strictEqual(cache.stats.misses, 1, 'and one was paid — the first');
    });

    // The freshness device, and the whole reason a TTL is not what bounds
    // staleness here: a re-indexed row carries a different fingerprint, which
    // is a different key, so the resource assembled under the old one is
    // unreachable. Nothing evicts it.
    test('each component of the row fingerprint makes the previous assembly unreachable', function (assert) {
      let rotations: [string, Partial<LinkAssemblyKey>][] = [
        ['a dependency-cascaded or direct write', { indexedAt: 101 }],
        ['a new index generation', { generation: 8 }],
        [
          'a declared-screenshot manifest landing on the other channel',
          { screenshots: manifest('abc123') },
        ],
        [
          'a walk that expands different links',
          { skipQueryBackedExpansion: true },
        ],
      ];

      for (let [what, rotated] of rotations) {
        let cache = new LinkAssemblyCache({ telemetryIntervalMs: 0 });
        cache.set(key(), 'before');
        assert.strictEqual(
          cache.get(key(rotated)),
          undefined,
          `${what} is not answered from the previous assembly`,
        );
        assert.strictEqual(
          cache.get(key()),
          'before',
          `${what} leaves the entry it did not describe alone`,
        );
      }
    });

    test('an entry past its retention window is not served, and says why it missed', async function (assert) {
      let cache = new LinkAssemblyCache({ ttlMs: 20, telemetryIntervalMs: 0 });
      cache.set(key(), 'assembled');
      assert.strictEqual(cache.get(key()), 'assembled', 'held inside the TTL');

      await sleep(40);

      assert.strictEqual(cache.get(key()), undefined, 'not held past it');
      assert.strictEqual(
        cache.stats.missesKeyExpired,
        1,
        'the miss is attributed to retention rather than to a key never stored',
      );
      assert.strictEqual(cache.stats.entryCount, 0, 'and the entry is gone');
    });

    test('retention off keeps the cache readable and holds nothing', function (assert) {
      let cache = new LinkAssemblyCache({ ttlMs: 0, telemetryIntervalMs: 0 });
      cache.set(key(), 'assembled');

      assert.strictEqual(
        cache.get(key()),
        undefined,
        'a search with retention off assembles for itself',
      );
      assert.strictEqual(cache.stats.entryCount, 0, 'nothing is retained');
    });

    test('the byte cap evicts least-recently-used assemblies rather than growing', function (assert) {
      let cache = new LinkAssemblyCache({
        maxBytes: 20,
        telemetryIntervalMs: 0,
      });
      let a = key({ canonicalURL: `${target}-a` });
      let b = key({ canonicalURL: `${target}-b` });
      let c = key({ canonicalURL: `${target}-c` });

      cache.set(a, '0123456789');
      cache.set(b, '0123456789');
      // Make `a` the more recently used of the two before the cap bites.
      assert.strictEqual(cache.get(a), '0123456789', 'a is read');
      cache.set(c, '0123456789');

      assert.true(cache.stats.sizeBytes <= 20, 'the cap holds');
      assert.strictEqual(
        cache.get(b),
        undefined,
        'the least recently used assembly is the one dropped',
      );
      assert.strictEqual(cache.get(a), '0123456789', 'the other is kept');
      assert.strictEqual(cache.stats.evicted, 1, 'and the drop is counted');
    });

    test('an assembly larger than the whole cap is refused rather than emptying it', function (assert) {
      let cache = new LinkAssemblyCache({
        maxBytes: 8,
        telemetryIntervalMs: 0,
      });
      cache.set(key(), 'this resource is far larger than the cap');

      assert.strictEqual(cache.get(key()), undefined, 'it is not held');
      assert.strictEqual(cache.stats.oversized, 1, 'and it is counted as such');
      assert.strictEqual(cache.stats.sizeBytes, 0, 'the cache stays empty');
    });

    test('the telemetry summary reports what the window spared', async function (assert) {
      let summaries: LinkAssemblyCacheSummary[] = [];
      let cache = new LinkAssemblyCache({
        telemetryIntervalMs: 1,
        emitTelemetry: (summary) => summaries.push(summary),
      });

      cache.set(key(), 'assembled');
      await sleep(5);
      cache.get(key());
      cache.get(key({ indexedAt: 999 }));

      assert.ok(summaries.length > 0, 'a summary was emitted');
      let latest = summaries[summaries.length - 1];
      assert.strictEqual(latest.event_type, 'summary', 'on the summary shape');
      assert.ok(
        latest.hits + latest.misses > 0,
        'carrying the window’s outcomes',
      );
    });
  });
});
