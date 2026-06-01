import type { RenderingTestContext } from '@ember/test-helpers';
import { click, fillIn } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import type * as BrandLogoModule from 'https://cardstack.com/base/brand-logo';
import type * as CardApiModule from 'https://cardstack.com/base/card-api';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | brand-logo | MarkField edit', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let MarkField: typeof BrandLogoModule.MarkField;
  let BrandLogo: typeof BrandLogoModule.default;
  let ImageDef: typeof CardApiModule.ImageDef;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let brandLogoModule = await loader.import<typeof BrandLogoModule>(
      `${baseRealm.url}brand-logo`,
    );
    let cardApiModule = await loader.import<typeof CardApiModule>(
      `${baseRealm.url}card-api`,
    );
    MarkField = brandLogoModule.MarkField;
    BrandLogo = brandLogoModule.default;
    ImageDef = cardApiModule.ImageDef;
  });

  hooks.afterEach(function () {
    delete (globalThis as any)._CARDSTACK_FILE_CHOOSER;
  });

  function stubFileChooser(file: CardApiModule.ImageDef) {
    (globalThis as any)._CARDSTACK_FILE_CHOOSER = {
      async chooseFile() {
        return file;
      },
    };
  }

  // --- edit view structure ---

  test('edit view shows a url input and upload button when editable', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo();
    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-field="primaryMark1"] input[type="url"]')
      .exists('url input is rendered');
    assert
      .dom('[data-test-field="primaryMark1"] button')
      .hasText('Select Image', 'upload button is rendered');
  });

  test('empty placeholder is shown when no url is set', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo();
    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-field="primaryMark1"] .mark-field-preview--empty')
      .exists('empty placeholder is shown when no url');
    assert
      .dom('[data-test-field="primaryMark1"] .mark-field-preview img')
      .doesNotExist('no img element when url is empty');
  });

  test('preview image is shown when a url is set', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo({
      primaryMark1: 'https://example.com/logo.svg',
    });
    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-field="primaryMark1"] img.mark-field-preview')
      .exists('preview img is rendered');
    assert
      .dom('[data-test-field="primaryMark1"] img.mark-field-preview')
      .hasAttribute('src', 'https://example.com/logo.svg', 'preview src matches the url');
    assert
      .dom('[data-test-field="primaryMark1"] .mark-field-preview--empty')
      .doesNotExist('empty placeholder is hidden when url is set');
  });

  // --- url input ---

  test('typing a url in the input updates the field value', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo();
    await renderCard(loader, card, 'edit');

    await fillIn(
      '[data-test-field="primaryMark1"] input[type="url"]',
      'https://example.com/logo.svg',
    );

    assert.strictEqual(
      card.primaryMark1,
      'https://example.com/logo.svg',
      'field value is updated after input',
    );
  });

  // --- upload button ---

  test('clicking upload sets the field url from the chosen file', async function (this: RenderingTestContext, assert) {
    let image = new ImageDef({
      id: 'https://example.com/uploaded.png',
      url: 'https://example.com/uploaded.png',
      sourceUrl: 'https://example.com/uploaded.png',
      name: 'uploaded.png',
      contentType: 'image/png',
    });
    stubFileChooser(image);

    let card = new BrandLogo();
    await renderCard(loader, card, 'edit');

    await click('[data-test-field="primaryMark1"] button');

    assert.strictEqual(
      card.primaryMark1,
      'https://example.com/uploaded.png',
      'field value is set to the uploaded file url',
    );
    assert
      .dom('[data-test-field="primaryMark1"] img.mark-field-preview')
      .hasAttribute(
        'src',
        'https://example.com/uploaded.png',
        'preview updates after upload',
      );
  });

  test('cancelling the file chooser leaves the field unchanged', async function (this: RenderingTestContext, assert) {
    (globalThis as any)._CARDSTACK_FILE_CHOOSER = {
      async chooseFile() {
        return undefined;
      },
    };

    let card = new BrandLogo({ primaryMark1: 'https://example.com/original.svg' });
    await renderCard(loader, card, 'edit');

    await click('[data-test-field="primaryMark1"] button');

    assert.strictEqual(
      card.primaryMark1,
      'https://example.com/original.svg',
      'field value is unchanged after cancel',
    );
  });
});
