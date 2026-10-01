import { render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'test-app/tests/helpers';
import { setupFixtureViewport } from 'test-app/tests/helpers/layout-fixture';

function appSheetLink() {
  return Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')
  ).filter(
    (l) => /app\.css|\/assets\/app/.test(l.href) && !/tests/.test(l.href)
  )[0];
}

/**
 * The fixture takes the app's stylesheet out of the cascade, and HOW it does
 * that is load-bearing for every test that runs AFTERWARDS.
 *
 * `link.disabled = true` detaches the sheet — `link.sheet` goes null — and
 * clearing the flag does not put it back in the same frame. The afterEach
 * therefore could not undo its own beforeEach, and the next test that read
 * geometry out of the app stylesheet measured an unstyled page: that is how
 * the subdivision demo test came to report a 47.8x10.5 tile in CI, which is
 * an untouched `button`, not a grid cell.
 *
 * `media = 'not all'` mutes the sheet without unloading it. This test pins
 * the difference: muted, but still attached.
 */
module('Integration | motion | fixture viewport', function (hooks) {
  setupRenderingTest(hooks);
  setupFixtureViewport(hooks);

  test('the app stylesheet is muted, not detached', async function (assert) {
    const link = appSheetLink();
    assert.ok(link, 'the app stylesheet is on the page at all');
    if (!link) {
      return;
    }

    assert.strictEqual(link.media, 'not all', 'the fixture muted it');
    assert.ok(
      link.sheet,
      'and left the sheet ATTACHED — `disabled` would have dropped it, and the restore in afterEach cannot bring that back within the frame'
    );

    // the mute still has to do its job: a fixture page has only fixture CSS
    await render(
      <template>
        <div class="ex" data-test-probe></div>
      </template>
    );
    const probe = document.querySelector('[data-test-probe]') as HTMLElement;
    assert.strictEqual(
      getComputedStyle(probe).position,
      'static',
      'the app rule for `.ex` is out of the cascade'
    );
  });
});
