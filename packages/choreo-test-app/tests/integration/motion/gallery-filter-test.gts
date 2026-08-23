import { click, render } from '@ember/test-helpers';
import { setupMotion } from 'glimmer-motion/test-support';
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
  setupMotion(hooks);

  test('filtering out and back leaves every card on screen', async function (assert) {
    await render(<template><Gallery /></template>);
    await afterTheSwitch();
    assert.strictEqual(visible().length, catalog.length, 'all of them at rest');

    // stamp them, so we can tell a card that never left from a fresh mount
    for (const [i, card] of [
      ...document.querySelectorAll<HTMLElement>('.card'),
    ].entries()) {
      card.dataset['stamp'] = String(i);
    }

    await click(chip('Drag'));
    await afterTheSwitch();
    const drag = catalog.filter((demo) => demo.group === 'Drag').length;
    assert.strictEqual(visible().length, drag, 'only the drag demos');

    await click(chip('All'));
    await afterTheSwitch();
    const all = [...document.querySelectorAll<HTMLElement>('.card')];
    const stamped = all.filter((c) => c.dataset['stamp'] !== undefined).length;
    const tally: Record<string, number> = { stamped };
    for (const card of all) {
      const style = getComputedStyle(card);
      const key = `o=${style.opacity} pos=${style.position} tf=${(card.style.transform || '-').slice(0, 20)}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    assert.strictEqual(
      visible().length,
      catalog.length,
      `dom=${all.length} stamped=${stamped} ${JSON.stringify(tally)}`
    );
  });
});
