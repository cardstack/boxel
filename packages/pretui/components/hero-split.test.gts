// Pretui — HeroSplit unit tests.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { HeroSplit } from './hero-split';
import type { MediaAssetSpec } from '../internal/media-viewer';

module('Pretui | components/hero-split', function (hooks) {
  setupCardTest(hooks);

  test('the headline comes before the media in source order', async function (assert) {
    const PHOTO: MediaAssetSpec = { src: '/lots/gyokuro.jpg', alt: 'Shaded tea rows' };
    await render(
      <template>
        <HeroSplit @headline='Single-estate gyokuro' @lead='Shaded for three weeks.' @asset={{PHOTO}} @mediaSide='start' />
      </template>,
    );
    let hero = document.querySelector('.pretui-hero') as HTMLElement;
    let heading = Array.from(hero.querySelectorAll('h1, h2, h3, [role="heading"]')).find((el) => el.textContent?.includes('Single-estate gyokuro'));
    let img = hero.querySelector('img');
    assert.ok(heading, 'the headline is a heading');
    assert.ok(img, 'the media rendered');
    let content = hero.querySelector('.pretui-hero-content');
    let media = hero.querySelector('.pretui-hero-media');
    let order = Array.from(hero.querySelector('.pretui-hero-grid')?.children ?? []);
    assert.deepEqual(
      [order.indexOf(content as Element), order.indexOf(media as Element)],
      [0, 1],
      'even with the media on the start side, the headline is read first',
    );
    assert.true(content?.contains(heading as Element), 'the headline sits in the first child');
  });
});
