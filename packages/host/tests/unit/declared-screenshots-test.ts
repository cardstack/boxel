import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPIModule from '@cardstack/base/card-api';
import type { ScreenshotSpec } from '@cardstack/base/card-api';

type Screenshots = Record<string, ScreenshotSpec>;

module('Unit | declared screenshots', function (hooks) {
  setupRenderingTest(hooks);

  let cardApi: typeof CardAPIModule;
  hooks.beforeEach(async function () {
    let loader: Loader = getService('loader-service').loader;
    cardApi = await loader.import<typeof CardAPIModule>(
      '@cardstack/base/card-api',
    );
  });

  test('a card with no declarations merges to an empty record', function (assert) {
    class Plain extends cardApi.CardDef {}
    assert.deepEqual(cardApi.getScreenshots(Plain), {});
    assert.deepEqual(cardApi.getScreenshots(cardApi.CardDef), {});
    assert.deepEqual(cardApi.getScreenshots(cardApi.FileDef), {});
  });

  test('declarations on one class are returned by name', function (assert) {
    class HeroShot extends cardApi.Component<typeof cardApi.CardDef> {}
    class Product extends cardApi.CardDef {
      static screenshots: Screenshots = {
        hero: {
          render: HeroShot,
          width: 1200,
          height: 630,
          background: 'white',
        },
        thumb: {
          format: 'fitted',
          width: 300,
          height: 200,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
      };
    }
    let merged = cardApi.getScreenshots(Product);
    assert.deepEqual(Object.keys(merged).sort(), ['hero', 'thumb']);
    assert.strictEqual(merged.hero.render, HeroShot);
    assert.strictEqual(merged.thumb.format, 'fitted');
    assert.true(merged.thumb.useAsThumbnail);
  });

  test('a subclass adds new names and inherits ancestors up the chain', function (assert) {
    class Video extends cardApi.FileDef {
      static screenshots: Screenshots = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          keyBy: 'file-content',
          type: 'jpeg',
        },
      };
    }
    class Trailer extends Video {
      static screenshots: Screenshots = {
        banner: { format: 'embedded', width: 1024, height: 256 },
      };
    }
    class TeaserTrailer extends Trailer {
      static screenshots: Screenshots = {
        teaser: { format: 'fitted', width: 150, height: 170 },
      };
    }
    // a plain property read sees only the nearest declaration…
    assert.deepEqual(Object.keys(TeaserTrailer.screenshots!), ['teaser']);
    // …while the merge helper sees the whole chain
    let merged = cardApi.getScreenshots(TeaserTrailer);
    assert.deepEqual(Object.keys(merged).sort(), [
      'banner',
      'poster',
      'teaser',
    ]);
    assert.strictEqual(merged.poster.keyBy, 'file-content');
  });

  test('a subclass overrides an inherited name wholesale', function (assert) {
    class Video extends cardApi.FileDef {
      static screenshots: Screenshots = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          type: 'jpeg',
        },
      };
    }
    class Widescreen extends Video {
      static screenshots: Screenshots = {
        poster: { format: 'embedded', width: 1280, height: 720 },
      };
    }
    let merged = cardApi.getScreenshots(Widescreen);
    assert.strictEqual(merged.poster.width, 1280);
    // the override replaces the whole spec: the ancestor's `type` does not
    // bleed through
    assert.strictEqual(merged.poster.type, undefined);
  });

  test('a name outside the URL-safe charset is refused', function (assert) {
    for (const name of ['og image', 'og/image', '../poster', '-leading', '']) {
      class Bad extends cardApi.CardDef {
        static screenshots: Screenshots = {
          [name]: { format: 'fitted', width: 300, height: 200 },
        };
      }
      assert.throws(
        () => cardApi.getScreenshots(Bad),
        /name must be a URL-safe path segment/,
        `"${name}" is refused`,
      );
    }
    class TooLong extends cardApi.CardDef {
      static screenshots: Screenshots = {
        ['a'.repeat(65)]: { format: 'fitted', width: 300, height: 200 },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(TooLong),
      /name must be a URL-safe path segment/,
    );
  });

  test('declaring both or neither of render and format is refused', function (assert) {
    class Shot extends cardApi.Component<typeof cardApi.CardDef> {}
    class Both extends cardApi.CardDef {
      static screenshots: Record<string, any> = {
        hero: { render: Shot, format: 'fitted', width: 300, height: 200 },
      };
    }
    class Neither extends cardApi.CardDef {
      static screenshots: Record<string, any> = {
        hero: { width: 300, height: 200 },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(Both),
      /declare exactly one of render or format/,
    );
    assert.throws(
      () => cardApi.getScreenshots(Neither),
      /declare exactly one of render or format/,
    );
  });

  test('formats outside the declared-screenshot roster are refused', function (assert) {
    for (const format of ['edit', 'head', 'markdown', 'bogus']) {
      class Bad extends cardApi.CardDef {
        static screenshots: Record<string, any> = {
          shot: { format, width: 300, height: 200 },
        };
      }
      assert.throws(
        () => cardApi.getScreenshots(Bad),
        /format must be one of/,
        `"${format}" is refused`,
      );
    }
  });

  test('unknown spec fields are refused by name', function (assert) {
    class Bad extends cardApi.CardDef {
      static screenshots: Record<string, any> = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          useAsThumbnal: true,
        },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(Bad),
      /unknown field "useAsThumbnal"/,
    );
  });

  test('capture-box dimensions must be positive integers within the engine caps', function (assert) {
    for (let [field, value] of [
      ['width', 0],
      ['width', -100],
      ['width', 12.5],
      ['width', 5000],
      ['height', 20000],
      ['height', undefined],
    ] as const) {
      class Bad extends cardApi.CardDef {
        static screenshots: Record<string, any> = {
          shot: { format: 'fitted', width: 300, height: 200, [field]: value },
        };
      }
      assert.throws(
        () => cardApi.getScreenshots(Bad),
        new RegExp(`${field} must be an integer between`),
        `${field}=${value} is refused`,
      );
    }
    class BadDsf extends cardApi.CardDef {
      static screenshots: Record<string, any> = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          deviceScaleFactor: 4,
        },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(BadDsf),
      /deviceScaleFactor must be a number/,
    );
  });

  test('keyBy and type are constrained to their rosters', function (assert) {
    class BadKeyBy extends cardApi.CardDef {
      static screenshots: Record<string, any> = {
        shot: { format: 'fitted', width: 300, height: 200, keyBy: 'mtime' },
      };
    }
    class BadType extends cardApi.CardDef {
      static screenshots: Record<string, any> = {
        shot: { format: 'fitted', width: 300, height: 200, type: 'gif' },
      };
    }
    assert.throws(() => cardApi.getScreenshots(BadKeyBy), /keyBy must be one/);
    assert.throws(() => cardApi.getScreenshots(BadType), /type must be one/);
  });

  test('more than one useAsThumbnail across the merged chain is refused', function (assert) {
    class Video extends cardApi.FileDef {
      static screenshots: Screenshots = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          useAsThumbnail: true,
        },
      };
    }
    class Trailer extends Video {
      static screenshots: Screenshots = {
        banner: {
          format: 'embedded',
          width: 1024,
          height: 256,
          useAsThumbnail: true,
        },
      };
    }
    // the chain is fine per level…
    assert.strictEqual(
      Object.keys(cardApi.getScreenshots(Video)).length,
      1,
      'base class alone is valid',
    );
    // …but the merged result has two thumbnail feeds
    assert.throws(
      () => cardApi.getScreenshots(Trailer),
      /more than one useAsThumbnail screenshot \("poster", "banner"\)/,
    );
  });

  test('two useAsThumbnail entries on one class are refused', function (assert) {
    class Bad extends cardApi.CardDef {
      static screenshots: Screenshots = {
        a: { format: 'fitted', width: 300, height: 200, useAsThumbnail: true },
        b: {
          format: 'embedded',
          width: 300,
          height: 200,
          useAsThumbnail: true,
        },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(Bad),
      /more than one useAsThumbnail/,
    );
  });

  test('overriding an inherited entry by name can move the thumbnail', function (assert) {
    class Video extends cardApi.FileDef {
      static screenshots: Screenshots = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          useAsThumbnail: true,
        },
      };
    }
    class Trailer extends Video {
      static screenshots: Screenshots = {
        // clear the inherited flag by overriding the entry…
        poster: { format: 'embedded', width: 640, height: 360 },
        // …so the new entry can carry it
        banner: {
          format: 'embedded',
          width: 1024,
          height: 256,
          useAsThumbnail: true,
        },
      };
    }
    let merged = cardApi.getScreenshots(Trailer);
    assert.strictEqual(merged.poster.useAsThumbnail, undefined);
    assert.true(merged.banner.useAsThumbnail);
  });

  test('a non-object declarations value is refused', function (assert) {
    class Bad extends cardApi.CardDef {
      static screenshots: any = ['nope'];
    }
    assert.throws(
      () => cardApi.getScreenshots(Bad),
      /must be an object mapping names to specs/,
    );
  });
});
