// Pretui — MediaPlayer unit tests.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { MediaPlayer } from './media-player';

module('Pretui | components/media-player', function (hooks) {
  setupCardTest(hooks);

  test('@label names the player region and the media element', async function (assert) {
    await render(<template><MediaPlayer @src='/clip.mp4' @label='Cupping walkthrough' /></template>);
    let root = document.querySelector('[data-test-pretui-media-player]') as HTMLElement;
    assert.strictEqual(root.getAttribute('role'), 'region');
    assert.strictEqual(root.getAttribute('aria-label'), 'Cupping walkthrough');
    assert.strictEqual(root.querySelector('video')?.getAttribute('aria-label'), 'Cupping walkthrough');
  });

  test('without @label the root is not an unnamed region', async function (assert) {
    await render(<template><MediaPlayer @src='/clip.mp4' /></template>);
    let root = document.querySelector('[data-test-pretui-media-player]') as HTMLElement;
    assert.strictEqual(root.getAttribute('role'), null);
  });
});
