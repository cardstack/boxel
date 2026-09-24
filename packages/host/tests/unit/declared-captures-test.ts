import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPIModule from '@cardstack/base/card-api';
import type { CaptureSpec } from '@cardstack/base/card-api';

type Captures = Record<string, CaptureSpec>;

module('Unit | declared captures', function (hooks) {
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
    assert.deepEqual(cardApi.getCaptures(Plain), {});
    assert.deepEqual(cardApi.getCaptures(cardApi.CardDef), {});
    assert.deepEqual(cardApi.getCaptures(cardApi.FileDef), {});
  });

  test('declarations on one class are returned by name', function (assert) {
    class HeroShot extends cardApi.Component<typeof cardApi.CardDef> {}
    class Product extends cardApi.CardDef {
      static captures: Captures = {
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
    let merged = cardApi.getCaptures(Product);
    assert.deepEqual(Object.keys(merged).sort(), ['hero', 'thumb']);
    assert.strictEqual(merged.hero.render, HeroShot);
    assert.strictEqual(merged.thumb.format, 'fitted');
    assert.true(merged.thumb.useAsThumbnail);
  });

  test('a subclass adds new names and inherits ancestors up the chain', function (assert) {
    class Video extends cardApi.FileDef {
      static captures: Captures = {
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
      static captures: Captures = {
        banner: { format: 'embedded', width: 1024, height: 256 },
      };
    }
    class TeaserTrailer extends Trailer {
      static captures: Captures = {
        teaser: { format: 'fitted', width: 150, height: 170 },
      };
    }
    // a plain property read sees only the nearest declaration…
    assert.deepEqual(Object.keys(TeaserTrailer.captures!), ['teaser']);
    // …while the merge helper sees the whole chain
    let merged = cardApi.getCaptures(TeaserTrailer);
    assert.deepEqual(Object.keys(merged).sort(), [
      'banner',
      'poster',
      'teaser',
    ]);
    assert.strictEqual(merged.poster.keyBy, 'file-content');
  });

  test('a subclass overrides an inherited name wholesale', function (assert) {
    class Video extends cardApi.FileDef {
      static captures: Captures = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          type: 'jpeg',
        },
      };
    }
    class Widescreen extends Video {
      static captures: Captures = {
        poster: { format: 'embedded', width: 1280, height: 720 },
      };
    }
    let merged = cardApi.getCaptures(Widescreen);
    assert.strictEqual(merged.poster.width, 1280);
    // the override replaces the whole spec: the ancestor's `type` does not
    // bleed through
    assert.strictEqual(merged.poster.type, undefined);
  });

  test('a name outside the URL-safe charset is refused', function (assert) {
    for (const name of ['og image', 'og/image', '../poster', '-leading', '']) {
      class Bad extends cardApi.CardDef {
        static captures: Captures = {
          [name]: { format: 'fitted', width: 300, height: 200 },
        };
      }
      assert.throws(
        () => cardApi.getCaptures(Bad),
        /name must be a URL-safe path segment/,
        `"${name}" is refused`,
      );
    }
    class TooLong extends cardApi.CardDef {
      static captures: Captures = {
        ['a'.repeat(65)]: { format: 'fitted', width: 300, height: 200 },
      };
    }
    assert.throws(
      () => cardApi.getCaptures(TooLong),
      /name must be a URL-safe path segment/,
    );
  });

  test('declaring both or neither of render and format is refused', function (assert) {
    class Shot extends cardApi.Component<typeof cardApi.CardDef> {}
    class Both extends cardApi.CardDef {
      static captures: Record<string, any> = {
        hero: { render: Shot, format: 'fitted', width: 300, height: 200 },
      };
    }
    class Neither extends cardApi.CardDef {
      static captures: Record<string, any> = {
        hero: { width: 300, height: 200 },
      };
    }
    assert.throws(
      () => cardApi.getCaptures(Both),
      /declare exactly one of render or format/,
    );
    assert.throws(
      () => cardApi.getCaptures(Neither),
      /declare exactly one of render or format/,
    );
  });

  test('formats outside the declared-capture roster are refused', function (assert) {
    for (const format of ['edit', 'head', 'markdown', 'bogus']) {
      class Bad extends cardApi.CardDef {
        static captures: Record<string, any> = {
          shot: { format, width: 300, height: 200 },
        };
      }
      assert.throws(
        () => cardApi.getCaptures(Bad),
        /format must be one of/,
        `"${format}" is refused`,
      );
    }
  });

  test('unknown spec fields are refused by name', function (assert) {
    class Bad extends cardApi.CardDef {
      static captures: Record<string, any> = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          useAsThumbnal: true,
        },
      };
    }
    assert.throws(
      () => cardApi.getCaptures(Bad),
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
        static captures: Record<string, any> = {
          shot: { format: 'fitted', width: 300, height: 200, [field]: value },
        };
      }
      assert.throws(
        () => cardApi.getCaptures(Bad),
        new RegExp(`${field} must be an integer between`),
        `${field}=${value} is refused`,
      );
    }
    class BadDsf extends cardApi.CardDef {
      static captures: Record<string, any> = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          deviceScaleFactor: 4,
        },
      };
    }
    assert.throws(
      () => cardApi.getCaptures(BadDsf),
      /deviceScaleFactor must be a number/,
    );
  });

  test('each edge × deviceScaleFactor must fit the physical-pixel cap', function (assert) {
    // in-cap CSS height, but the default 2× scale puts it past the
    // 16384-physical-px texture cap
    class ImplicitScale extends cardApi.CardDef {
      static captures: Captures = {
        tall: { format: 'fitted', width: 300, height: 16384 },
      };
    }
    assert.throws(
      () => cardApi.getCaptures(ImplicitScale),
      /height × deviceScaleFactor must be <= 16384 physical pixels/,
    );
    class ExplicitScale extends cardApi.CardDef {
      static captures: Captures = {
        tall: {
          format: 'fitted',
          width: 300,
          height: 8192,
          deviceScaleFactor: 3,
        },
      };
    }
    assert.throws(
      () => cardApi.getCaptures(ExplicitScale),
      /height × deviceScaleFactor must be <= 16384 physical pixels/,
    );
    // at the cap exactly, both implicitly and explicitly scaled
    class AtCap extends cardApi.CardDef {
      static captures: Captures = {
        implicit: { format: 'fitted', width: 300, height: 8192 },
        explicit: {
          format: 'fitted',
          width: 300,
          height: 16384,
          deviceScaleFactor: 1,
        },
      };
    }
    assert.deepEqual(Object.keys(cardApi.getCaptures(AtCap)).sort(), [
      'explicit',
      'implicit',
    ]);
  });

  test("keyBy 'file-content' is refused off FileDef chains", function (assert) {
    class Bad extends cardApi.CardDef {
      static captures: Captures = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          keyBy: 'file-content',
        },
      };
    }
    assert.throws(
      () => cardApi.getCaptures(Bad),
      /keyBy 'file-content' requires a file-backed def/,
    );
    class Doc extends cardApi.FileDef {
      static captures: Captures = {
        shot: {
          format: 'fitted',
          width: 300,
          height: 200,
          keyBy: 'file-content',
        },
      };
    }
    assert.strictEqual(
      cardApi.getCaptures(Doc).shot.keyBy,
      'file-content',
      'legal on a FileDef subclass',
    );
  });

  test('keyBy and type are constrained to their rosters', function (assert) {
    class BadKeyBy extends cardApi.CardDef {
      static captures: Record<string, any> = {
        shot: { format: 'fitted', width: 300, height: 200, keyBy: 'mtime' },
      };
    }
    class BadType extends cardApi.CardDef {
      static captures: Record<string, any> = {
        shot: { format: 'fitted', width: 300, height: 200, type: 'gif' },
      };
    }
    assert.throws(() => cardApi.getCaptures(BadKeyBy), /keyBy must be one/);
    assert.throws(() => cardApi.getCaptures(BadType), /type must be one/);
  });

  test('a pdf capture is a geometry-free declaration from a format or a render slot', function (assert) {
    class InvoiceDocument extends cardApi.Component<typeof cardApi.CardDef> {}
    class Reports extends cardApi.CardDef {
      static captures: Captures = {
        statement: { format: 'isolated', type: 'pdf' },
        summary: { format: 'embedded', type: 'pdf', keyBy: 'generation' },
        invoice: { render: InvoiceDocument, type: 'pdf' },
      };
    }
    let merged = cardApi.getCaptures(Reports);
    assert.strictEqual(merged.statement.type, 'pdf');
    assert.strictEqual(merged.statement.format, 'isolated');
    assert.strictEqual(
      merged.statement.width,
      undefined,
      'a pdf declares no capture box',
    );
    assert.strictEqual(merged.summary.format, 'embedded');
    assert.strictEqual(
      merged.invoice.render,
      InvoiceDocument,
      'a pdf can source from a capture-only render component',
    );
  });

  test('a pdf capture refuses raster fields, box formats, and thumbnails', function (assert) {
    for (let [spec, pattern] of [
      [{ format: 'isolated', type: 'pdf', width: 300 }, /'width' is a raster/],
      [
        { format: 'isolated', type: 'pdf', height: 300 },
        /'height' is a raster/,
      ],
      [
        { format: 'isolated', type: 'pdf', deviceScaleFactor: 2 },
        /'deviceScaleFactor' is a raster/,
      ],
      [
        { format: 'isolated', type: 'pdf', background: 'white' },
        /'background' is a raster/,
      ],
      [
        { format: 'fitted', type: 'pdf' },
        /format must be 'isolated' or 'embedded'/,
      ],
      [
        { format: 'atom', type: 'pdf' },
        /format must be 'isolated' or 'embedded'/,
      ],
      [{ render: class {}, type: 'pdf', width: 300 }, /'width' is a raster/],
      [
        { format: 'isolated', type: 'pdf', useAsThumbnail: true },
        /useAsThumbnail cannot appear on a pdf/,
      ],
    ] as const) {
      class Bad extends cardApi.CardDef {
        static captures: Record<string, any> = { shot: spec };
      }
      assert.throws(() => cardApi.getCaptures(Bad), pattern);
    }
  });

  test('a transparent background on a jpeg capture is refused', function (assert) {
    class TransparentJpeg extends cardApi.CardDef {
      static captures: Captures = {
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
      static captures: Captures = {
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
      () => cardApi.getCaptures(TransparentJpeg),
      /cannot be captured as jpeg/,
    );
    assert.strictEqual(
      cardApi.getCaptures(TransparentWebp).shot.background,
      'transparent',
      'an alpha-capable type accepts a transparent background',
    );
  });

  test('more than one useAsThumbnail across the merged chain is refused', function (assert) {
    class Video extends cardApi.FileDef {
      static captures: Captures = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          useAsThumbnail: true,
        },
      };
    }
    class Trailer extends Video {
      static captures: Captures = {
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
      Object.keys(cardApi.getCaptures(Video)).length,
      1,
      'base class alone is valid',
    );
    // …but the merged result has two thumbnail feeds
    assert.throws(
      () => cardApi.getCaptures(Trailer),
      /more than one useAsThumbnail capture \("poster", "banner"\)/,
    );
  });

  test('two useAsThumbnail entries on one class are refused', function (assert) {
    class Bad extends cardApi.CardDef {
      static captures: Captures = {
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
      () => cardApi.getCaptures(Bad),
      /more than one useAsThumbnail/,
    );
  });

  test('overriding an inherited entry by name can move the thumbnail', function (assert) {
    class Video extends cardApi.FileDef {
      static captures: Captures = {
        poster: {
          format: 'embedded',
          width: 640,
          height: 360,
          useAsThumbnail: true,
        },
      };
    }
    class Trailer extends Video {
      static captures: Captures = {
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
    let merged = cardApi.getCaptures(Trailer);
    assert.strictEqual(merged.poster.useAsThumbnail, undefined);
    assert.true(merged.banner.useAsThumbnail);
  });

  test('serializeDeclaredCaptures crosses the page boundary without the component', function (assert) {
    class HeroShot extends cardApi.Component<typeof cardApi.CardDef> {}
    class Product extends cardApi.CardDef {
      static captures: Captures = {
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
    let roster = cardApi.serializeDeclaredCaptures(Product);
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
      cardApi.serializeDeclaredCaptures(cardApi.CardDef),
      {},
      'no declarations serialize to an empty roster',
    );
  });

  test('a non-object declarations value is refused', function (assert) {
    class Bad extends cardApi.CardDef {
      static captures: any = ['nope'];
    }
    assert.throws(
      () => cardApi.getCaptures(Bad),
      /must be an object mapping names to specs/,
    );
  });

  test('captureURLs maps declared names to captured URLs from meta', function (assert) {
    class Product extends cardApi.CardDef {
      static captures: Captures = {
        hero: { format: 'isolated', width: 800, height: 600 },
        thumb: { format: 'fitted', width: 300, height: 200 },
      };
    }
    let instance = new Product();
    assert.deepEqual(
      instance.captureURLs,
      { hero: undefined, thumb: undefined },
      'every declared name is a key; undefined until a capture exists',
    );

    (instance as any)[cardApi.meta] = {
      captures: {
        hero: {
          url: 'http://example.com/r/_capture/card-1?name=hero',
          hash: 'abc123',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      },
    };
    assert.deepEqual(
      instance.captureURLs,
      {
        hero: 'http://example.com/r/_capture/card-1?name=hero',
        thumb: undefined,
      },
      'a captured name reads its durable served URL; the uncaptured one stays undefined',
    );
  });

  test('captureURLs also surfaces captured names the class no longer declares', function (assert) {
    class Plain extends cardApi.CardDef {}
    let instance = new Plain();
    (instance as any)[cardApi.meta] = {
      captures: {
        legacy: {
          url: 'http://example.com/r/_capture/card-1?name=legacy',
          hash: 'abc123',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      },
    };
    assert.deepEqual(
      instance.captureURLs,
      { legacy: 'http://example.com/r/_capture/card-1?name=legacy' },
      'a manifest entry outliving its declaration still serves, so it still reads',
    );
  });

  test('a FileDef reads captureURLs the same way', function (assert) {
    class Video extends cardApi.FileDef {
      static captures: Captures = {
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
      instance.captureURLs,
      { poster: undefined },
      'the prerender pass captures only instance rows, so a file declared name reads undefined',
    );
  });

  test('an invalid declaration reads as nothing declared rather than throwing', function (assert) {
    class Bad extends cardApi.CardDef {
      static captures: any = { hero: { width: 800 } };
    }
    let instance = new Bad();
    assert.deepEqual(
      instance.captureURLs,
      {},
      'consumption stays render-safe; the declaration error surfaces at authoring/capture surfaces',
    );
  });

  test('cardThumbnailURL falls back to the useAsThumbnail capture', function (assert) {
    class Product extends cardApi.CardDef {
      static captures: Captures = {
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
      captures: {
        hero: {
          url: 'http://example.com/r/_capture/card-1?name=hero',
          hash: 'aaa',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
        tile: {
          url: 'http://example.com/r/_capture/card-1?name=tile',
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
      'http://example.com/r/_capture/card-1?name=tile',
      'the declared useAsThumbnail slot feeds the thumbnail, not other captures',
    );
  });

  test('author-set thumbnails win over the capture', function (assert) {
    class Product extends cardApi.CardDef {
      static captures: Captures = {
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
      captures: {
        tile: {
          url: 'http://example.com/r/_capture/card-1?name=tile',
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

  test('an empty-string authored URL falls through to the capture', function (assert) {
    class Product extends cardApi.CardDef {
      static captures: Captures = {
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
      captures: {
        tile: {
          url: 'http://example.com/r/_capture/card-1?name=tile',
          hash: 'bbb',
          contentType: 'image/png',
          width: 170,
          height: 250,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
      },
    };
    // A text edit can leave '' in the authored URL (only the picker's clear
    // button writes null); '' is never a meaningful URL, so it must not mask
    // the rungs below it.
    instance.cardInfo.cardThumbnailURL = '';
    assert.strictEqual(
      instance.cardThumbnailURL,
      'http://example.com/r/_capture/card-1?name=tile',
      'an emptied authored URL does not mask the capture',
    );
  });

  test('a card without a useAsThumbnail declaration ignores captured slots', function (assert) {
    class Product extends cardApi.CardDef {
      static captures: Captures = {
        hero: { format: 'isolated', width: 800, height: 600 },
      };
    }
    let instance = new Product();
    (instance as any)[cardApi.meta] = {
      captures: {
        hero: {
          url: 'http://example.com/r/_capture/card-1?name=hero',
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

  test('the @field decorator refuses the reserved captureURLs name', function (assert) {
    class Bad extends cardApi.CardDef {}
    assert.throws(
      () =>
        (cardApi.field as any)(Bad.prototype, 'captureURLs', {
          initializer: () => ({}),
        }),
      /"captureURLs" is a reserved name/,
    );
  });
});
