import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  canonicalRRIImportMap,
  isExactVersionRRI,
  parseRRI,
  projectRRIImportMap,
  resolveRRI,
  resolveRRIReference,
  rri,
  type RRIImportMap,
} from '../src/rri.ts';
import { hashProtocolObject, type JsonValue } from '../src/repository.ts';

module('Realm Resource Identifiers', function () {
  test('parses mutable and exact Version RRIs', function (assert) {
    assert.deepEqual(parseRRI('@acme/gallery/scene.gts'), {
      scope: 'acme',
      name: 'gallery',
      path: 'scene.gts',
      root: '@acme/gallery/',
    });
    assert.true(
      isExactVersionRRI('@catalog/three@0.169.0/build/three.module.js'),
    );
    assert.false(isExactVersionRRI('@acme/gallery/'));
  });

  test('resolves relative references without entering URL space', function (assert) {
    assert.strictEqual(
      resolveRRIReference('../theme', '@acme/gallery/components/card.gts'),
      '@acme/gallery/theme',
    );
    assert.throws(
      () =>
        resolveRRIReference(
          '$REALM/theme',
          '@acme/gallery/components/card.gts',
        ),
      /\$REALM is not part of the Deck RRI protocol/,
    );
  });

  test('rejects URL-form identity instead of carrying compatibility logic', function (assert) {
    assert.throws(
      () => rri('https://example.test/acme/gallery/scene'),
      /URL-form identity/,
    );
  });

  test('one lock resolves different exact Versions by importer RRI', function (assert) {
    let lock: RRIImportMap = {
      imports: { three: rri('@catalog/three@0.169.0/build/three.module.js') },
      scopes: {
        '@acme/gallery/legacy-viewer/': {
          three: rri('@catalog/three@0.160.0/build/three.module.js'),
        },
      },
    };
    assert.strictEqual(
      resolveRRI({
        ...lock,
        specifier: 'three',
        fromRRI: '@acme/gallery/scene.gts',
      }),
      '@catalog/three@0.169.0/build/three.module.js',
    );
    assert.strictEqual(
      resolveRRI({
        ...lock,
        specifier: 'three',
        fromRRI: '@acme/gallery/legacy-viewer/scene.gts',
      }),
      '@catalog/three@0.160.0/build/three.module.js',
    );
  });

  test('canonical locks accept only RRIs and RRI-relative targets', function (assert) {
    assert.deepEqual(
      canonicalRRIImportMap(
        {
          imports: {
            editor: '@acme/editor@1.4.0/index.js',
            theme: '@acme/theme@2.1.0/index.js',
            local: './local.js',
          },
          scopes: {
            '@acme/dashboard/legacy/': {
              theme: '@acme/theme@1.9.0/index.js',
            },
          },
        },
        { relativeTo: '@acme/dashboard/' },
      ),
      {
        imports: {
          editor: '@acme/editor@1.4.0/index.js',
          theme: '@acme/theme@2.1.0/index.js',
          local: '@acme/dashboard/local.js',
        },
        scopes: {
          '@acme/dashboard/legacy/': {
            theme: '@acme/theme@1.9.0/index.js',
          },
        },
      } as unknown as RRIImportMap,
    );
    assert.throws(
      () =>
        canonicalRRIImportMap(
          {
            imports: { theme: 'https://deck.example/site/acme/theme/index.js' },
          },
          { relativeTo: '@acme/dashboard/' },
        ),
      /canonical Deck locks require RRI targets/,
    );
    assert.throws(
      () =>
        canonicalRRIImportMap(
          { imports: { theme: '/site/acme/theme/index.js' } },
          { relativeTo: '@acme/dashboard/' },
        ),
      /canonical Deck locks require RRI targets/,
    );
  });

  test('transport projection changes URLs without changing canonical lock identity', function (assert) {
    let lock: RRIImportMap = {
      imports: { three: rri('@catalog/three@0.169.0/build/three.module.js') },
      scopes: {
        '@acme/gallery/': {
          theme: rri('@catalog/theme@2.0.0/index.js'),
        },
      },
    };
    let before = hashProtocolObject(lock as unknown as JsonValue);
    let local = projectRRIImportMap(
      lock,
      (id) => `http://localhost:8788/rri/${id}`,
    );
    let hosted = projectRRIImportMap(
      lock,
      (id) => `https://app.boxel.ai/rri/${id}`,
    );
    assert.notDeepEqual(local, hosted);
    assert.strictEqual(
      hashProtocolObject(lock as unknown as JsonValue),
      before,
    );
    assert.strictEqual(
      local.scopes['http://localhost:8788/rri/@acme/gallery/']?.theme,
      'http://localhost:8788/rri/@catalog/theme@2.0.0/index.js',
    );
  });
});
