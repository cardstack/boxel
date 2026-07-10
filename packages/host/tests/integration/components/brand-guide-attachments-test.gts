import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as BrandGuideModule from '@cardstack/base/brand-guide';
import type * as CardApiModule from '@cardstack/base/card-api';

module('Integration | brand-guide | brand image attachments', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let BrandGuide: typeof BrandGuideModule.default;
  let CompoundImageField: typeof BrandGuideModule.CompoundImageField;
  let ImageDef: typeof CardApiModule.ImageDef;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let brandGuideModule = await loader.import<typeof BrandGuideModule>(
      `${baseRealm.url}brand-guide`,
    );
    let cardApiModule = await loader.import<typeof CardApiModule>(
      `${baseRealm.url}card-api`,
    );
    BrandGuide = brandGuideModule.default;
    CompoundImageField = brandGuideModule.CompoundImageField;
    ImageDef = cardApiModule.ImageDef;
  });

  function makeImage(
    ImageDefClass: typeof CardApiModule.ImageDef,
    url: string,
    name: string,
  ) {
    return new ImageDefClass({
      id: url,
      url,
      sourceUrl: url,
      name,
      contentType: 'image/png',
    });
  }

  // --- brand-image-attachments section ---

  test('attachment row renders thumbnail, var name, and url value', async function (this: RenderingTestContext, assert) {
    let image = makeImage(ImageDef, 'https://example.com/hero.png', 'hero.png');
    let card = new BrandGuide({
      brandImageAttachments: [
        new CompoundImageField({ name: 'heroBanner', image }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-brand-image-attachment-var]')
      .exists({ count: 1 }, 'one row is rendered');
    assert
      .dom('[data-test-brand-image-attachment-thumb]')
      .hasAttribute(
        'src',
        'https://example.com/hero.png',
        'thumbnail src is correct',
      );
    assert
      .dom('[data-test-brand-image-attachment-varname]')
      .hasText(
        '--hero-banner',
        'camelCase name is dasherized and prefixed with --',
      );
    assert
      .dom('[data-test-brand-image-attachment-url]')
      .hasText('url(https://example.com/hero.png)', 'url() value is rendered');
  });

  // --- custom-css section ---

  test('attachment appears in custom-css section with var name and url value', async function (this: RenderingTestContext, assert) {
    let image = makeImage(ImageDef, 'https://example.com/hero.png', 'hero.png');
    let card = new BrandGuide({
      brandImageAttachments: [
        new CompoundImageField({ name: 'heroBanner', image }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-brand-guide-section="custom-css"]')
      .exists('custom-css section appears');
    assert
      .dom('[data-test-brand-guide-image-attachment-var]')
      .exists({ count: 1 }, 'one row appears in the custom-css section');
    assert
      .dom('[data-test-brand-guide-image-attachment-varname]')
      .hasText('--hero-banner', 'var name is rendered in custom-css section');
    assert
      .dom('[data-test-brand-guide-image-attachment-url]')
      .hasText(
        'url(https://example.com/hero.png)',
        'url() value is rendered in custom-css section',
      );
  });

  test('attachments without a url are excluded from both sections', async function (this: RenderingTestContext, assert) {
    let card = new BrandGuide({
      brandImageAttachments: [new CompoundImageField({ name: 'missing' })],
    });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-brand-image-attachment-var]')
      .doesNotExist(
        'item with no url is not rendered in brand-image-attachments',
      );
    assert
      .dom('[data-test-brand-guide-section="custom-css"]')
      .doesNotExist(
        'custom-css section is hidden when all entries have no url',
      );
    assert
      .dom('[data-test-brand-guide-image-attachment-var]')
      .doesNotExist('no rows rendered in custom-css section');
  });

  // --- CSS generation ---

  test('brand image attachments produce url() CSS variables in cssVariables', async function (this: RenderingTestContext, assert) {
    let image = makeImage(ImageDef, 'https://example.com/hero.png', 'hero.png');
    let card = new BrandGuide({
      brandImageAttachments: [
        new CompoundImageField({ name: 'heroBanner', image }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    let css = card.cssVariables ?? '';
    assert.ok(
      css.includes('--hero-banner: url(https://example.com/hero.png)'),
      'brand image attachment is emitted as a url() CSS variable',
    );
  });

  test('brand image attachment with missing name or url is excluded from cssVariables', async function (this: RenderingTestContext, assert) {
    let image = makeImage(ImageDef, 'https://example.com/hero.png', 'hero.png');
    let card = new BrandGuide({
      brandImageAttachments: [
        new CompoundImageField({ name: '', image }),
        new CompoundImageField({ name: 'noImage' }),
      ],
    });
    await renderCard(loader, card, 'isolated');

    let css = card.cssVariables ?? '';
    assert.notOk(
      css.includes('url(https://example.com/hero.png)'),
      'entry with empty name is excluded',
    );
    assert.notOk(css.includes('--no-image'), 'entry with no image is excluded');
  });
});
