// Pretui — proof for PipScale.
//
// The file exists because a pip scale is two claims, and each needs a
// different kind of evidence:
//
//  1. **The arithmetic is right where the source's is wrong.** That is
//     asserted against the exported pure functions, with the source's own two
//     failing cases written out as numbers, so the claim in the header
//     comment is checkable rather than rhetorical.
//  2. **The pips are reachable from a keyboard.** The library the vocabulary
//     came from renders them `aria-hidden` with pointer handlers only, so the
//     whole point of the port is a keyboard path — and a claim about a
//     keyboard path is worth nothing until a keyboard has walked it.
//
// Per the realm law this file NEVER asserts a computed style: `boxel test`
// stamps the scoped-CSS attribute and delivers no stylesheet, so every
// computed value reads as its initial. Structure, ARIA, focus and callbacks
// are what the component actually controls.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click, focus, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { Slider } from './components/slider';
import { PipScale, decimalsOf, derivePipStep, inSpan, labelEveryFor, pipValuesFor, roundTo } from './components/pip-scale';

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function all(selector: string): HTMLElement[] {
  return Array.from(root().querySelectorAll<HTMLElement>(selector));
}
function one(selector: string): HTMLElement {
  return root().querySelector(selector) as HTMLElement;
}
function pipButtons(): HTMLElement[] {
  return all('.pretui-pip-hit');
}
function focusedIndex(): string | null {
  let el = document.activeElement as HTMLElement | null;
  return el === null ? null : el.getAttribute('data-pip-index');
}

class Picks {
  @tracked last: number | undefined = undefined;
  @tracked count = 0;
  take = (v: number) => {
    this.last = v;
    this.count = this.count + 1;
  };
}

module('Pretui | PipScale | geometry', function () {
  test('decimalsOf reads the precision off the step', function (assert) {
    assert.strictEqual(decimalsOf(1), 0, 'an integer step needs no decimals');
    assert.strictEqual(decimalsOf(50), 0);
    assert.strictEqual(decimalsOf(0.1), 1);
    // The source's `precision` prop defaults to 2, which rounds a 0.001 step
    // onto the nearest hundredth and collapses pips onto each other.
    assert.strictEqual(decimalsOf(0.001), 3, 'a fine step keeps its own precision');
    assert.strictEqual(decimalsOf(0), 0, 'a zero step does not divide by itself');
  });

  test('roundTo kills binary-float noise', function (assert) {
    assert.strictEqual(roundTo(0.1 + 0.2, 1), 0.3);
    assert.strictEqual(roundTo(1900 + 3 * 10, 0), 1930);
  });

  test('derivePipStep is dimensionless — the two cases the source gets wrong', function (assert) {
    // min 0, max 100, step 0.1 → 1000 steps. The source's formula
    // `(max - min) / (stepMax / 5)` yields 5, and 100 / (0.1 * 5) = 200 pips.
    let fine = derivePipStep(1000, 20, 120);
    assert.strictEqual(fine, 50, 'fifty steps per pip');
    assert.strictEqual(
      pipValuesFor(0, 100, 0.1, fine, 1).length,
      21,
      'twenty-one pips, not two hundred',
    );

    // min 0, max 10000, step 10 → 1000 steps. The source's formula yields
    // 500, and 10000 / (10 * 500) = 2 pips.
    let coarse = derivePipStep(1000, 20, 120);
    assert.strictEqual(
      pipValuesFor(0, 10000, 10, coarse, 0).length,
      21,
      'twenty-one pips, not two',
    );

    // The count of pips follows the count of STEPS, so both rails above
    // resolve to the same span even though their numeric widths differ by a
    // factor of a hundred.
    assert.strictEqual(fine, coarse, 'the ratio is over steps, not over units');
  });

  test('derivePipStep doubles the span until the ceiling is met', function (assert) {
    assert.strictEqual(derivePipStep(10000, 5000, 20), 1024);
    assert.true(10000 / 1024 + 1 <= 20, 'the resulting count fits the cap');
    assert.strictEqual(derivePipStep(4, 20, 120), 1, 'never finer than one step');
  });

  test('pipValuesFor merges a trailing pip that would collide with the last', function (assert) {
    // 0…10 at an interval of 3 would otherwise draw 9 and 10 a tenth of the
    // rail apart — the source's collision.
    assert.deepEqual(pipValuesFor(0, 10, 1, 3, 0), [0, 3, 6, 10]);
    assert.deepEqual(pipValuesFor(0, 100, 1, 25, 0), [0, 25, 50, 75, 100]);
    assert.deepEqual(pipValuesFor(0, 1, 0.25, 1, 2), [0, 0.25, 0.5, 0.75, 1]);
  });

  test('pipValuesFor survives a degenerate rail', function (assert) {
    assert.deepEqual(pipValuesFor(5, 5, 1, 1, 0), [5], 'no width, one pip');
    assert.deepEqual(pipValuesFor(10, 0, 1, 1, 0), [10], 'inverted, one pip');
  });

  test('labelEveryFor thins labels independently of ticks', function (assert) {
    assert.strictEqual(labelEveryFor(21, 8), 3);
    assert.strictEqual(labelEveryFor(6, 8), 1, 'under the cap, label them all');
    assert.strictEqual(labelEveryFor(101, 2), 100, 'a cap of two keeps the ends');
  });

  test('inSpan covers the three fill shapes', function (assert) {
    assert.true(inSpan(50, [20, 80], true), 'between a pair');
    assert.false(inSpan(20, [20, 80], true), 'the endpoints are selected, not span');
    assert.false(inSpan(90, [20, 80], true));
    assert.true(inSpan(10, [50], 'min'), 'below a single value');
    assert.false(inSpan(60, [50], 'min'));
    assert.true(inSpan(60, [50], 'max'), 'above a single value');
    assert.false(inSpan(50, [], true), 'no values, no span');
    assert.false(inSpan(50, [20, 80], undefined), 'no span arg, no span');
  });
});

module('Pretui | PipScale | rendering', function (hooks) {
  setupCardTest(hooks);

  test('a scale with no onPick is decoration — no buttons, no tab stops', async function (assert) {
    await render(<template>
      <PipScale @min={{0}} @max={{100}} @step={{1}} @pips='labels' />
    </template>);
    assert.dom('[data-test-pretui-pipscale]').exists();
    assert
      .dom('[data-test-pretui-pipscale]')
      .hasAttribute('aria-hidden', 'true', 'hidden wholesale from the a11y tree');
    assert.strictEqual(pipButtons().length, 0, 'nothing focusable');
    assert.dom('[data-test-pretui-pipscale]').doesNotHaveAttribute('role');
  });

  test('an interactive scale is one group of named buttons', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{1}}
        @targetPips={{4}}
        @pips='labels'
        @label='Pick a value'
        @onPick={{picks.take}}
      />
    </template>);
    assert.dom('[data-test-pretui-pipscale]').hasAttribute('role', 'group');
    assert
      .dom('[data-test-pretui-pipscale]')
      .hasAttribute('aria-label', 'Pick a value');
    assert
      .dom('[data-test-pretui-pipscale]')
      .doesNotHaveAttribute('aria-hidden', 'interactive scales are not hidden');
    let buttons = pipButtons();
    assert.strictEqual(buttons.length, 5, 'five pips at a target of four');
    assert.strictEqual(
      buttons[0]?.getAttribute('aria-label'),
      '0',
      'every pip carries its value as its accessible name',
    );
    assert.strictEqual(buttons[4]?.getAttribute('aria-label'), '100');
  });

  test('prefix, suffix and formatValue reach the label and the name together', async function (assert) {
    let picks = new Picks();
    let money = (v: number) => String(v);
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{50}}
        @pips='labels'
        @prefix='$'
        @suffix='.00'
        @formatValue={{money}}
        @onPick={{picks.take}}
      />
    </template>);
    let buttons = pipButtons();
    assert.strictEqual(buttons[0]?.getAttribute('aria-label'), '$0.00');
    assert.dom(one('.pretui-pip-label')).hasText('$0.00');
    let labels = all('.pretui-pip-label').map((el) => el.textContent?.trim());
    assert.deepEqual(
      labels,
      ['$0.00', '$50.00', '$100.00'],
      'the visible label and the accessible name never diverge',
    );
  });

  test('exactly one pip is in the tab sequence', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale @min={{0}} @max={{10}} @step={{1}} @onPick={{picks.take}} />
    </template>);
    let stops = pipButtons().filter((el) => el.tabIndex === 0);
    assert.strictEqual(stops.length, 1, 'one tab stop for the whole scale');
    assert.strictEqual(
      stops[0]?.getAttribute('data-pip-index'),
      '0',
      'and it starts at the first pip',
    );
  });

  test('clicking a pip reports its value', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{25}}
        @pips='labels'
        @onPick={{picks.take}}
      />
    </template>);
    await click('.pretui-pip[data-pip-value="75"] .pretui-pip-hit');
    assert.strictEqual(picks.last, 75, 'the pip reports the value it draws');
    assert.strictEqual(picks.count, 1);
  });

  test('the arrows, Home and End walk the scale', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale @min={{0}} @max={{10}} @step={{1}} @onPick={{picks.take}} />
    </template>);
    let buttons = pipButtons();
    assert.strictEqual(buttons.length, 11);
    let first = buttons[0] as HTMLElement;
    await focus(first);
    assert.strictEqual(focusedIndex(), '0');
    await triggerKeyEvent(first, 'keydown', 'ArrowRight');
    assert.strictEqual(focusedIndex(), '1', 'ArrowRight advances');
    let second = pipButtons()[1] as HTMLElement;
    await triggerKeyEvent(second, 'keydown', 'ArrowLeft');
    assert.strictEqual(focusedIndex(), '0', 'ArrowLeft retreats');
    await triggerKeyEvent(pipButtons()[0] as HTMLElement, 'keydown', 'End');
    assert.strictEqual(focusedIndex(), '10', 'End lands on the last pip');
    await triggerKeyEvent(pipButtons()[10] as HTMLElement, 'keydown', 'Home');
    assert.strictEqual(focusedIndex(), '0', 'Home lands on the first');
    assert.strictEqual(picks.count, 0, 'moving is not picking');
  });

  test('an arrow at either end parks rather than wrapping', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale @min={{0}} @max={{4}} @step={{1}} @onPick={{picks.take}} />
    </template>);
    let first = pipButtons()[0] as HTMLElement;
    await focus(first);
    await triggerKeyEvent(first, 'keydown', 'ArrowLeft');
    assert.strictEqual(focusedIndex(), '0', 'the scale has two ends, not a loop');
    await triggerKeyEvent(pipButtons()[0] as HTMLElement, 'keydown', 'End');
    let last = pipButtons()[4] as HTMLElement;
    await triggerKeyEvent(last, 'keydown', 'ArrowRight');
    assert.strictEqual(focusedIndex(), '4');
  });

  test('the base mode and the per-position overrides compose', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{10}}
        @pipStep={{1}}
        @pips='ticks'
        @first='labels'
        @last='labels'
        @onPick={{picks.take}}
      />
    </template>);
    let labels = all('.pretui-pip-label').map((el) => el.textContent?.trim());
    assert.deepEqual(labels, ['0', '100'], 'ticks throughout, labels at the ends');
    assert.strictEqual(pipButtons().length, 11, 'every tick is still a target');
    assert
      .dom('.pretui-pip[data-pip-place="first"]')
      .exists({ count: 1 }, 'one first pip');
    assert.dom('.pretui-pip[data-pip-place="last"]').exists({ count: 1 });
  });

  test("a position set to 'none' removes those pips entirely", async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{25}}
        @pipStep={{1}}
        @pips='none'
        @first='labels'
        @last='labels'
        @onPick={{picks.take}}
      />
    </template>);
    assert.strictEqual(pipButtons().length, 2, 'only the two ends survive');
    let indices = pipButtons().map((el) => el.getAttribute('data-pip-index'));
    assert.deepEqual(
      indices,
      ['0', '1'],
      'and they are renumbered over the pips actually drawn',
    );
  });

  test('maxLabels governs label density independently of tick density', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{1}}
        @pipStep={{5}}
        @pips='labels'
        @maxLabels={{4}}
        @onPick={{picks.take}}
      />
    </template>);
    assert.strictEqual(pipButtons().length, 21, 'twenty-one ticks');
    assert.true(
      all('.pretui-pip-label').length <= 4,
      'but no more labels than the cap allows',
    );
    let labels = all('.pretui-pip-label').map((el) => el.textContent?.trim());
    assert.strictEqual(labels[0], '0', 'the first end is always labelled');
    assert.strictEqual(
      labels[labels.length - 1],
      '100',
      'and so is the last — they are the anchors',
    );
  });

  test('a range paints the pips between its thumbs', async function (assert) {
    let picks = new Picks();
    let pair: [number, number] = [25, 75];
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{25}}
        @values={{pair}}
        @span={{true}}
        @onPick={{picks.take}}
      />
    </template>);
    let state = (v: string) =>
      one('.pretui-pip[data-pip-value="' + v + '"]').getAttribute(
        'data-pip-state',
      );
    assert.strictEqual(state('0'), 'plain', 'below the band');
    assert.strictEqual(state('25'), 'selected', 'the lower thumb sits here');
    assert.strictEqual(state('50'), 'span', 'inside the band');
    assert.strictEqual(state('75'), 'selected', 'the upper thumb sits here');
    assert.strictEqual(state('100'), 'plain', 'above the band');
  });

  test('limits draw the unavailable window without hiding it', async function (assert) {
    let picks = new Picks();
    let allowed: [number, number] = [25, 75];
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{25}}
        @limits={{allowed}}
        @onPick={{picks.take}}
      />
    </template>);
    assert.strictEqual(pipButtons().length, 5, 'the whole scale is still drawn');
    assert
      .dom('.pretui-pip[data-pip-value="0"]')
      .hasAttribute('data-pip-state', 'limit');
    assert
      .dom('.pretui-pip[data-pip-value="50"]')
      .hasAttribute('data-pip-state', 'plain');
    await click('.pretui-pip[data-pip-value="0"] .pretui-pip-hit');
    assert.strictEqual(picks.count, 0, 'a pip outside the window takes no pick');
    await click('.pretui-pip[data-pip-value="50"] .pretui-pip-hit');
    assert.strictEqual(picks.last, 50, 'one inside it does');
  });

  test('disabled removes the controls and says so in the DOM', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{25}}
        @pips='labels'
        @disabled={{true}}
        @onPick={{picks.take}}
      />
    </template>);
    assert
      .dom('[data-test-pretui-pipscale]')
      .hasAttribute('data-pip-disabled', 'true');
    assert.strictEqual(pipButtons().length, 0, 'nothing to tab to');
    assert.strictEqual(
      all('.pretui-pip-label').length,
      5,
      'but the scale is still readable',
    );
  });

  // The composition claim: the scale takes nothing from inside `Slider`, so
  // the two sit side by side over one piece of state and neither knows about
  // the other. This is the argument for a component rather than an argument,
  // and it is the shape the PipScale usage page renders.
  test('it composes with Slider as a sibling over shared state', async function (assert) {
    let picks = new Picks();
    let pair: [number, number] = [25, 75];
    let format = (v: number) => String(v) + '%';
    await render(<template>
      <Slider
        @label='Coverage'
        @min={{0}}
        @max={{100}}
        @step={{25}}
        @range={{true}}
        @values={{pair}}
        @formatValue={{format}}
      />
      <PipScale
        @min={{0}}
        @max={{100}}
        @step={{25}}
        @pips='labels'
        @values={{pair}}
        @span={{true}}
        @formatValue={{format}}
        @label='Coverage scale'
        @onPick={{picks.take}}
      />
    </template>);
    assert.dom('[data-test-pretui-slider]').exists('the slider still renders');
    assert.dom('[data-test-pretui-pipscale]').exists('and the scale beside it');
    assert.strictEqual(
      all('input[type="range"]').length,
      2,
      'the two-thumb slider keeps both of its native inputs',
    );
    assert.strictEqual(
      one('.pretui-pip[data-pip-value="50"]').getAttribute('data-pip-state'),
      'span',
      'and the scale reads the same state the thumbs do',
    );
    await click('.pretui-pip[data-pip-value="100"] .pretui-pip-hit');
    assert.strictEqual(picks.last, 100, 'a pip pick reaches the shared owner');
  });

  test('a fine step keeps its own precision on the rendered labels', async function (assert) {
    let picks = new Picks();
    await render(<template>
      <PipScale
        @min={{0}}
        @max={{1}}
        @step={{0.25}}
        @pipStep={{1}}
        @pips='labels'
        @onPick={{picks.take}}
      />
    </template>);
    let labels = all('.pretui-pip-label').map((el) => el.textContent?.trim());
    assert.deepEqual(
      labels,
      ['0', '0.25', '0.5', '0.75', '1'],
      'no rounding onto a fixed two-decimal default',
    );
  });
});
