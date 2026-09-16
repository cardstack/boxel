import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { md5 } from 'super-fast-md5';
import { encodeHashedScopedCSSRequest } from '@cardstack/runtime-common/scoped-css';
import { resolveScopedCSSFromDeps } from '../lib/retrieve-scoped-css.ts';

function scopedCSSDep(moduleId: string, css: string): string {
  let encoded = Buffer.from(css, 'utf8').toString('base64');
  return `${moduleId}.${encoded}.glimmer-scoped.css`;
}

function hashedScopedCSSDep(moduleId: string, css: string): string {
  return encodeHashedScopedCSSRequest(moduleId, md5(css));
}

function tableLookup(cssBlocks: string[]) {
  let table = new Map(cssBlocks.map((css) => [md5(css), css]));
  return async (hashes: string[]) =>
    new Map(
      hashes
        .filter((hash) => table.has(hash))
        .map((hash) => [hash, table.get(hash)!]),
    );
}

const noLookup = async (_hashes: string[]) => new Map<string, string>();

module(basename(import.meta.filename), function () {
  module('resolveScopedCSSFromDeps', function () {
    test('decodes inline scoped CSS from an absolute URL dep', async function (assert) {
      let deps = [
        'https://example.com/realm/card.gts',
        scopedCSSDep(
          'https://example.com/realm/card.gts',
          '.marker { color: red; }',
        ),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(deps, noLookup),
        '.marker { color: red; }',
      );
    });

    test('decodes inline scoped CSS from a prefix-form RRI dep', async function (assert) {
      let deps = [
        '@cardstack/base/card-api',
        scopedCSSDep('@cardstack/base/card-api.gts', '.field { top: 0; }'),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(deps, noLookup),
        '.field { top: 0; }',
      );
    });

    test('combines inline CSS from mixed absolute and prefix-form deps', async function (assert) {
      let deps = [
        scopedCSSDep('@cardstack/base/card-api.gts', '.base { top: 0; }'),
        scopedCSSDep(
          'https://example.com/realm/card.gts',
          '.local { left: 0; }',
        ),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(deps, noLookup),
        '.base { top: 0; }\n.local { left: 0; }',
      );
    });

    test('resolves hashed deps through the lookup', async function (assert) {
      let deps = [
        hashedScopedCSSDep(
          'https://example.com/realm/card.gts',
          '.hashed { color: blue; }',
        ),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(
          deps,
          tableLookup(['.hashed { color: blue; }']),
        ),
        '.hashed { color: blue; }',
      );
    });

    test('resolves hashed prefix-form RRI deps through the lookup', async function (assert) {
      let deps = [
        hashedScopedCSSDep(
          '@cardstack/base/card-api.gts',
          '.field { top: 0; }',
        ),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(
          deps,
          tableLookup(['.field { top: 0; }']),
        ),
        '.field { top: 0; }',
      );
    });

    test('combines inline and hashed deps in dep order', async function (assert) {
      let deps = [
        scopedCSSDep('@cardstack/base/a.gts', '.inline { top: 0; }'),
        hashedScopedCSSDep(
          'https://example.com/realm/card.gts',
          '.hashed { left: 0; }',
        ),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(
          deps,
          tableLookup(['.hashed { left: 0; }']),
        ),
        '.inline { top: 0; }\n.hashed { left: 0; }',
      );
    });

    test('deduplicates identical CSS across inline and hashed forms', async function (assert) {
      let deps = [
        scopedCSSDep('@cardstack/base/a.gts', '.dup { top: 0; }'),
        hashedScopedCSSDep('@cardstack/base/b.gts', '.dup { top: 0; }'),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(deps, tableLookup(['.dup { top: 0; }'])),
        '.dup { top: 0; }',
      );
    });

    test('skips hashed deps the lookup no longer holds', async function (assert) {
      let deps = [
        scopedCSSDep('@cardstack/base/a.gts', '.kept { top: 0; }'),
        hashedScopedCSSDep('@cardstack/base/b.gts', '.gone { left: 0; }'),
      ];
      assert.strictEqual(
        await resolveScopedCSSFromDeps(deps, noLookup),
        '.kept { top: 0; }',
      );
    });

    test('returns null when no dep carries scoped CSS', async function (assert) {
      let deps = [
        'https://example.com/realm/card.gts',
        '@cardstack/base/card-api',
      ];
      assert.strictEqual(await resolveScopedCSSFromDeps(deps, noLookup), null);
    });

    test('returns null when only hashed deps exist and none resolve', async function (assert) {
      let deps = [
        hashedScopedCSSDep('@cardstack/base/a.gts', '.x { top: 0; }'),
      ];
      assert.strictEqual(await resolveScopedCSSFromDeps(deps, noLookup), null);
    });
  });
});
