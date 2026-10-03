import { setupChoreo } from '@cardstack/choreo/test-support';
import { click, render } from '@ember/test-helpers';
import { module, test } from 'qunit';
import { Gallery } from 'test-app/components/gallery';
import { catalog } from 'test-app/lib/catalog';
import { setupRenderingTest } from 'test-app/tests/helpers';

function chip(label: string) {
  const found = [...document.querySelectorAll('.chip')].find(
    (c) => c.textContent?.trim() === label
  );
  if (!found) {
    throw new Error(`no chip named ${label}`);
  }
  return found;
}

/**
 * `animationsSettled()` cannot be used here: this gallery contains demos that
 * loop forever, so the page is never idle by design. Wait out the card spring
 * instead — what is being asserted is the resting state, not the path to it.
 */
function afterTheSwitch() {
  return new Promise((resolve) => setTimeout(resolve, 900));
}

/** cards a reader can actually see */
function visible() {
  return [...document.querySelectorAll<HTMLElement>('.card')].filter(
    (card) => Number(getComputedStyle(card).opacity) > 0.5
  );
}

module('Integration | motion | gallery filter', function (hooks) {
  setupRenderingTest(hooks);
  setupChoreo(hooks);

  test('filtering out and back leaves every card on screen', async function (assert) {
    await render(<template><Gallery /></template>);
    await afterTheSwitch();
    assert.strictEqual(visible().length, catalog.length, 'all of them at rest');

    await click(chip('Drag'));
    await afterTheSwitch();
    const drag = catalog.filter((demo) => demo.group === 'Drag').length;
    assert.strictEqual(visible().length, drag, 'only the drag demos');

    await click(chip('All'));
    await afterTheSwitch();
    assert.strictEqual(
      visible().length,
      catalog.length,
      `and back to all of them (dom=${document.querySelectorAll('.card').length})`
    );
  });
});
