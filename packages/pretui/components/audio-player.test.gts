// Pretui — AudioPlayer unit tests: what the wrapper forwards to MediaPlayer.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AudioPlayer } from './audio-player';

function controller(): Element | null {
  return document.querySelector('media-controller');
}

module('Pretui | components/audio-player', function (hooks) {
  setupCardTest(hooks);

  test('@autoHide reaches the player', async function (assert) {
    await render(<template><AudioPlayer @src='/clip.mp3' @label='Notes' /></template>);
    assert.true(controller()?.hasAttribute('noautohide'), 'controls stay by default');
    await render(<template><AudioPlayer @src='/clip.mp3' @label='Notes' @autoHide={{true}} /></template>);
    assert.false(controller()?.hasAttribute('noautohide'), '@autoHide={{true}} lets them hide');
  });

  test('@label names the player', async function (assert) {
    await render(<template><AudioPlayer @src='/clip.mp3' @label='Cupping notes' /></template>);
    assert.strictEqual(document.querySelector('[data-test-pretui-media-player]')?.getAttribute('aria-label'), 'Cupping notes');
  });
});
