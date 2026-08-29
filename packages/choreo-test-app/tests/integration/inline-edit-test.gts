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
  find(`.ie-plate[data-field="${key}"]`) as HTMLElement;

const words = (key: string) => [
  ...document.querySelectorAll<HTMLElement>(`.ie-word[data-field="${key}"]`),
];

/**
 * Everything in CARD space, and in LAYOUT pixels.
 *
 * The type is no longer inside the platter it belongs to — it is a layer
 * over the whole card — so the only frame both layers share is the card's.
 * And `getBoundingClientRect` includes every transform above the element,
 * while QUnit scales `#ember-testing` by half, so a word the demo places at
 * 12 measures 6. The fixture's scale comes back out of the card, which knows
 * its own width in both spaces.
 */
const scale = () => card().getBoundingClientRect().width / card().offsetWidth;

const left = (el: Element) =>
  (el.getBoundingClientRect().left - card().getBoundingClientRect().left) /
  scale();

const round = (value: number) => +value.toFixed(1);

const wordX = (key: string) => words(key).map((el) => round(left(el)));

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
      find('.ie-value[data-value="name"]')?.textContent?.trim(),
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
    const name = find('.ie-plate[data-field="name"] input') as HTMLInputElement;
    const email = find(
      '.ie-plate[data-field="email"] input'
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

    // three separate origins, not one flowed line — and the gaps between
    // them are the measured chip widths, which is what `controlTextX` above
    // has already pinned them to
    const [day, month, year] = wordX('dob');
    assert.ok(
      day! < month! && month! < year!,
      `the date lands on three segments in order (${wordX('dob')})`
    );
  });

  /**
   * The redraw at the handover, which was a measurement error after all.
   *
   * The flight word and the real text have to be the SAME text — same size,
   * same weight, same tracking, same line box — or the last frame of the
   * flight and the first frame of the real thing are two different
   * renderings of one word, and the swap reads as a redraw. Two of those
   * were wrong: the reading view sets the name at -0.03em while `.ie-word`
   * wore the shared -0.01em, which is the tracking pretext had NOT measured
   * against, so every letter after the first drifted; and centring a 1.18
   * line box is not centring a 40px one, because where a glyph sits inside a
   * line box comes from the font's metrics, so the whole flight rode a
   * pixel high.
   */
  test('the flight and the real text are the same text, to the pixel', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    // a round trip first: the score owns size, weight and tracking, so a
    // word has none of them until a pass has run
    await toggle();
    await animationsSettled();
    await toggle();
    await animationsSettled();

    const glyphs = (el: HTMLElement) => {
      const range = document.createRange();
      range.setStart(el.firstChild!, 0);
      range.setEnd(el.firstChild!, Math.min(2, el.textContent!.length));
      return range.getBoundingClientRect();
    };

    for (const key of ['name', 'email', 'dob']) {
      const real = glyphs(
        find(`.ie-value[data-value="${key}"]`) as HTMLElement
      );
      const flown = glyphs(words(key)[0]!);
      assert.deepEqual(
        [
          Math.round(flown.left - real.left),
          Math.round(flown.top - real.top),
          Math.round(flown.width - real.width),
        ],
        [0, 0, 0],
        `${key} flies as the same text it lands as`
      );
    }
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
   * The two directions are not mirror images, and treating them as one broke
   * the other.
   *
   * Leaving the form there is a departing control holding the value at full
   * strength, so the word fades UP against it and the pair crossfades.
   * Entering it there is no such partner — the reading string is not a
   * participant, it simply unmounts — so a word that ramps from zero against
   * nothing is the value going missing for a fifth of a second. The whole
   * card washed out on the way in until the fade asked which way it was
   * going.
   */
  test('the type is never missing on the way into the form', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();

    const faint = () =>
      [...document.querySelectorAll<HTMLElement>('.ie-word')]
        .filter((el) => !el.closest('[data-choreo-orphans]'))
        .map((el) => Number(getComputedStyle(el).opacity))
        .filter((value) => value < 0.99);

    await click('[data-test-toggle]');
    for (let i = 0; i < 6; i++) {
      await new Promise((go) => requestAnimationFrame(go));
      assert.deepEqual(
        faint(),
        [],
        'every word is at full strength from the first frame in'
      );
    }
    await animationsSettled();
  });

  /**
   * And the white card tweens too, which took making it a participant.
   *
   * A region is the frame a crossing is measured IN — it is not one of the
   * things measured, so it has no before and after of its own. The card WAS
   * the region, so it snapped between its two heights on the first frame
   * while everything inside it flew. One element in, and it is FLIPped like
   * any other box.
   */
  test('the card tweens its height rather than snapping', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    const start = card().offsetHeight;

    await click('[data-test-toggle]');
    let played = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise((go) => requestAnimationFrame(go));
      if (/height|transform/.test(card().getAttribute('style') ?? '')) {
        played++;
      }
    }
    await animationsSettled();

    assert.notEqual(
      start,
      card().offsetHeight,
      'the card is a different height in the two poses'
    );
    assert.ok(
      played >= 2,
      `and its box was the move's for more than one frame (${played})`
    );
  });

  /**
   * The keyboard reaches Done by carrying on.
   *
   * The mode switch is placed in the card's corner by position, so its
   * document order is free — and it was first, which put Done between the
   * user and the form they were about to fill in. It is last now: tab out of
   * the year and the next stop is the button that commits.
   */
  test('Done is the last stop after the form', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    await toggle();
    await animationsSettled();

    assert.deepEqual(
      [
        ...(find('.ie-card') as HTMLElement).querySelectorAll<HTMLElement>(
          'input, select, button'
        ),
      ].map((el) => el.getAttribute('aria-label') ?? el.className),
      ['Name', 'Job title', 'Email', 'Day', 'Month', 'Year', 'ie-toggle'],
      'the form in order, and the commit at the end of it'
    );
  });

  /**
   * The platters TWEEN. They snapped once, and how they snapped is worth a
   * case of its own.
   *
   * The card's row heights were inline on the WRAPPER, which is outside the
   * region — so the mode change resized the card before the region had taken
   * its before-picture, every platter measured the same box twice, `c.moved`
   * selected nothing, and they arrived at their new lane on the first frame
   * while the type flew across on its own. Nothing errored, and every other
   * step still ran. The card picks its pose with its own attribute now, which
   * changes inside the region, where a change is a pass.
   */
  test('the platters tween their geometry rather than snapping', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();

    await click('[data-test-toggle]');
    // The MOVE writing to the element is the assertion, not the rendered
    // height: `#ember-testing` is scaled, and a scaled box part-way through a
    // projection is not a number worth reasoning about. If the move is
    // playing, the library owns the platter's box and says so inline.
    let played = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise((go) => requestAnimationFrame(go));
      if (/height|transform/.test(field('dob').getAttribute('style') ?? '')) {
        played++;
      }
    }
    await animationsSettled();

    assert.ok(
      played >= 2,
      `the platter's box was the move's for more than one frame (${played})`
    );
  });

  /**
   * The departing control fades, which nothing was doing for it.
   *
   * A crossing fades what it CROSSES: a leaver against the arrival that
   * claimed its identity. A form field is claimed by nobody — the reading
   * view has no counterpart for one, which is the point of the demo — so it
   * was ceasing to exist when the leave window closed, which reads as a cut
   * rather than as the form coming apart.
   */
  test('the form fades as it leaves, rather than blinking off', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    await toggle();
    await animationsSettled();

    const leaving = () =>
      [...document.querySelectorAll<HTMLElement>('[data-choreo-orphans] *')]
        .filter((el) => el.matches('.pt-input, .pt-date'))
        .map((el) => Number(getComputedStyle(el).opacity));

    await click('[data-test-toggle]');
    const samples: number[][] = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((go) => requestAnimationFrame(go));
      const shot = leaving();
      if (shot.length) {
        samples.push(shot);
      }
    }

    assert.ok(samples.length >= 2, 'the form was caught on its way out');
    assert.ok(
      Math.min(...samples[samples.length - 1]!) < Math.max(...samples[0]!),
      `it is fading (${JSON.stringify(samples)})`
    );
    await animationsSettled();
  });

  /**
   * The outline never leaves the platter, at rest or in flight.
   *
   * The platter and the field used to be two elements sharing a grid area —
   * one static, one travelling — and only one of them moved, so mid-flight
   * the outline stood at its form geometry, full width, while the type was
   * still laid out for a card. They are one box now, which is what makes
   * this assertion true by construction rather than by tuning: the outline
   * IS the platter's border, and everything a field holds is inside it.
   */
  test('nothing a field holds is ever outside its platter', async function (assert) {
    await render(<template><InlineEdit /></template>);
    await animationsSettled();
    await toggle();
    await animationsSettled();

    const escapes = () => {
      const out: string[] = [];
      for (const key of ['name', 'email', 'dob']) {
        const platter = field(key).getBoundingClientRect();
        for (const el of field(key).querySelectorAll<HTMLElement>(
          '.pt-input, .pt-date'
        )) {
          const box = el.getBoundingClientRect();
          if (
            box.left < platter.left - 0.5 ||
            box.right > platter.right + 0.5 ||
            box.top < platter.top - 0.5 ||
            box.bottom > platter.bottom + 0.5
          ) {
            out.push(`${key}:${el.className}`);
          }
        }
      }
      return out;
    };

    assert.deepEqual(escapes(), [], 'nothing escapes at rest in the form');

    await click('[data-test-toggle]');
    for (let i = 0; i < 6; i++) {
      await new Promise((go) => requestAnimationFrame(go));
      assert.deepEqual(escapes(), [], 'nor at any frame of the flight');
    }
    await animationsSettled();

    assert.deepEqual(escapes(), [], 'nor at rest in the reading view');
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

    await fillIn('.ie-plate[data-field="name"] input', 'Margarethe Vela');
    await settled();
    await toggle();
    await animationsSettled();

    assert.strictEqual(
      find('.ie-value[data-value="name"]')?.textContent?.trim(),
      'Margarethe Vela',
      'the reading view shows what the input was given'
    );
    assert.deepEqual(
      words('name').map((el) => el.textContent?.trim()),
      ['Margarethe', 'Vela'],
      'and the flight was re-planned for the new words'
    );
  });
});
