import type { RenderingTestContext } from '@ember/test-helpers';
import { click, fillIn } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { PermissionsContextName, type Loader } from '@cardstack/runtime-common';

import { provideConsumeContext } from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CardApiModule from '@cardstack/base/card-api';

module('Integration | card-info | thumbnail picker edit', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let CardDef: typeof CardApiModule.CardDef;
  let CardInfoField: typeof CardApiModule.CardInfoField;
  let ImageDef: typeof CardApiModule.ImageDef;
  let field: typeof CardApiModule.field;
  let contains: typeof CardApiModule.contains;
  let StringField: typeof CardApiModule.StringField;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let cardApiModule = await loader.import<typeof CardApiModule>(
      '@cardstack/base/card-api',
    );
    CardDef = cardApiModule.CardDef;
    CardInfoField = cardApiModule.CardInfoField;
    ImageDef = cardApiModule.ImageDef;
    field = cardApiModule.field;
    contains = cardApiModule.contains;
    StringField = cardApiModule.StringField;
  });

  hooks.beforeEach(function () {
    provideConsumeContext(PermissionsContextName, {
      canWrite: true,
      canRead: true,
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any)._CARDSTACK_FILE_CHOOSER;
  });

  function stubFileChooser(file: CardApiModule.ImageDef | undefined) {
    (globalThis as any)._CARDSTACK_FILE_CHOOSER = {
      async chooseFile() {
        return file;
      },
    };
  }

  test('toggle button discloses the picker', async function (this: RenderingTestContext, assert) {
    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let instance = new Thing({ cardInfo: new CardInfoField({ name: 'x' }) });
    await renderCard(loader, instance, 'edit');

    assert
      .dom('[data-test-toggle-thumbnail-editor]')
      .hasText('Change Theme & Thumbnail');
    assert
      .dom('[data-test-field="cardInfo-thumbnailURL"]')
      .doesNotExist('picker is hidden by default');

    await click('[data-test-toggle-thumbnail-editor]');
    assert.dom('[data-test-field="cardInfo-thumbnailURL"]').exists();
  });

  test('toggle button omits "Theme &" and hides the theme field when the theme chooser is hidden', async function (this: RenderingTestContext, assert) {
    class Thing extends CardDef {
      static displayName = 'Thing';
      @field cssVariables = contains(StringField);
    }
    let instance = new Thing({ cardInfo: new CardInfoField({ name: 'x' }) });
    await renderCard(loader, instance, 'edit');

    assert
      .dom('[data-test-toggle-thumbnail-editor]')
      .hasText('Change Thumbnail');

    await click('[data-test-toggle-thumbnail-editor]');
    assert.dom('[data-test-field="cardInfo-thumbnailURL"]').exists();
    assert
      .dom('[data-test-field="cardInfo-theme"]')
      .doesNotExist('theme field is hidden when the theme chooser is hidden');
  });

  test('renders url input and Select Image button when no value is set', async function (this: RenderingTestContext, assert) {
    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let instance = new Thing({ cardInfo: new CardInfoField({ name: 'x' }) });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-thumbnail-editor]');

    assert.dom('[data-test-thumbnail-input] input').exists();
    assert.dom('[data-test-thumbnail-select-image]').hasText('Select Image');
    assert
      .dom('[data-test-thumbnail-clear]')
      .doesNotExist('X clear button is hidden when empty');
  });

  test('renders X clear button and hides Select Image when a url is set', async function (this: RenderingTestContext, assert) {
    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let instance = new Thing({
      cardInfo: new CardInfoField({
        name: 'x',
        cardThumbnailURL: 'https://example.com/pic.png',
      }),
    });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-thumbnail-editor]');

    assert.dom('[data-test-thumbnail-clear]').exists();
    assert.dom('[data-test-thumbnail-select-image]').doesNotExist();
    assert
      .dom('[data-test-thumbnail-input] input')
      .hasValue('https://example.com/pic.png');
  });

  test('typing a url updates the model and propagates to the thumbnail preview', async function (this: RenderingTestContext, assert) {
    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let instance = new Thing({ cardInfo: new CardInfoField({ name: 'x' }) });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-thumbnail-editor]');

    await fillIn(
      '[data-test-thumbnail-input] input',
      'https://example.com/new.png',
    );

    assert.strictEqual(
      instance.cardInfo.cardThumbnailURL,
      'https://example.com/new.png',
    );
    assert
      .dom('[data-test-thumbnail-image]')
      .hasAttribute(
        'style',
        /background-image:\s*url\(https:\/\/example\.com\/new\.png\)/,
      );
  });

  test('clicking X clears the field value and brings back Select Image', async function (this: RenderingTestContext, assert) {
    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let instance = new Thing({
      cardInfo: new CardInfoField({
        name: 'x',
        cardThumbnailURL: 'https://example.com/pic.png',
      }),
    });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-thumbnail-editor]');

    await click('[data-test-thumbnail-clear]');

    assert.notOk(
      instance.cardInfo.cardThumbnailURL,
      'cardThumbnailURL is cleared',
    );
    assert.dom('[data-test-thumbnail-clear]').doesNotExist();
    assert.dom('[data-test-thumbnail-select-image]').hasText('Select Image');
  });

  test('clicking Select Image sets the field url from the chosen file', async function (this: RenderingTestContext, assert) {
    let image = new ImageDef({
      id: 'https://example.com/uploaded.png',
      url: 'https://example.com/uploaded.png',
      sourceUrl: 'https://example.com/uploaded.png',
      name: 'uploaded.png',
      contentType: 'image/png',
    });
    stubFileChooser(image);

    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let instance = new Thing({ cardInfo: new CardInfoField({ name: 'x' }) });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-thumbnail-editor]');

    await click('[data-test-thumbnail-select-image]');

    assert.strictEqual(
      instance.cardInfo.cardThumbnailURL,
      'https://example.com/uploaded.png',
    );
    assert.dom('[data-test-thumbnail-clear]').exists();
  });

  test('cancelling the file chooser leaves the field unchanged', async function (this: RenderingTestContext, assert) {
    stubFileChooser(undefined);

    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let instance = new Thing({ cardInfo: new CardInfoField({ name: 'x' }) });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-thumbnail-editor]');

    await click('[data-test-thumbnail-select-image]');

    assert.notOk(instance.cardInfo.cardThumbnailURL);
    assert.dom('[data-test-thumbnail-select-image]').hasText('Select Image');
  });

  test('shows computed fallback as a placeholder when cardInfo.cardThumbnailURL is empty', async function (this: RenderingTestContext, assert) {
    class Book extends CardDef {
      static displayName = 'Book';
      @field bookCover = contains(StringField);
      @field cardThumbnailURL = contains(StringField, {
        computeVia: function (this: Book) {
          return this.bookCover;
        },
      });
    }
    let instance = new Book({
      cardInfo: new CardInfoField({ name: 'Insomniac' }),
      bookCover: 'https://example.com/book.png',
    });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-thumbnail-editor]');

    assert
      .dom('[data-test-thumbnail-placeholder]')
      .hasText('https://example.com/book.png');
    assert.dom('[data-test-thumbnail-input] input').hasNoValue();
    assert.dom('[data-test-thumbnail-select-image]').exists();
  });

  test('default-preview cell wraps a long URL instead of overflowing', async function (this: RenderingTestContext, assert) {
    class Thing extends CardDef {
      static displayName = 'Thing';
    }
    let longUrl =
      'https://example.com/' + 'really-long-segment/'.repeat(20) + 'cover.png';
    let instance = new Thing({
      cardInfo: new CardInfoField({ name: 'x', cardThumbnailURL: longUrl }),
    });
    await renderCard(loader, instance, 'edit');
    await click('[data-test-toggle-preview]');

    let cell = document.querySelector(
      '[data-test-edit-preview="cardThumbnailURL"]',
    ) as HTMLElement | null;
    assert.ok(cell, 'preview cell exists');
    let overflowWrap = getComputedStyle(cell!).overflowWrap;
    assert.strictEqual(
      overflowWrap,
      'anywhere',
      'preview cell allows long URLs to wrap',
    );
  });
});
