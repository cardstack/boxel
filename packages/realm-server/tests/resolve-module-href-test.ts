import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { resolveModuleHref } from '@cardstack/runtime-common/code-ref';

const relativeTo = new URL('http://test/realm/consumer.gts');

module(basename(import.meta.filename), function () {
  module('resolveModuleHref', function () {
    test('passes a scoped reference through unchanged', function (assert) {
      assert.strictEqual(
        resolveModuleHref('@cardstack/base/card-api', relativeTo),
        '@cardstack/base/card-api',
      );
    });

    test('passes a scoped reference through even with no registered prefix', function (assert) {
      // A scoped reference is absolute and cross-realm by construction, so it
      // resolves without asking whether this process knows the realm. An
      // unresolvable one fails at fetch, naming what the caller wrote.
      assert.strictEqual(
        resolveModuleHref('@nobody/knows-this/thing', relativeTo),
        '@nobody/knows-this/thing',
      );
    });

    test('joins a relative reference against the consumer', function (assert) {
      assert.strictEqual(
        resolveModuleHref('./person', relativeTo),
        'http://test/realm/person',
      );
      assert.strictEqual(
        resolveModuleHref('../shared/person', relativeTo),
        'http://test/shared/person',
      );
    });

    test('passes an absolute URL through unchanged', function (assert) {
      assert.strictEqual(
        resolveModuleHref('http://elsewhere/other/person', relativeTo),
        'http://elsewhere/other/person',
      );
    });

    test('rejects a bare package specifier', function (assert) {
      // Recognised by shape rather than by a registry lookup: neither
      // URL-like nor scoped. Without this a bare name would silently join
      // against the consumer and fetch a URL nobody wrote.
      assert.throws(
        () => resolveModuleHref('lodash', relativeTo),
        /bare package specifier "lodash"/,
      );
    });

    test('needs no relativeTo for an already-absolute reference', function (assert) {
      assert.strictEqual(
        resolveModuleHref('@cardstack/base/string', undefined),
        '@cardstack/base/string',
      );
    });
  });
});
