import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { decodeScopedCSSFromDeps } from '../lib/retrieve-scoped-css.ts';

function scopedCSSDep(moduleId: string, css: string): string {
  let encoded = Buffer.from(css, 'utf8').toString('base64');
  return `${moduleId}.${encoded}.glimmer-scoped.css`;
}

module(basename(import.meta.filename), function () {
  module('decodeScopedCSSFromDeps', function () {
    test('decodes scoped CSS from an absolute URL dep', function (assert) {
      let deps = [
        'https://example.com/realm/card.gts',
        scopedCSSDep(
          'https://example.com/realm/card.gts',
          '.marker { color: red; }',
        ),
      ];
      assert.strictEqual(
        decodeScopedCSSFromDeps(deps),
        '.marker { color: red; }',
      );
    });

    test('decodes scoped CSS from a prefix-form RRI dep', function (assert) {
      let deps = [
        '@cardstack/base/card-api',
        scopedCSSDep('@cardstack/base/card-api.gts', '.field { top: 0; }'),
      ];
      assert.strictEqual(decodeScopedCSSFromDeps(deps), '.field { top: 0; }');
    });

    test('combines CSS from mixed absolute and prefix-form deps', function (assert) {
      let deps = [
        scopedCSSDep('@cardstack/base/card-api.gts', '.base { top: 0; }'),
        scopedCSSDep(
          'https://example.com/realm/card.gts',
          '.local { left: 0; }',
        ),
      ];
      assert.strictEqual(
        decodeScopedCSSFromDeps(deps),
        '.base { top: 0; }\n.local { left: 0; }',
      );
    });

    test('deduplicates identical CSS blocks', function (assert) {
      let deps = [
        scopedCSSDep('@cardstack/base/a.gts', '.dup { top: 0; }'),
        scopedCSSDep('@cardstack/base/b.gts', '.dup { top: 0; }'),
      ];
      assert.strictEqual(decodeScopedCSSFromDeps(deps), '.dup { top: 0; }');
    });

    test('returns null when no dep carries scoped CSS', function (assert) {
      let deps = [
        'https://example.com/realm/card.gts',
        '@cardstack/base/card-api',
      ];
      assert.strictEqual(decodeScopedCSSFromDeps(deps), null);
    });
  });
});
