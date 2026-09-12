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

    // There is no bare-specifier category to reject: `isRelativePath` treats
    // any non-scoped, non-URL identifier as relative, so a bare name is
    // indistinguishable in shape from a module in this realm. One that names
    // nothing resolves here and fails at fetch.
    test('joins a bare name against the consumer, like any relative reference', function (assert) {
      assert.strictEqual(
        resolveModuleHref('garden-design', relativeTo),
        'http://test/realm/garden-design',
      );
      assert.strictEqual(
        resolveModuleHref('lodash', relativeTo),
        'http://test/realm/lodash',
      );
    });

    test('passes a non-http absolute scheme through unchanged', function (assert) {
      for (let ref of [
        'data:text/javascript,export default 1',
        'blob:http://test/8f2c',
      ]) {
        assert.strictEqual(resolveModuleHref(ref, relativeTo), ref);
      }
    });

    test('needs no relativeTo for an already-absolute reference', function (assert) {
      assert.strictEqual(
        resolveModuleHref('@cardstack/base/string', undefined),
        '@cardstack/base/string',
      );
    });
  });
});
