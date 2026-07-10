import type { RenderingTestContext } from '@ember/test-helpers';
import { click, fillIn } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  PermissionsContextName,
  type Loader,
} from '@cardstack/runtime-common';

import { provideConsumeContext } from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as BrandLogoModule from '@cardstack/base/brand-logo';
import type * as CardApiModule from '@cardstack/base/card-api';

module('Integration | brand-logo | MarkField edit', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
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
    BrandLogo = brandLogoModule.default;
    ImageDef = cardApiModule.ImageDef;
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

  // --- edit view structure ---

  test('shows url input and Select Image button when no value is set', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo();
    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-url-input]')
      .exists('url input is rendered');
    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-select-image]')
      .hasText('Select Image', 'Select Image button is shown when no value');
  });

  test('shows X button and no Select Image button when a url is set', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo({ primaryMark1: 'https://example.com/logo.svg' });
    await renderCard(loader, card, 'edit');

    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-clear]')
      .exists('X clear button is shown when a url is set');
    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-select-image]')
      .doesNotExist('Select Image button is hidden when a url is set');
  });

  // --- url input ---

  test('typing a url in the input updates the field value', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo();
    await renderCard(loader, card, 'edit');

    await fillIn(
      '[data-test-field="primaryMark1"] [data-test-mark-url-input]',
      'https://example.com/logo.svg',
    );

    assert.strictEqual(
      card.primaryMark1,
      'https://example.com/logo.svg',
      'field value is updated after input',
    );
  });

  // --- X clear button ---

  test('clicking the X button clears the field value', async function (this: RenderingTestContext, assert) {
    let card = new BrandLogo({ primaryMark1: 'https://example.com/logo.svg' });
    await renderCard(loader, card, 'edit');

    await click('[data-test-field="primaryMark1"] [data-test-mark-clear]');

    assert.strictEqual(card.primaryMark1, null, 'field value is cleared');
    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-clear]')
      .doesNotExist('X button is hidden after clearing');
    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-select-image]')
      .hasText('Select Image', 'Select Image button reappears after clearing');
  });

  // --- upload button ---

  test('clicking Select Image sets the field url from the chosen file', async function (this: RenderingTestContext, assert) {
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

    await click(
      '[data-test-field="primaryMark1"] [data-test-mark-select-image]',
    );

    assert.strictEqual(
      card.primaryMark1,
      'https://example.com/uploaded.png',
      'field value is set to the uploaded file url',
    );
    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-clear]')
      .exists('X button appears after upload');
  });

  test('cancelling the file chooser leaves the field unchanged', async function (this: RenderingTestContext, assert) {
    stubFileChooser(undefined);

    let card = new BrandLogo();
    await renderCard(loader, card, 'edit');

    await click(
      '[data-test-field="primaryMark1"] [data-test-mark-select-image]',
    );

    assert.strictEqual(
      card.primaryMark1,
      undefined,
      'field value remains empty after cancel',
    );
    assert
      .dom('[data-test-field="primaryMark1"] [data-test-mark-select-image]')
      .hasText(
        'Select Image',
        'Select Image button is still shown after cancel',
      );
  });
});
