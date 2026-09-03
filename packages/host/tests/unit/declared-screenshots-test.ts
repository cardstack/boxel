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

  test('each edge × deviceScaleFactor must fit the physical-pixel cap', function (assert) {
    // in-cap CSS height, but the default 2× scale puts it past the
    // 16384-physical-px texture cap
    class ImplicitScale extends cardApi.CardDef {
      static screenshots: Screenshots = {
        tall: { format: 'fitted', width: 300, height: 16384 },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(ImplicitScale),
      /height × deviceScaleFactor must be <= 16384 physical pixels/,
    );
    class ExplicitScale extends cardApi.CardDef {
      static screenshots: Screenshots = {
        tall: {
          format: 'fitted',
          width: 300,
          height: 8192,
          deviceScaleFactor: 3,
        },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(ExplicitScale),
      /height × deviceScaleFactor must be <= 16384 physical pixels/,
    );
    // at the cap exactly, both implicitly and explicitly scaled
    class AtCap extends cardApi.CardDef {
      static screenshots: Screenshots = {
        implicit: { format: 'fitted', width: 300, height: 8192 },
        explicit: {
          format: 'fitted',
          width: 300,
          height: 16384,
          deviceScaleFactor: 1,
        },
      };
    }
    assert.deepEqual(Object.keys(cardApi.getScreenshots(AtCap)).sort(), [
      'explicit',
      'implicit',
    ]);
  });

  test("keyBy 'file-content' is refused off FileDef chains", function (assert) {
    class Bad extends cardApi.CardDef {
      static screenshots: Screenshots = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          keyBy: 'file-content',
        },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(Bad),
      /keyBy 'file-content' requires a file-backed def/,
    );
    class Doc extends cardApi.FileDef {
      static screenshots: Screenshots = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          keyBy: 'file-content',
        },
      };
    }
    assert.strictEqual(
      cardApi.getScreenshots(Doc).shot.keyBy,
      'file-content',
      'legal on a FileDef subclass',
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

  test('a transparent background on a jpeg capture is refused', function (assert) {
    class TransparentJpeg extends cardApi.CardDef {
      static screenshots: Screenshots = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          background: 'transparent',
          type: 'jpeg',
        },
      };
    }
    // webp carries alpha, so the same background stays legal there.
    class TransparentWebp extends cardApi.CardDef {
      static screenshots: Screenshots = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          background: 'transparent',
          type: 'webp',
        },
      };
    }
    assert.throws(
      () => cardApi.getScreenshots(TransparentJpeg),
      /cannot be captured as jpeg/,
    );
    assert.strictEqual(
      cardApi.getScreenshots(TransparentWebp).shot.background,
      'transparent',
      'an alpha-capable type accepts a transparent background',
    );
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

  test('serializeDeclaredScreenshots crosses the page boundary without the component', function (assert) {
    class HeroShot extends cardApi.Component<typeof cardApi.CardDef> {}
    class Product extends cardApi.CardDef {
      static screenshots: Screenshots = {
        card: {
          format: 'fitted',
          width: 400,
          height: 300,
          useAsThumbnail: true,
        },
        hero: {
          render: HeroShot,
          width: 320,
          height: 180,
          deviceScaleFactor: 1,
          background: 'transparent',
          type: 'webp',
        },
      };
    }
    let roster = cardApi.serializeDeclaredScreenshots(Product);
    assert.deepEqual(roster.card, {
      width: 400,
      height: 300,
      useAsThumbnail: true,
      format: 'fitted',
    });
    assert.deepEqual(roster.hero, {
      width: 320,
      height: 180,
      deviceScaleFactor: 1,
      background: 'transparent',
      type: 'webp',
      render: true,
    });
    assert.deepEqual(
      cardApi.serializeDeclaredScreenshots(cardApi.CardDef),
      {},
      'no declarations serialize to an empty roster',
    );
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

  test('screenshotURLs maps declared names to captured URLs from meta', function (assert) {
    class Product extends cardApi.CardDef {
      static screenshots: Screenshots = {
        hero: { format: 'isolated', width: 800, height: 600 },
        thumb: { format: 'fitted', width: 300, height: 200 },
      };
    }
    let instance = new Product();
    assert.deepEqual(
      instance.screenshotURLs,
      { hero: undefined, thumb: undefined },
      'every declared name is a key; undefined until a capture exists',
    );

    (instance as any)[cardApi.meta] = {
      screenshots: {
        hero: {
          url: 'http://example.com/r/_screenshot/card-1?name=hero',
          hash: 'abc123',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      },
    };
    assert.deepEqual(
      instance.screenshotURLs,
      {
        hero: 'http://example.com/r/_screenshot/card-1?name=hero',
        thumb: undefined,
      },
      'a captured name reads its durable served URL; the uncaptured one stays undefined',
    );
  });

  test('screenshotURLs also surfaces captured names the class no longer declares', function (assert) {
    class Plain extends cardApi.CardDef {}
    let instance = new Plain();
    (instance as any)[cardApi.meta] = {
      screenshots: {
        legacy: {
          url: 'http://example.com/r/_screenshot/card-1?name=legacy',
          hash: 'abc123',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      },
    };
    assert.deepEqual(
      instance.screenshotURLs,
      { legacy: 'http://example.com/r/_screenshot/card-1?name=legacy' },
      'a manifest entry outliving its declaration still serves, so it still reads',
    );
  });

  test('a FileDef reads screenshotURLs the same way', function (assert) {
    class Video extends cardApi.FileDef {
      static screenshots: Screenshots = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          keyBy: 'file-content',
        },
      };
    }
    let instance = new Video();
    assert.deepEqual(
      instance.screenshotURLs,
      { poster: undefined },
      'the prerender pass captures only instance rows, so a file declared name reads undefined',
    );
  });

  test('an invalid declaration reads as nothing declared rather than throwing', function (assert) {
    class Bad extends cardApi.CardDef {
      static screenshots: any = { hero: { width: 800 } };
    }
    let instance = new Bad();
    assert.deepEqual(
      instance.screenshotURLs,
      {},
      'consumption stays render-safe; the declaration error surfaces at authoring/capture surfaces',
    );
  });

  test('cardThumbnailURL falls back to the useAsThumbnail capture', function (assert) {
    class Product extends cardApi.CardDef {
      static screenshots: Screenshots = {
        tile: {
          format: 'fitted',
          width: 170,
          height: 250,
          useAsThumbnail: true,
        },
        hero: { format: 'isolated', width: 800, height: 600 },
      };
    }
    let instance = new Product();
    assert.notOk(
      instance.cardThumbnailURL,
      'nullish until a capture exists — the absence signal the icon default engages on',
    );

    (instance as any)[cardApi.meta] = {
      screenshots: {
        hero: {
          url: 'http://example.com/r/_screenshot/card-1?name=hero',
          hash: 'aaa',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
        tile: {
          url: 'http://example.com/r/_screenshot/card-1?name=tile',
          hash: 'bbb',
          contentType: 'image/png',
          width: 170,
          height: 250,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
      },
    };
    assert.strictEqual(
      instance.cardThumbnailURL,
      'http://example.com/r/_screenshot/card-1?name=tile',
      'the declared useAsThumbnail slot feeds the thumbnail, not other captures',
    );
  });

  test('author-set thumbnails win over the capture', function (assert) {
    class Product extends cardApi.CardDef {
      static screenshots: Screenshots = {
        tile: {
          format: 'fitted',
          width: 170,
          height: 250,
          useAsThumbnail: true,
        },
      };
    }
    let instance = new Product();
    (instance as any)[cardApi.meta] = {
      screenshots: {
        tile: {
          url: 'http://example.com/r/_screenshot/card-1?name=tile',
          hash: 'bbb',
          contentType: 'image/png',
          width: 170,
          height: 250,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
      },
    };

    let img = new cardApi.ImageDef({
      id: 'http://example.com/authored.png',
      url: 'http://example.com/authored.png',
    });
    instance.cardInfo.cardThumbnail = img;
    assert.strictEqual(
      instance.cardThumbnailURL,
      'http://example.com/authored.png',
      'an authored ImageDef link outranks the capture',
    );

    instance.cardInfo.cardThumbnailURL = 'http://example.com/explicit.png';
    assert.strictEqual(
      instance.cardThumbnailURL,
      'http://example.com/explicit.png',
      'an explicit URL outranks everything',
    );
  });

  test('a card without a useAsThumbnail declaration ignores captured slots', function (assert) {
    class Product extends cardApi.CardDef {
      static screenshots: Screenshots = {
        hero: { format: 'isolated', width: 800, height: 600 },
      };
    }
    let instance = new Product();
    (instance as any)[cardApi.meta] = {
      screenshots: {
        hero: {
          url: 'http://example.com/r/_screenshot/card-1?name=hero',
          hash: 'aaa',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      },
    };
    assert.notOk(
      instance.cardThumbnailURL,
      'no declared thumbnail slot means no capture rung',
    );
  });

  test('the @field decorator refuses the reserved screenshotURLs name', function (assert) {
    class Bad extends cardApi.CardDef {}
    assert.throws(
      () =>
        (cardApi.field as any)(Bad.prototype, 'screenshotURLs', {
          initializer: () => ({}),
        }),
      /"screenshotURLs" is a reserved name/,
    );
  });
});
