import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import { setupBaseRealm } from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type * as CardApiModule from '@cardstack/base/card-api';

module('Integration | FileDef format templates', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let FileDef: typeof CardApiModule.FileDef;
  let ImageDef: typeof CardApiModule.ImageDef;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    let cardApiModule = await loader.import<typeof CardApiModule>(
      `${baseRealm.url}card-api`,
    );
    FileDef = cardApiModule.FileDef;
    ImageDef = cardApiModule.ImageDef;
  });

  function makeFile() {
    return new FileDef({
      id: 'http://example.com/docs/report.pdf',
      url: 'http://example.com/docs/report.pdf',
      sourceUrl: 'http://example.com/docs/report.pdf',
      name: 'report.pdf',
      contentType: 'application/pdf',
    });
  }

  test('atom renders the atom affordance with the file name', async function (assert) {
    await renderCard(loader, makeFile(), 'atom');
    assert.dom('[data-test-file-atom]').containsText('report.pdf');
    assert.dom('[data-test-file-embedded]').doesNotExist();
    assert.dom('[data-test-file-fitted]').doesNotExist();
    assert.dom('[data-test-file-isolated]').doesNotExist();
  });

  test('embedded renders the embedded affordance with the file name', async function (assert) {
    await renderCard(loader, makeFile(), 'embedded');
    assert.dom('[data-test-file-embedded]').containsText('report.pdf');
    assert.dom('[data-test-file-atom]').doesNotExist();
    assert.dom('[data-test-file-fitted]').doesNotExist();
    assert.dom('[data-test-file-isolated]').doesNotExist();
  });

  test('fitted renders the fitted affordance with the file name', async function (assert) {
    await renderCard(loader, makeFile(), 'fitted');
    assert.dom('[data-test-file-fitted]').containsText('report.pdf');
    assert.dom('[data-test-file-atom]').doesNotExist();
    assert.dom('[data-test-file-embedded]').doesNotExist();
    assert.dom('[data-test-file-isolated]').doesNotExist();
  });

  test('isolated renders the isolated affordance with the file name', async function (assert) {
    await renderCard(loader, makeFile(), 'isolated');
    assert.dom('[data-test-file-isolated]').containsText('report.pdf');
    assert.dom('[data-test-file-atom]').doesNotExist();
    assert.dom('[data-test-file-embedded]').doesNotExist();
    assert.dom('[data-test-file-fitted]').doesNotExist();
  });

  test('image-file embeds still render via ImageDef, not the generic FileDef template', async function (assert) {
    let image = new ImageDef({
      id: 'http://example.com/img/hero.png',
      url: 'http://example.com/img/hero.png',
      sourceUrl: 'http://example.com/img/hero.png',
      name: 'hero.png',
      contentType: 'image/png',
    });
    await renderCard(loader, image, 'embedded');
    assert
      .dom('img')
      .exists('ImageDef embedded renders an <img>, not the file affordance');
    assert.dom('[data-test-file-embedded]').doesNotExist();
  });
});
