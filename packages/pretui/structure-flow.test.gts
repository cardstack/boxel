// Pretui — proof for Wizard, Defer and EditInPlace.
//
// What is asserted here is deliberate. Each of these three components was
// sourced from an upstream with a specific, named defect, and the point of
// this file is that the defect is gone and stays gone:
//
//   Wizard      `back()` fires the change callback (the upstream mutated the
//               index directly and bypassed its own notifier); a refused
//               advance is aria-disabled-but-focusable and says why;
//               `activeIndex` is clamped; a jump cannot pass a closed gate.
//   Defer       the gate really gates (the upstream's `new Boolean(...)`
//               guard was truthy for every value it ever saw); intent is
//               reachable by keyboard; the reserved space is on the host.
//   EditInPlace Escape cancels; Enter commits; focus moving to a control
//               INSIDE the editor does not commit (the upstream's premature
//               `focusout`); the display is never wrapped in a control.
//
// No test in this file asserts a computed style — `boxel test` stamps the
// scoped-CSS attribute and delivers no stylesheet, so structure, roles, ARIA
// and callbacks are the only honest evidence.
//
// Local-only test file; run with `boxel test` from this directory — do NOT
// push it to the realm (a pushed *.test.gts opts the realm into a QUnit
// gate).
import { module, test } from 'qunit';
import {
  render,
  click,
  focus,
  blur,
  fillIn,
  triggerKeyEvent,
  waitUntil,
} from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Defer } from './components/defer';
import { EditInPlace } from './components/edit-in-place';
import { Wizard } from './components/wizard';
import type { WizardChange, WizardStep } from './components/wizard';
import { DEMOS_WIZARD } from './components/wizard.usage';
import { DEMOS_DEFER } from './components/defer.usage';
import { DEMOS_EDIT_IN_PLACE } from './components/edit-in-place.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_WIZARD, ...DEMOS_DEFER, ...DEMOS_EDIT_IN_PLACE };
const DEMOS_STRUCTURE_FLOW_NAMES = ['Wizard', 'Defer', 'EditInPlace'];

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function one(selector: string): HTMLElement | null {
  return root().querySelector<HTMLElement>(selector);
}
function need(selector: string): HTMLElement {
  let el = one(selector);
  if (!el) {
    throw new Error('expected ' + selector + ' in the test root');
  }
  return el;
}
function text(selector: string): string {
  return one(selector)?.textContent?.trim() ?? '';
}

const STEPS: WizardStep[] = [
  { id: 'one', label: 'Account', valid: false, blockedReason: 'Email first.' },
  { id: 'two', label: 'Plan' },
  { id: 'three', label: 'Team', optional: true },
  { id: 'four', label: 'Review' },
];

class WizardState {
  @tracked index = 0;
  @tracked valid = false;
  @tracked completed = 0;
  @tracked refusedAt: number[] = [];
  moves: { to: number; change: WizardChange }[] = [];

  get steps(): WizardStep[] {
    return STEPS.map((step, i) =>
      i === 0 ? { ...step, valid: this.valid } : step,
    );
  }
  onStepChange = (to: number, change: WizardChange) => {
    this.moves = [...this.moves, { to, change }];
    this.index = to;
  };
  onComplete = () => (this.completed = this.completed + 1);
  onRefused = (i: number) => (this.refusedAt = [...this.refusedAt, i]);
}

module('Pretui | structure-flow | Wizard', function (hooks) {
  setupCardTest(hooks);

  test('the rail is an ordered list with aria-current, not a tablist', async function (assert) {
    let state = new WizardState();
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    assert.dom('[data-test-pretui-wizard]').exists('the wizard rendered');
    assert
      .dom('[data-test-pretui-wizard-rail] [data-test-pretui-step-list]')
      .exists('the rail IS StepList — composed, not reimplemented');
    assert
      .dom('[data-test-pretui-wizard] [role="tablist"]')
      .doesNotExist('a gated flow is not a tablist and must not claim to be');
    assert
      .dom('[data-test-pretui-wizard] [role="tab"]')
      .doesNotExist('nor are its steps tabs');

    let current = root().querySelectorAll('[aria-current="step"]');
    assert.strictEqual(current.length, 1, 'exactly one step is current');
    assert.strictEqual(text('[data-test-panel]'), 'Account');
  });

  test('the panel is a labelled group and its name is the step', async function (assert) {
    let state = new WizardState();
    await render(<template>
      <Wizard @steps={{state.steps}} @activeIndex={{state.index}}>
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    let panel = need('[data-test-pretui-wizard-panel]');
    assert.strictEqual(panel.getAttribute('role'), 'group');
    let labelledBy = panel.getAttribute('aria-labelledby');
    assert.ok(labelledBy, 'the panel names itself through a real element');
    let title = need('[data-test-pretui-wizard-title]');
    assert.strictEqual(title.id, labelledBy, 'and that element is the title');
    assert.strictEqual(title.textContent?.trim(), 'Account');
    assert.strictEqual(
      panel.getAttribute('tabindex'),
      '-1',
      'so navigation can land focus on it',
    );
  });

  test('a refused advance stays focusable and states its reason', async function (assert) {
    let state = new WizardState();
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
        @onRefused={{state.onRefused}}
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    let next = need('[data-test-pretui-wizard-next]');
    assert.strictEqual(
      next.getAttribute('aria-disabled'),
      'true',
      'aria-disabled, so it is still reachable and still explains itself',
    );
    assert.notOk(
      next.hasAttribute('disabled'),
      'never the disabled attribute — that is the upstream dead-button bug',
    );
    assert.strictEqual(
      text('[data-test-pretui-wizard-refusal]'),
      '',
      'a pristine wizard does not open shouting',
    );

    await click(next);
    assert.strictEqual(
      text('[data-test-pretui-wizard-refusal]'),
      'Email first.',
      'the reason appears only once the reader has actually been refused',
    );
    assert.strictEqual(
      need('[data-test-pretui-wizard-refusal]').getAttribute('role'),
      'alert',
      'and it is announced',
    );
    assert.deepEqual(state.refusedAt, [0], 'onRefused fired with the index');
    assert.deepEqual(state.moves, [], 'and nothing moved');
    assert.strictEqual(
      next.getAttribute('aria-describedby'),
      need('[data-test-pretui-wizard-refusal]').id,
      'the button points at the reason it just produced',
    );
  });

  test('advancing works once the step declares itself valid', async function (assert) {
    let state = new WizardState();
    state.valid = true;
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    await click('[data-test-pretui-wizard-next]');
    assert.strictEqual(state.index, 1);
    assert.strictEqual(state.moves[0]?.change.reason, 'next');
    assert.strictEqual(state.moves[0]?.change.from, 0);
    assert.strictEqual(text('[data-test-panel]'), 'Plan');
  });

  test('BACK fires onStepChange — the upstream bug this component exists to not have', async function (assert) {
    let state = new WizardState();
    state.valid = true;
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    await click('[data-test-pretui-wizard-next]');
    state.moves = [];
    await click('[data-test-pretui-wizard-back]');

    assert.strictEqual(state.moves.length, 1, 'a backwards move NOTIFIES');
    assert.strictEqual(state.moves[0]?.to, 0);
    assert.strictEqual(state.moves[0]?.change.reason, 'back');
    assert.strictEqual(state.index, 0);
  });

  test('Back on the first step is aria-disabled and inert, not removed', async function (assert) {
    let state = new WizardState();
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    let back = need('[data-test-pretui-wizard-back]');
    assert.strictEqual(back.getAttribute('aria-disabled'), 'true');
    await click(back);
    assert.deepEqual(state.moves, [], 'and it does nothing');
    assert
      .dom('[data-test-pretui-wizard-back]')
      .exists('but it keeps its space, so the footer never reflows');
  });

  test('an optional step offers Skip, and skipping bypasses the gate', async function (assert) {
    let state = new WizardState();
    state.valid = true;
    state.index = 2;
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    assert.dom('[data-test-pretui-wizard-skip]').exists('step three is optional');
    await click('[data-test-pretui-wizard-skip]');
    assert.strictEqual(state.index, 3);
    assert.strictEqual(state.moves[0]?.change.reason, 'skip');
    assert
      .dom('[data-test-pretui-wizard-skip]')
      .doesNotExist('step four is not optional, so there is nothing to skip');
  });

  test('a skipped step that is later completed shows as complete', async function (assert) {
    const OPEN_STEPS: WizardStep[] = [
      { id: 'one', label: 'Account' },
      { id: 'two', label: 'Plan' },
      { id: 'three', label: 'Team', optional: true },
      { id: 'four', label: 'Review' },
    ];
    await render(<template>
      <Wizard @steps={{OPEN_STEPS}}>
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);
    let states = () => Array.from(document.querySelectorAll('[data-test-pretui-step-list-items] [data-state]')).map((el) => el.getAttribute('data-state'));
    await click('[data-test-pretui-wizard-next]');
    await click('[data-test-pretui-wizard-next]');
    await click('[data-test-pretui-wizard-skip]');
    assert.strictEqual(states()[2], 'upcoming', 'skipped: not complete');
    await click('[data-test-pretui-wizard-back]');
    await click('[data-test-pretui-wizard-next]');
    assert.strictEqual(states()[2], 'complete', 'completed with Next after all');
  });

  test('the terminal step commits instead of advancing', async function (assert) {
    let state = new WizardState();
    state.index = 3;
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
        @onComplete={{state.onComplete}}
        @completeLabel='Start the trial'
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);

    assert.strictEqual(
      text('[data-test-pretui-wizard-next]'),
      'Start the trial',
      'the primary re-labels itself on the last step',
    );
    await click('[data-test-pretui-wizard-next]');
    assert.strictEqual(state.completed, 1);
    assert.deepEqual(state.moves, [], 'and it does not try to walk off the end');
  });

  test('an out-of-range activeIndex is clamped rather than rendering nothing', async function (assert) {
    let state = new WizardState();
    state.index = 99;
    await render(<template>
      <Wizard @steps={{state.steps}} @activeIndex={{state.index}}>
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);
    assert.strictEqual(text('[data-test-panel]'), 'Review', 'clamped to last');

    state.index = -4;
    await waitUntil(() => text('[data-test-panel]') === 'Account');
    assert.strictEqual(text('[data-test-panel]'), 'Account', 'clamped to first');
  });

  test('the yielded api refuses a jump that would pass a closed gate', async function (assert) {
    let state = new WizardState();
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
        @navigation='free'
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
        <:rail as |api|>
          <button
            type='button'
            data-test-jump
            {{on 'click' (fn api.goTo 3)}}
          >jump</button>
        </:rail>
      </Wizard>
    </template>);
    await click('[data-test-jump]');
    assert.strictEqual(
      state.index,
      3,
      'free navigation permits the jump outright',
    );
    assert.strictEqual(state.moves[0]?.change.reason, 'jump');
  });

  test('linear navigation refuses a forward jump past the next step', async function (assert) {
    let state = new WizardState();
    state.valid = true;
    await render(<template>
      <Wizard
        @steps={{state.steps}}
        @activeIndex={{state.index}}
        @onStepChange={{state.onStepChange}}
        @onRefused={{state.onRefused}}
        @navigation='linear'
      >
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
        <:rail as |api|>
          <button
            type='button'
            data-test-jump
            {{on 'click' (fn api.goTo 3)}}
          >jump</button>
        </:rail>
      </Wizard>
    </template>);

    await click('[data-test-jump]');
    assert.deepEqual(state.moves, [], 'linear means linear');
    assert.deepEqual(state.refusedAt, [0], 'and the refusal is reported');
  });

  test('zero steps renders a stated empty state, not a live footer', async function (assert) {
    let empty: WizardStep[] = [];
    await render(<template>
      <Wizard @steps={{empty}}>
        <:step as |step|><span data-test-panel>{{step.label}}</span></:step>
      </Wizard>
    </template>);
    assert.dom('[data-test-pretui-empty]').exists();
    assert.dom('[data-test-pretui-wizard-footer]').doesNotExist();
  });
});

// ═════════════════════════════════════════════════════════════════════════

class DeferState {
  @tracked when = false;
  @tracked reveals = 0;
  onReveal = () => (this.reveals = this.reveals + 1);
}

module('Pretui | structure-flow | Defer', function (hooks) {
  setupCardTest(hooks);

  test('manual: the gate really gates, and really opens', async function (assert) {
    let state = new DeferState();
    await render(<template>
      <Defer
        @trigger='manual'
        @when={{state.when}}
        @minHeight='140px'
        @onReveal={{state.onReveal}}
      >
        <:default><span data-test-heavy>expensive</span></:default>
      </Defer>
    </template>);

    assert
      .dom('[data-test-heavy]')
      .doesNotExist('nothing expensive is in the DOM');
    assert
      .dom('[data-test-pretui-defer-placeholder]')
      .exists('the placeholder is');
    assert.strictEqual(
      need('[data-test-pretui-defer]').getAttribute('aria-busy'),
      'true',
      'and it says so to assistive tech, which the upstream never did',
    );
    assert.strictEqual(
      need('[data-test-pretui-defer]').getAttribute('data-state'),
      'pending',
    );

    state.when = true;
    await waitUntil(() => one('[data-test-heavy]') !== null);
    assert.dom('[data-test-heavy]').exists('the content arrived');
    assert
      .dom('[data-test-pretui-defer-placeholder]')
      .doesNotExist('and the placeholder went');
    assert.strictEqual(
      need('[data-test-pretui-defer]').getAttribute('aria-busy'),
      'false',
    );
  });

  test('the reservation is written on the host and survives the swap', async function (assert) {
    let state = new DeferState();
    await render(<template>
      <Defer
        @trigger='manual'
        @when={{state.when}}
        @minHeight='140px'
        @aspect='16 / 9'
      >
        <:default><span data-test-heavy>expensive</span></:default>
      </Defer>
    </template>);

    // The style ATTRIBUTE is what the component controls; the computed value
    // is not, because boxel test delivers no scoped stylesheet.
    let host = need('[data-test-pretui-defer]');
    assert.ok(
      host.getAttribute('style')?.includes('min-block-size: 140px'),
      'the floor is reserved while pending',
    );
    assert.ok(
      host.getAttribute('style')?.includes('aspect-ratio: 16 / 9'),
      'so is the shape',
    );

    state.when = true;
    await waitUntil(() => one('[data-test-heavy]') !== null);
    assert.ok(
      host.getAttribute('style')?.includes('min-block-size: 140px'),
      'the floor is KEPT — a floor can never cause a shift',
    );
    assert.notOk(
      host.getAttribute('style')?.includes('aspect-ratio'),
      'the ratio is dropped — keeping it would distort real content',
    );
  });

  test('a hostile length is dropped whole rather than injected', async function (assert) {
    let evil = '140px; background: url(https://example.com/x)';
    await render(<template>
      <Defer @trigger='manual' @minHeight={{evil}}>
        <:default><span data-test-heavy>expensive</span></:default>
      </Defer>
    </template>);
    let style = need('[data-test-pretui-defer]').getAttribute('style');
    assert.notOk(
      style && style.includes('url('),
      'cssValue is an allowlist, not a sanitiser',
    );
  });

  test('intent is reachable by keyboard, which the upstream never was', async function (assert) {
    let state = new DeferState();
    await render(<template>
      <Defer
        @trigger='intent'
        @intentLabel='Load the revenue chart'
        @onReveal={{state.onReveal}}
      >
        <:default><span data-test-heavy>expensive</span></:default>
      </Defer>
    </template>);

    let trigger = need('[data-test-pretui-defer-intent]');
    assert.strictEqual(
      trigger.tagName,
      'BUTTON',
      'a real button, not a div with a mouseenter handler',
    );
    assert.strictEqual(
      trigger.getAttribute('aria-label'),
      'Load the revenue chart',
      'with a required accessible name',
    );

    await focus(trigger);
    await waitUntil(() => one('[data-test-heavy]') !== null);
    assert.dom('[data-test-heavy]').exists('focus alone reveals it');
    assert.strictEqual(state.reveals, 1, 'and it announced exactly once');
  });

  test('idle reveals through a one-shot, modifier-owned schedule', async function (assert) {
    let state = new DeferState();
    await render(<template>
      <Defer @trigger='idle' @idleTimeout={{0.05}} @onReveal={{state.onReveal}}>
        <:default><span data-test-heavy>expensive</span></:default>
      </Defer>
    </template>);

    await waitUntil(() => one('[data-test-heavy]') !== null, { timeout: 4000 });
    assert.dom('[data-test-heavy]').exists();
    assert.strictEqual(state.reveals, 1, 'once, and it never re-arms');
  });

  test('a custom placeholder replaces the Skeleton', async function (assert) {
    await render(<template>
      <Defer @trigger='manual' @minHeight='80px'>
        <:placeholder><span data-test-ph>reserved</span></:placeholder>
        <:default><span data-test-heavy>expensive</span></:default>
      </Defer>
    </template>);
    assert.dom('[data-test-ph]').exists();
    assert.dom('[data-test-pretui-skeleton]').doesNotExist();
  });
});

// ═════════════════════════════════════════════════════════════════════════

class EditState {
  @tracked value = 'Quarterly review';
  @tracked error = '';
  @tracked refuse = false;
  @tracked cancels = 0;
  commits: string[] = [];

  onCommit = (next: string) => {
    this.commits = [...this.commits, next];
    if (this.refuse) {
      this.error = 'Not allowed.';
      return false;
    }
    this.value = next;
    return true;
  };
  onCancel = () => (this.cancels = this.cancels + 1);
}

module('Pretui | structure-flow | EditInPlace', function (hooks) {
  setupCardTest(hooks);

  test('the display is never wrapped in a control', async function (assert) {
    let state = new EditState();
    await render(<template>
      <EditInPlace @label='Title' @value={{state.value}}>
        <:display><a href='#anchor' data-test-link>a link</a></:display>
      </EditInPlace>
    </template>);

    let display = need('[data-test-pretui-edit-in-place-display]');
    assert.notOk(
      display.getAttribute('role'),
      'no role="button" around arbitrary content — that is the upstream trap',
    );
    assert.notOk(
      display.hasAttribute('tabindex'),
      'and it is not a focus stop either',
    );
    assert
      .dom('[data-test-link]')
      .exists('so a link inside the display is still just a link');

    let trigger = need('[data-test-pretui-edit-in-place-trigger]');
    assert.strictEqual(trigger.tagName, 'BUTTON');
    assert.strictEqual(
      trigger.getAttribute('aria-label'),
      'Edit Title',
      'the affordance is real, named, and adjacent',
    );
  });

  test('activating opens a named editor and moves focus into it', async function (assert) {
    let state = new EditState();
    await render(<template>
      <EditInPlace @label='Title' @value={{state.value}}>
        <:display><span>{{state.value}}</span></:display>
      </EditInPlace>
    </template>);

    await click('[data-test-pretui-edit-in-place-trigger]');
    assert.dom('[data-test-pretui-edit-in-place-editor]').exists();

    let input = need('[data-test-pretui-edit-in-place-editor] input');
    assert.strictEqual(
      document.activeElement,
      input,
      'focus lands on the control, not on the wrapper',
    );
    let label = need('[data-test-pretui-edit-in-place-editor] label');
    assert.strictEqual(
      label.getAttribute('for'),
      input.id,
      'a real <label for> gives the editor its name',
    );
    assert.strictEqual(label.textContent?.trim(), 'Title');
    assert.strictEqual(
      text('[data-test-pretui-edit-in-place-live]'),
      'Editing Title',
      'and the mode change is announced',
    );
  });

  test('Enter commits, Escape cancels', async function (assert) {
    let state = new EditState();
    await render(<template>
      <EditInPlace
        @label='Title'
        @value={{state.value}}
        @onCommit={{state.onCommit}}
        @onCancel={{state.onCancel}}
      >
        <:display><span data-test-shown>{{state.value}}</span></:display>
      </EditInPlace>
    </template>);

    await click('[data-test-pretui-edit-in-place-trigger]');
    let input = need(
      '[data-test-pretui-edit-in-place-editor] input',
    ) as HTMLInputElement;
    await fillIn(input, 'Half-year review');
    await triggerKeyEvent(input, 'keydown', 'Enter');

    assert.deepEqual(state.commits, ['Half-year review'], 'Enter committed');
    assert.strictEqual(text('[data-test-shown]'), 'Half-year review');
    assert
      .dom('[data-test-pretui-edit-in-place-editor]')
      .doesNotExist('and the editor closed');
    assert.strictEqual(
      document.activeElement,
      need('[data-test-pretui-edit-in-place-trigger]'),
      'focus returned to the affordance it came from',
    );

    await click('[data-test-pretui-edit-in-place-trigger]');
    let again = need(
      '[data-test-pretui-edit-in-place-editor] input',
    ) as HTMLInputElement;
    await fillIn(again, 'discard me');
    await triggerKeyEvent(again, 'keydown', 'Escape');

    assert.strictEqual(state.cancels, 1, 'Escape cancelled');
    assert.deepEqual(
      state.commits,
      ['Half-year review'],
      'and committed nothing — the upstream had no Escape path at all',
    );
    assert.strictEqual(text('[data-test-shown]'), 'Half-year review');
  });

  test('focus moving INSIDE the editor does not commit', async function (assert) {
    let state = new EditState();
    await render(<template>
      <EditInPlace
        @label='Title'
        @value={{state.value}}
        @commitOn='action'
        @onCommit={{state.onCommit}}
      >
        <:display><span>{{state.value}}</span></:display>
      </EditInPlace>
    </template>);

    await click('[data-test-pretui-edit-in-place-trigger]');
    let input = need('[data-test-pretui-edit-in-place-editor] input');
    await focus(input);
    // Focus travels to the Save button, which lives inside the editor. The
    // upstream committed here, on a bare focusout.
    await focus(need('[data-test-pretui-edit-in-place-save]'));
    assert.deepEqual(state.commits, [], 'nothing committed');
    assert
      .dom('[data-test-pretui-edit-in-place-editor]')
      .exists('and the editor is still open');

    await click('[data-test-pretui-edit-in-place-save]');
    assert.strictEqual(state.commits.length, 1, 'the explicit Save did commit');
  });

  test('blur commits only when focus really left', async function (assert) {
    let state = new EditState();
    await render(<template>
      <EditInPlace
        @label='Title'
        @value={{state.value}}
        @onCommit={{state.onCommit}}
      >
        <:display><span>{{state.value}}</span></:display>
      </EditInPlace>
    </template>);

    await click('[data-test-pretui-edit-in-place-trigger]');
    let input = need(
      '[data-test-pretui-edit-in-place-editor] input',
    ) as HTMLInputElement;
    await fillIn(input, 'Committed by leaving');
    await blur(input);

    assert.deepEqual(state.commits, ['Committed by leaving']);
    assert.dom('[data-test-pretui-edit-in-place-editor]').doesNotExist();
  });

  test('a refused commit keeps the editor open', async function (assert) {
    let state = new EditState();
    state.refuse = true;
    await render(<template>
      <EditInPlace
        @label='Title'
        @value={{state.value}}
        @error={{state.error}}
        @commitOn='action'
        @onCommit={{state.onCommit}}
      >
        <:display><span>{{state.value}}</span></:display>
      </EditInPlace>
    </template>);

    await click('[data-test-pretui-edit-in-place-trigger]');
    await click('[data-test-pretui-edit-in-place-save]');
    assert
      .dom('[data-test-pretui-edit-in-place-editor]')
      .exists('returning false refuses the commit');
    assert.strictEqual(
      text('[data-test-pretui-edit-in-place-error]'),
      'Not allowed.',
    );
    let input = need('[data-test-pretui-edit-in-place-editor] input');
    assert.strictEqual(
      input.getAttribute('aria-describedby'),
      need('[data-test-pretui-edit-in-place-error]').id,
      'and the control points at the message',
    );
  });

  test('canEdit=false renders the content bare, with no dead affordance', async function (assert) {
    let state = new EditState();
    await render(<template>
      <EditInPlace @label='Title' @value={{state.value}} @canEdit={{false}}>
        <:display><span data-test-shown>{{state.value}}</span></:display>
      </EditInPlace>
    </template>);

    assert.dom('[data-test-shown]').exists('the content is there');
    assert
      .dom('[data-test-pretui-edit-in-place]')
      .doesNotExist('and there is no wrapper at all');
    assert.dom('[data-test-pretui-edit-in-place-trigger]').doesNotExist();
  });

  test('an empty value still has something to aim at', async function (assert) {
    let blank = '';
    await render(<template>
      <EditInPlace @label='Title' @value={{blank}} @placeholder='Add a title'>
        <:display><span data-test-shown>never seen</span></:display>
      </EditInPlace>
    </template>);
    assert.strictEqual(
      text('[data-test-pretui-edit-in-place-display]'),
      'Add a title',
    );
    assert.dom('[data-test-pretui-edit-in-place-trigger]').exists();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// The usage pages. `freestyle.gts` is imported by every demo page in the
// gallery, so a template defect in one page 500s all sixty on module load —
// and neither parse, lint nor indexing catches it. This is the standing
// proof that the three pages in DEMOS_STRUCTURE_FLOW actually mount.

/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS registries
   are Record<string, unknown> by contract; mounting one requires the cast. */
type AnyComponent = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

module('Pretui | structure-flow | usage pages', function (hooks) {
  setupCardTest(hooks);

  for (let name of DEMOS_STRUCTURE_FLOW_NAMES) {
    test(name + ' mounts', async function (assert) {
      let Demo = PAGES[name] as AnyComponent;
      assert.ok(Demo, name + ' is present in the registry');
      await render(<template><Demo /></template>);
      assert.ok(
        document.querySelector('.FreestyleUsage'),
        name + ' rendered a FreestyleUsage shell',
      );
    });
  }
});
