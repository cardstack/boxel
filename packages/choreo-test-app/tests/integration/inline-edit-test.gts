/**
 * The In place demo: a record read, then written.
 *
 * The cases here exist because of bugs the eye caught and the first
 * assertions did not, and they are all about the same thing — the type is
 * not laid out by the browser, so the assertions have to check the numbers
 * the demo computed rather than trusting that flow got it right.
 */
import { click, fillIn, find, render, settled } from '@ember/test-helpers';
import { animationsSettled, setupMotion } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';
import { InlineEdit } from 'test-app/components/examples/inline-edit';
import { setupRenderingTest } from 'test-app/tests/helpers';

const card = () => find('.ie-card') as HTMLElement;
const mode = () => card().dataset['mode'];
const toggle = () => click('[data-test-toggle]');

const field = (key: string) =>
  find(`.ie-field[data-field="${key}"]`) as HTMLElement;

/**
 * Left edges in LAYOUT pixels, not viewport ones.
 *
 * `getBoundingClientRect` includes every transform above the element, and
 * QUnit scales `#ember-testing` by half — so a word the demo places at 11
 * measures 5.5, and an assertion written against the numbers the component
 * computed fails for a reason that has nothing to do with the component.
 * The fixture's scale is recovered from the card, which knows its own width
 * in both spaces, and every read is divided by it.
 */
const scale = () => card().getBoundingClientRect().width / card().offsetWidth;

const left = (el: HTMLElement) => {
  const base = el.closest('.ie-field') as HTMLElement;
  return (
    (el.getBoundingClientRect().left - base.getBoundingClientRect().left) /
    scale()
  );
};

const round = (value: number) => +value.toFixed(1);

const wordX = (key: string) =>
  [...field(key).querySelectorAll<HTMLElement>('.ie-word')].map((el) =>
    round(left(el))
  );

/**
 * Where each control PAINTS, not where its box starts. A text input draws
 * its value at its content edge, so the mark a word has to hit is the
 * control's left plus its own padding — which is exactly the inset the
 * component folded into pretext's numbers.
 */
const controlTextX = (key: string) =>
  [...field(key).querySelectorAll<HTMLElement>('.pt-input')].map((el) =>
    round(left(el) + parseFloat(getComputedStyle(el).paddingLeft))
  );

module('Integration | inline edit', function (hooks) {
  setupRenderingTest(hooks);
  setupMotion(hooks);

  test('the record reads as a string and writes as real fields', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();

    assert.strictEqual(mode(), 'view', 'it opens on the reading view');
    assert.strictEqual(
      find('.ie-field[data-field="name"] .ie-value')?.textContent?.trim(),
      'Marguerite Villanueva',
      'the reading view is an ordinary string in ordinary flow'
    );
    assert.notOk(
      find('.pt-input'),
      'and there is no form control anywhere in it'
    );

    await toggle();
    await animationsSettled();

    assert.strictEqual(mode(), 'edit', 'the toggle opens the form');
    assert.notOk(
      find('.ie-value'),
      'the reading string is gone — these are not two skins of one element'
    );

    // the point of copying pretui's field shapes in: real controls, real
    // types. An email input is the mobile keyboard and the autofill
    // category, neither of which a text input with a placeholder gives you.
    const name = find('.ie-field[data-field="name"] input') as HTMLInputElement;
    const email = find(
      '.ie-field[data-field="email"] input'
    ) as HTMLInputElement;
    assert.strictEqual(name.type, 'text', 'the name is a text input');
    assert.strictEqual(email.type, 'email', 'the email is an email input');
    assert.strictEqual(
      email.autocomplete,
      'email',
      'and carries the autofill category that makes that worth doing'
    );
    assert.strictEqual(
      controlTextX('dob').length,
      3,
      'the date is segmented — day, month and year, each its own control'
    );
  });

  /**
   * The assertion the whole design exists for.
   *
   * pretext computes where every word will sit in a pose that is NOT
   * rendered. If that arithmetic and the stylesheet ever disagree, a word
   * flies to a place its control is not, and the handover shows as a ghost
   * a few pixels off the real glyphs. Nothing about the flight looks wrong
   * in a still frame, which is exactly why this is a test.
   */
  test('every word lands exactly where its control paints', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    await toggle();
    await animationsSettled();

    // a field with one control has one landing mark, and only its first
    // word can be checked against it; the date has three, one per word
    for (const key of ['name', 'email']) {
      assert.strictEqual(
        wordX(key)[0],
        controlTextX(key)[0],
        `${key}'s first word lands exactly where its control paints`
      );
    }

    assert.deepEqual(
      wordX('dob'),
      controlTextX('dob'),
      'and every date word lands on its own segment, to the pixel'
    );

    assert.deepEqual(
      wordX('dob'),
      [11, 49, 159],
      'and the date lands on three separate segments, not one flowed line'
    );
  });

  /**
   * The bug the eye caught first: "14 March 1986" arriving as "14  March1986".
   *
   * Each word used to travel alone, so nothing was interpolating the LINE —
   * and the space between two words is a property of neither of them. The
   * assertion is on the word ORIGINS rather than on the gaps between their
   * painted boxes, and that is deliberate: a gap is an origin minus the
   * previous word's rendered width, and a rendered width depends on a
   * webfont this fixture does not load. The origins are the model's, and the
   * model is what regressed.
   */
  test('a line moves as a line, not as three words', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();

    const start = wordX('dob');
    await click('[data-test-toggle]');

    const samples: number[][] = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((go) => requestAnimationFrame(go));
      samples.push(wordX('dob'));
    }
    await animationsSettled();
    const end = wordX('dob');

    assert.strictEqual(start.length, 3, 'the date reads as three words');
    for (const sample of samples) {
      assert.deepEqual(
        [...sample].sort((a, b) => a - b),
        sample,
        `the words never cross each other (${JSON.stringify(sample)})`
      );
      sample.forEach((x, index) => {
        const low = Math.min(start[index]!, end[index]!) - 0.5;
        const high = Math.max(start[index]!, end[index]!) + 0.5;
        assert.ok(
          x >= low && x <= high,
          `word ${index} stays between its two poses (${x} in ${low}..${high})`
        );
      });
    }
  });

  /**
   * The form's chrome belongs to the container, not to the text.
   *
   * The plate and the label used to live INSIDE the field, and the field is
   * the one thing in a row that travels — the date flies the width of the
   * card. So the plate stretched and slid across the card behind the words
   * and the label came sailing in from the right, and the transition read as
   * the layout being yanked rather than as the type moving. They are
   * siblings sharing the field's grid area now, in no Move at all: they are
   * at their destination on the first frame and stay there.
   */
  test('the plates do not travel — they are where they land, from frame one', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();

    const plates = () =>
      [...document.querySelectorAll<HTMLElement>('.ie-plate')].map((el) => {
        const box = el.getBoundingClientRect();
        return [Math.round(box.left), Math.round(box.width)].join('x');
      });

    await click('[data-test-toggle]');
    const during: string[][] = [];
    for (let i = 0; i < 5; i++) {
      await new Promise((go) => requestAnimationFrame(go));
      during.push(plates());
    }
    await animationsSettled();
    const landed = plates();

    for (const sample of during) {
      assert.deepEqual(
        sample,
        landed,
        'the chrome never moves while the type is in flight'
      );
    }
  });

  /**
   * The flight is the MIDDLE phase: never two copies of a value on screen.
   *
   * `visibility` rather than opacity is load-bearing, and the assertion is
   * written against it on purpose. A participant's opacity belongs to the
   * engine — it renders one inline — so a stylesheet rule is simply
   * outvoted, and the words sat fully opaque over the controls with CSS that
   * clearly said otherwise. Nothing in the library writes `visibility`.
   */
  test('exactly one copy of a value is on screen at rest', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();

    const shown = () =>
      [...document.querySelectorAll<HTMLElement>('.ie-word')]
        .filter((el) => !el.closest('[data-choreo-orphans]'))
        .filter((el) => getComputedStyle(el).visibility !== 'hidden').length;

    assert.strictEqual(shown(), 0, 'nothing over the reading string');

    await toggle();
    await animationsSettled();

    assert.strictEqual(shown(), 0, 'nothing over the form controls');
    assert.notOk(
      (find('.ie') as HTMLElement).dataset['flying'],
      'and the arming has stood down once the pass has settled'
    );
  });

  /** the card is a card at both ends: the form is taller, and that is all */
  test('the card changes height and nothing else drifts', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    const box = () => ({
      height: card().offsetHeight,
      top: Math.round(card().getBoundingClientRect().top),
      width: card().offsetWidth,
    });
    const before = box();

    await toggle();
    await animationsSettled();
    const after = box();

    assert.strictEqual(after.width, before.width, 'the card keeps its width');
    assert.ok(
      after.height > before.height + 20,
      `the form is meaningfully taller (${before.height} to ${after.height})`
    );
    assert.strictEqual(
      after.top,
      before.top,
      'and grows downward from a pinned top edge, so nothing above it drifts'
    );
  });

  test('what was typed is what is read back', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    await toggle();
    await animationsSettled();

    await fillIn('.ie-field[data-field="name"] input', 'Margarethe Vela');
    await settled();
    await toggle();
    await animationsSettled();

    assert.strictEqual(
      find('.ie-field[data-field="name"] .ie-value')?.textContent?.trim(),
      'Margarethe Vela',
      'the reading view shows what the input was given'
    );
    assert.deepEqual(
      [...field('name').querySelectorAll<HTMLElement>('.ie-word')].map((el) =>
        el.textContent?.trim()
      ),
      ['Margarethe', 'Vela'],
      'and the flight was re-planned for the new words'
    );
  });
});
