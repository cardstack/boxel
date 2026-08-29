/**
 * The In place demo: a record read, then written.
 *
 * Two of these cases exist because of bugs the eye caught and the first
 * assertions did not, and both are about a crossing being undermined by the
 * layout underneath it rather than by the flight itself.
 */
import { click, find, render, settled } from '@ember/test-helpers';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { InlineEdit } from 'test-app/components/examples/inline-edit';
import { setupRenderingTest } from 'test-app/tests/helpers';

const frame = () => new Promise((r) => requestAnimationFrame(r));

const card = () => find('.ie-card') as HTMLElement;
const words = () =>
  [...document.querySelectorAll<HTMLElement>('.ie-word')]
    .filter((el) => !el.closest('[data-choreo-orphans]'))
    .map((el) => el.textContent?.trim());

/** every field's box, in CSS pixels — offsetHeight, because QUnit scales the
 *  test container and a rect would measure the harness */
const boxes = () =>
  [...document.querySelectorAll<HTMLElement>('.ie-box')].map(
    (el) => el.offsetHeight
  );

async function mount() {
  await render(<template><InlineEdit /></template>);
  await animationsSettled();
}

module('Integration | examples | inline edit', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('the record reads as a card and writes as a form', async function (assert) {
    await mount();
    assert.strictEqual(card().dataset['mode'], 'view', 'starts reading');
    assert.deepEqual(
      words(),
      [
        'Marguerite',
        'Villanueva',
        'm.villanueva@kiln.studio',
        '14',
        'March',
        '1986',
      ],
      'every value is split into the words that will each fly'
    );
    assert.strictEqual(
      document.querySelectorAll('.ie-label').length,
      0,
      'no field labels while reading'
    );

    await click('[data-test-toggle]');
    await animationsSettled();
    assert.strictEqual(card().dataset['mode'], 'edit', 'now writing');
    assert.strictEqual(
      document.querySelectorAll('[contenteditable="true"]').length,
      3,
      'all three boxes became editable'
    );
    assert.strictEqual(
      document.querySelectorAll('.ie-label').length,
      3,
      'the labels arrived with them'
    );
    assert.deepEqual(words(), words(), 'the same words, re-set');
  });

  /**
   * The regression that made the whole thing read as a jolt.
   *
   * `initial` states that an arriving word starts at the type it is leaving —
   * 30px for the name — and font-size is LAYOUT. Without a fixed field box the
   * editor laid those words out full size, wrapped them to two lines, stood
   * 87px tall and then collapsed to 36. The words were flying correctly the
   * whole time; the boxes underneath them were not holding still.
   */
  test('the field boxes do not resize while the crossing runs', async function (assert) {
    await mount();
    const rest = boxes();
    assert.deepEqual(rest, [40, 40, 40], 'three fields, one fixed box each');

    const toggle = find('[data-test-toggle]') as HTMLElement;
    toggle.click();
    const during: number[][] = [];
    for (let i = 0; i < 4; i++) {
      await frame();
      during.push(boxes());
    }
    await settled();
    await animationsSettled();

    for (const sample of during) {
      assert.deepEqual(
        sample.filter((h) => h > 0),
        rest,
        `boxes hold at ${rest[0]}px mid-crossing (got ${JSON.stringify(sample)})`
      );
    }
    assert.deepEqual(boxes(), rest, 'and after it settles');
  });

  test('a word is one element in both states, never a pair to align', async function (assert) {
    await mount();
    const before = find('[data-test-field="name"] .ie-word') as HTMLElement;
    await click('[data-test-toggle]');
    await animationsSettled();
    const after = find('[data-test-field="name"] .ie-word') as HTMLElement;
    assert.strictEqual(
      before,
      after,
      'the very same node — so there is no counterpart for the crossing to pin, ' +
        'and no second copy to slide past the first'
    );
    assert.strictEqual(
      document.querySelectorAll('[data-choreo-orphans] .ie-word').length,
      0,
      'and no word is ever orphaned'
    );
  });

  test('the card does not grow when the form arrives', async function (assert) {
    await mount();
    const reading = card().offsetHeight;
    await click('[data-test-toggle]');
    await animationsSettled();
    assert.strictEqual(
      card().offsetHeight,
      reading,
      `the frame is pinned at the taller state ${JSON.stringify({
        cardWidth: card().offsetWidth,
        stage: (find('.ex') as HTMLElement).offsetWidth,
        writing: card().offsetHeight,
        reading,
      })}`
    );
  });

  test('what was typed is what is read back', async function (assert) {
    await mount();
    await click('[data-test-toggle]');
    await animationsSettled();

    // Type the way a person does: change the text INSIDE a word, rather than
    // replacing the box's children. `textContent = '...'` on the box removes
    // every span Glimmer is holding and the next render throws `insertBefore`
    // against nodes that are no longer there — a thing the test could do and
    // a caret cannot.
    const editor = find('[data-test-field="name"]') as HTMLElement;
    const first = editor.querySelector('.ie-word') as HTMLElement;
    first.textContent = 'Margarethe';

    await click('[data-test-toggle]');
    await animationsSettled();

    const value = find('[data-test-field="name"]') as HTMLElement;
    assert.strictEqual(
      value.textContent?.replace(/\s+/g, ' ').trim(),
      'Margarethe Villanueva',
      'the commit reads the live node before the pass tears it down'
    );
    assert.strictEqual(
      (find('[data-test-avatar]') as HTMLElement).textContent?.trim(),
      'MV',
      'and the initials are derived again from the new name'
    );
  });
});
