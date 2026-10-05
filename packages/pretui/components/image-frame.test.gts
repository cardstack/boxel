// Pretui — ImageFrame unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ImageFrame } from './image-frame';
import { resolveAsset } from '../internal/media-viewer';

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const SIZED = resolveAsset({ src: PIXEL, name: 'Wuyi lot', width: 1200, height: 800, alt: 'Crates in the curing room' });
const BARE = resolveAsset({ src: 'https://example.test/media/spring-2026.png' });

function frame(): HTMLElement {
  return document.querySelector('[data-test-pretui-image-frame]') as HTMLElement;
}
function img(): HTMLImageElement {
  return frame().querySelector('img') as HTMLImageElement;
}

module('Pretui | components/image-frame', function (hooks) {
  setupCardTest(hooks);

  test('reserves the aspect ratio as a custom property and prints the dimensions as a machine value', async function (assert) {
    await render(<template><ImageFrame @asset={{SIZED}} /></template>);
    assert.strictEqual(frame().getAttribute('style'), '--pretui-frame-aspect: 1200 / 800', 'so the layout does not jump when the bytes arrive');
    assert.strictEqual(img().getAttribute('alt'), 'Crates in the curing room');
    assert.strictEqual(img().getAttribute('width'), '1200');
    assert.strictEqual(img().getAttribute('height'), '800');
    assert.strictEqual(img().getAttribute('loading'), 'lazy');
    assert.strictEqual(frame().querySelector('[data-test-pretui-token]')?.textContent?.trim(), '1200 × 800');
  });

  test('falls back to the label for alt, and to the stylesheet for an unknown ratio', async function (assert) {
    await render(<template><ImageFrame @asset={{BARE}} /></template>);
    assert.strictEqual(img().getAttribute('alt'), 'spring-2026.png', 'the resolved label — never an empty alt on a content image');
    assert.strictEqual(frame().getAttribute('style'), null, 'no dimensions, no ratio, no inline style');
    assert.strictEqual(frame().querySelector('.pretui-frame-meta'), null);
  });
});
