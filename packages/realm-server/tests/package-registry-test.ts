import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  DEFAULT_COOLDOWN_DAYS,
  checkPublish,
} from '../lib/package-registry.ts';

// A fixed clock. `now` is an argument to checkPublish precisely so these
// assertions do not drift into flakiness at midnight or on a slow runner.
const NOW = new Date('2026-08-09T12:00:00Z');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function metaWith(version: string, treeHash: string) {
  return { versions: { [version]: { treeHash } } };
}

module(basename(import.meta.filename), function () {
  module('checkPublish', function () {
    test('a new version of a valid package is allowed', function (assert) {
      let verdict = checkPublish({
        name: 'lib/three',
        version: '0.169.0',
        treeHash: HASH_A,
        now: NOW,
      });
      assert.deepEqual(verdict, { kind: 'ok', reason: 'new-version' });
    });

    test('republishing identical bytes is a no-op, not an error', function (assert) {
      // Re-running a vendor script must not fail. If it did, the pressure
      // would be to add a --force, which is how the immutability rule below
      // gets bypassed in practice.
      let verdict = checkPublish({
        name: 'lib/three',
        version: '0.169.0',
        treeHash: HASH_A,
        meta: metaWith('0.169.0', HASH_A),
        now: NOW,
      });
      assert.deepEqual(verdict, { kind: 'ok', reason: 'identical-republish' });
    });

    test('republishing a version with different bytes is refused (L4)', function (assert) {
      let verdict = checkPublish({
        name: 'lib/three',
        version: '0.169.0',
        treeHash: HASH_B,
        meta: metaWith('0.169.0', HASH_A),
        now: NOW,
      });
      assert.strictEqual(verdict.kind, 'refused');
      assert.strictEqual(
        verdict.kind === 'refused' ? verdict.code : undefined,
        'tree-hash-mismatch',
      );
      // The message has to name both hashes: whoever hits this needs to know
      // which bytes are already published, not just that something clashed.
      let detail = verdict.kind === 'refused' ? verdict.detail : '';
      assert.true(detail.includes(HASH_A), 'names the published treeHash');
      assert.true(detail.includes(HASH_B), 'names the rejected treeHash');
    });

    test('a range or dist-tag is not a publishable version', function (assert) {
      for (let version of ['^1.0.0', 'latest', '1.x', '', 'v1.0.0']) {
        let verdict = checkPublish({
          name: 'lib/three',
          version,
          treeHash: HASH_A,
          now: NOW,
        });
        assert.strictEqual(
          verdict.kind === 'refused' ? verdict.code : verdict.kind,
          'invalid-version',
          `refused: ${JSON.stringify(version)}`,
        );
      }
    });

    test('a malformed package name is refused', function (assert) {
      for (let name of [
        'Lib/Three',
        'a/b/c',
        '-leading-hyphen',
        'lib/three@0.1.0',
        '',
      ]) {
        let verdict = checkPublish({
          name,
          version: '1.0.0',
          treeHash: HASH_A,
          now: NOW,
        });
        assert.strictEqual(
          verdict.kind === 'refused' ? verdict.code : verdict.kind,
          'invalid-name',
          `refused: ${JSON.stringify(name)}`,
        );
      }
    });

    test('a version published upstream inside the cooldown is refused', function (assert) {
      let verdict = checkPublish({
        name: 'lib/three',
        version: '0.169.0',
        treeHash: HASH_A,
        upstreamPublishedAt: '2026-08-09T06:00:00Z', // 6h before NOW
        now: NOW,
      });
      assert.strictEqual(
        verdict.kind === 'refused' ? verdict.code : verdict.kind,
        'cooldown',
      );
    });

    test('a version older than the cooldown is allowed', function (assert) {
      let verdict = checkPublish({
        name: 'lib/three',
        version: '0.169.0',
        treeHash: HASH_A,
        upstreamPublishedAt: '2026-08-01T12:00:00Z',
        now: NOW,
      });
      assert.deepEqual(verdict, { kind: 'ok', reason: 'new-version' });
    });

    test('an unknown upstream date skips the cooldown; an unparseable one does not', function (assert) {
      // Absent is honest ignorance — vendoring from a source with no
      // timestamp must stay possible.
      assert.deepEqual(
        checkPublish({
          name: 'lib/three',
          version: '0.169.0',
          treeHash: HASH_A,
          now: NOW,
        }),
        { kind: 'ok', reason: 'new-version' },
        'absent timestamp does not block',
      );
      // Garbage claiming to be a timestamp is different: treating it as
      // absent would make a malformed field a silent bypass.
      let verdict = checkPublish({
        name: 'lib/three',
        version: '0.169.0',
        treeHash: HASH_A,
        upstreamPublishedAt: 'yesterday',
        now: NOW,
      });
      assert.strictEqual(
        verdict.kind === 'refused' ? verdict.code : verdict.kind,
        'cooldown',
        'unparseable timestamp is refused, not ignored',
      );
    });

    test('the immutability check runs before the cooldown', function (assert) {
      // Ordering matters for the message a caller sees. A treeHash swap on a
      // freshly published version is an immutability problem; reporting it as
      // "try again in 18h" would send them back to do exactly the wrong thing.
      let verdict = checkPublish({
        name: 'lib/three',
        version: '0.169.0',
        treeHash: HASH_B,
        meta: metaWith('0.169.0', HASH_A),
        upstreamPublishedAt: '2026-08-09T06:00:00Z',
        now: NOW,
      });
      assert.strictEqual(
        verdict.kind === 'refused' ? verdict.code : verdict.kind,
        'tree-hash-mismatch',
      );
    });

    test('cooldownDays: 0 disables the policy', function (assert) {
      assert.deepEqual(
        checkPublish({
          name: 'lib/three',
          version: '0.169.0',
          treeHash: HASH_A,
          upstreamPublishedAt: NOW.toISOString(),
          now: NOW,
          cooldownDays: 0,
        }),
        { kind: 'ok', reason: 'new-version' },
      );
      assert.strictEqual(DEFAULT_COOLDOWN_DAYS, 1, 'default stays a day');
    });
  });
});
