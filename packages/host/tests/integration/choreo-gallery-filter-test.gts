import { click } from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  GALLERY_DEMOS,
  galleryInstance,
  setupChoreoGalleryTest,
} from '../helpers/choreo-gallery-stage';

/** the catalog: every linked demo, with the group it files under */
const catalog = GALLERY_DEMOS.map((slug) => ({
  slug,
  group: galleryInstance(`demos/${slug}.json`).data.attributes.group,
}));

function chip(label: string) {
  const found = [...document.querySelectorAll('.chip')].find(
    (c) => c.textContent?.trim() === label,
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
    (card) => Number(getComputedStyle(card).opacity) > 0.5,
  );
}

module('Integration | Choreo gallery | gallery filter', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  test('filtering out and back leaves every card on screen', async function (assert) {
    await gallery.renderGallery();
    await afterTheSwitch();
    assert.strictEqual(visible().length, catalog.length, 'all of them at rest');

    await click(chip('Drag'));
    await afterTheSwitch();
    const drag = catalog.filter((demo) => demo.group === 'Drag').length;
    assert.strictEqual(visible().length, drag, 'only the drag demos');
    const fading = [...document.querySelectorAll<HTMLElement>('.card')].filter(
      (card) => Number(getComputedStyle(card).opacity) <= 0.5,
    );
    assert.true(
      fading.every((card) => card.inert),
      `the cards on their way out take no input (${fading.length} leaving)`,
    );

    await click(chip('All'));
    await afterTheSwitch();
    assert.strictEqual(
      visible().length,
      catalog.length,
      `and back to all of them (dom=${document.querySelectorAll('.card').length})`,
    );
  });
});
