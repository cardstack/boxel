// Pretui — Editable proof. The component exists because the obvious
// click-to-edit (a div with a click handler) is inaccessible, so the
// evidence that matters is the trigger's role and name, the keyboard paths,
// where focus lands after each one, and which callbacks fire. Focus is real
// in this harness (headless Chromium), so `document.activeElement` is a
// legitimate assertion.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm. No assertion touches a computed style: the scoped
// stylesheet is inert here.
import { module, test } from 'qunit';
import { render, click, fillIn, blur, focus, triggerKeyEvent, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { Editable } from './editable';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
const ROOT = '[data-test-pretui-editable]';
const TRIGGER = '[data-test-pretui-editable-trigger]';
const FIELD = '[data-test-pretui-editable-field]';
const INPUT = `${ROOT} input`;

class Log {
  @tracked value = 'Ada';
  @tracked open = false;
  submitted: string[] = [];
  changed: string[] = [];
  valueChanged: string[] = [];
  cancels = 0;
  editing: boolean[] = [];
  setValue = (v: string) => (this.value = v);
  onSubmit = (v: string) => this.submitted.push(v);
  onChange = (v: string) => this.changed.push(v);
  onValueChange = (v: string) => this.valueChanged.push(v);
  onCancel = () => this.cancels++;
  onEditingChange = (e: boolean) => {
    this.editing.push(e);
    this.open = e;
  };
}

module('Pretui | components/editable', function (hooks) {
  setupCardTest(hooks);

  test('the preview is a real button whose name carries the label and the value', async function (assert) {
    await render(<template><Editable @label='Name' @value='Ada' /></template>);
    let trigger = q(TRIGGER);
    assert.strictEqual(trigger.tagName, 'BUTTON');
    assert.strictEqual(trigger.getAttribute('type'), 'button');
    assert.strictEqual(trigger.getAttribute('aria-label'), 'Edit Name, currently Ada');
    assert.strictEqual(trigger.textContent?.trim(), 'Ada');
    assert.strictEqual(q(ROOT).dataset['editing'], 'false');
    assert.strictEqual(q(ROOT).dataset['empty'], 'false');
    assert.notOk(q(FIELD), 'no field while previewing');
  });

  test('an empty value shows the placeholder and says so in the name', async function (assert) {
    await render(
      <template><Editable @label='Name' @value='' @placeholder='Add a name' /></template>,
    );
    assert.strictEqual(q(TRIGGER).getAttribute('aria-label'), 'Edit Name, empty');
    assert.strictEqual(q(TRIGGER).textContent?.trim(), 'Add a name');
    assert.strictEqual(q(ROOT).dataset['empty'], 'true');
  });

  test('without @label the name still says what the button does', async function (assert) {
    await render(<template><Editable @value='Ada' /></template>);
    assert.strictEqual(q(TRIGGER).getAttribute('aria-label'), 'Edit, currently Ada');
  });

  test('click opens the field in place and focuses the input', async function (assert) {
    await render(<template><Editable @label='Name' @defaultValue='Ada' /></template>);
    await click(TRIGGER);
    assert.notOk(q(TRIGGER), 'the trigger is gone while editing');
    assert.ok(q(FIELD), 'the field is present');
    assert.strictEqual(q(ROOT).dataset['editing'], 'true');
    let input = q(INPUT) as HTMLInputElement;
    assert.strictEqual(document.activeElement, input, 'the input took focus');
    assert.strictEqual(input.value, 'Ada', 'the draft starts as the value');
    assert.strictEqual(input.getAttribute('aria-label'), 'Name', 'the field is named too');
  });

  test('Enter commits: onSubmit and onChange fire, focus returns to the trigger', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable
          @label='Name'
          @defaultValue='Ada'
          @onSubmit={{sink.onSubmit}}
          @onChange={{sink.onChange}}
          @onValueChange={{sink.onValueChange}}
          @onEditingChange={{sink.onEditingChange}}
        />
      </template>,
    );
    await click(TRIGGER);
    await fillIn(INPUT, 'Grace');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.deepEqual(sink.submitted, ['Grace']);
    assert.deepEqual(sink.changed, ['Grace']);
    assert.deepEqual(sink.valueChanged, ['Grace'], 'the alias fires alongside');
    assert.deepEqual(sink.editing, [true, false]);
    assert.strictEqual(q(ROOT).dataset['editing'], 'false');
    assert.strictEqual(q(TRIGGER).textContent?.trim(), 'Grace', 'uncontrolled: the value moved');
    assert.strictEqual(q(TRIGGER).getAttribute('aria-label'), 'Edit Name, currently Grace');
    assert.strictEqual(document.activeElement, q(TRIGGER), 'focus came back to the trigger');
  });

  test('an unchanged commit fires onSubmit but not onChange', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable @label='Name' @defaultValue='Ada' @onSubmit={{sink.onSubmit}} @onChange={{sink.onChange}} />
      </template>,
    );
    await click(TRIGGER);
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.deepEqual(sink.submitted, ['Ada']);
    assert.deepEqual(sink.changed, [], 'nothing changed, so onChange stays quiet');
  });

  test('Escape restores the old value, fires onCancel only, and returns focus', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable
          @label='Name'
          @defaultValue='Ada'
          @onSubmit={{sink.onSubmit}}
          @onChange={{sink.onChange}}
          @onCancel={{sink.onCancel}}
        />
      </template>,
    );
    await click(TRIGGER);
    await fillIn(INPUT, 'Grace');
    await triggerKeyEvent(INPUT, 'keydown', 'Escape');
    assert.strictEqual(sink.cancels, 1);
    assert.deepEqual(sink.submitted, []);
    assert.deepEqual(sink.changed, []);
    assert.strictEqual(q(TRIGGER).textContent?.trim(), 'Ada', 'the draft was discarded');
    assert.strictEqual(document.activeElement, q(TRIGGER));
  });

  test('leaving the field commits by default', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable @label='Name' @defaultValue='Ada' @onSubmit={{sink.onSubmit}} @onChange={{sink.onChange}} />
      </template>,
    );
    await click(TRIGGER);
    await fillIn(INPUT, 'Grace');
    await blur(INPUT);
    assert.deepEqual(sink.submitted, ['Grace']);
    assert.deepEqual(sink.changed, ['Grace']);
    assert.strictEqual(q(TRIGGER).textContent?.trim(), 'Grace');
  });

  test('leaving the field for another control keeps focus where the reader sent it', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable @label='Name' @defaultValue='Ada' @onSubmit={{sink.onSubmit}} />
        <input aria-label='Other field' data-test-sibling />
      </template>,
    );
    await click(TRIGGER);
    await fillIn(INPUT, 'Grace');
    await focus('[data-test-sibling]');
    assert.deepEqual(sink.submitted, ['Grace'], 'the blur committed');
    assert.strictEqual(
      document.activeElement,
      q('[data-test-sibling]'),
      'focus stays on the control the reader moved to',
    );
  });

  test('an IME-composing Enter does not commit', async function (assert) {
    let sink = new Log();
    await render(<template><Editable @label='Name' @defaultValue='Ada' @onSubmit={{sink.onSubmit}} /></template>);
    await click(TRIGGER);
    await fillIn(INPUT, 'にほ');
    q(INPUT).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    await settled();
    assert.ok(q(FIELD), 'the field stays open while a candidate is confirmed');
    assert.deepEqual(sink.submitted, []);
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.deepEqual(sink.submitted, ['にほ'], 'the next Enter commits');
  });

  test('with @submitOnBlur off, leaving the field restores instead', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable
          @label='Name'
          @defaultValue='Ada'
          @submitOnBlur={{false}}
          @onSubmit={{sink.onSubmit}}
          @onChange={{sink.onChange}}
          @onCancel={{sink.onCancel}}
        />
      </template>,
    );
    await click(TRIGGER);
    await fillIn(INPUT, 'Grace');
    await blur(INPUT);
    assert.strictEqual(sink.cancels, 1);
    assert.deepEqual(sink.submitted, []);
    assert.strictEqual(q(TRIGGER).textContent?.trim(), 'Ada');
  });

  test('a controlled @value does not move on its own, but the callbacks still fire', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable @label='Name' @value='Ada' @onSubmit={{sink.onSubmit}} @onChange={{sink.onChange}} />
      </template>,
    );
    await click(TRIGGER);
    await fillIn(INPUT, 'Grace');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.deepEqual(sink.submitted, ['Grace']);
    assert.deepEqual(sink.changed, ['Grace']);
    assert.strictEqual(q(TRIGGER).textContent?.trim(), 'Ada', 'the parent did not update, so neither did the preview');
  });

  test('a controlled @value follows the parent when it does update', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable @label='Name' @value={{sink.value}} @onChange={{sink.setValue}} />
      </template>,
    );
    await click(TRIGGER);
    await fillIn(INPUT, 'Grace');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.strictEqual(sink.value, 'Grace');
    assert.strictEqual(q(TRIGGER).textContent?.trim(), 'Grace');
  });

  test('@disabled disables the trigger and click does not open', async function (assert) {
    await render(<template><Editable @label='Name' @value='Ada' @disabled={{true}} /></template>);
    let trigger = q(TRIGGER) as HTMLButtonElement;
    assert.true(trigger.disabled);
    // the test helper refuses a disabled target; the platform's own click is the real check
    trigger.click();
    await settled();
    assert.notOk(q(FIELD), 'still previewing');
    assert.strictEqual(q(ROOT).dataset['editing'], 'false');
  });

  test('@isDisabled is the alias', async function (assert) {
    await render(<template><Editable @value='Ada' @isDisabled={{true}} /></template>);
    assert.true((q(TRIGGER) as HTMLButtonElement).disabled);
  });

  // One render per test: tearing an open field down while a second render
  // focuses a new one blurs the first inside the render, which is not a
  // reader leaving the field.
  test('@defaultEditing starts open with the value as draft', async function (assert) {
    await render(<template><Editable @label='Name' @defaultValue='Ada' @defaultEditing={{true}} /></template>);
    assert.ok(q(FIELD));
    assert.strictEqual((q(INPUT) as HTMLInputElement).value, 'Ada');
  });

  test('@startWithEditView is the Chakra spelling of @defaultEditing', async function (assert) {
    await render(<template><Editable @label='Name' @value='Ada' @startWithEditView={{true}} /></template>);
    assert.ok(q(FIELD));
    assert.strictEqual((q(INPUT) as HTMLInputElement).value, 'Ada');
  });

  test('a controlled @editing pins the state; the request is reported', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable @label='Name' @value='Ada' @editing={{false}} @onEditingChange={{sink.onEditingChange}} />
      </template>,
    );
    await click(TRIGGER);
    assert.deepEqual(sink.editing, [true], 'open was requested');
    assert.notOk(q(FIELD), 'but the parent holds it closed');
  });

  test('a parent-driven @editing opens a fresh session every time', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable
          @label='Name'
          @value={{sink.value}}
          @editing={{sink.open}}
          @onEditingChange={{sink.onEditingChange}}
          @onChange={{sink.setValue}}
          @onSubmit={{sink.onSubmit}}
        />
      </template>,
    );
    sink.open = true;
    await settled();
    assert.strictEqual((q(INPUT) as HTMLInputElement).value, 'Ada', 'the first session starts from @value');
    await fillIn(INPUT, 'Grace');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.notOk(q(FIELD), 'Enter closes the first session');

    sink.open = true;
    await settled();
    assert.strictEqual((q(INPUT) as HTMLInputElement).value, 'Grace', 'the second session starts from the new @value');
    await fillIn(INPUT, 'Hopper');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.notOk(q(FIELD), 'and Enter closes it too');
    assert.deepEqual(sink.submitted, ['Grace', 'Hopper'], 'onSubmit fired once per session');
  });

  test('a field held open by @editing reports every Enter and Escape', async function (assert) {
    let sink = new Log();
    await render(
      <template>
        <Editable
          @label='Name'
          @defaultValue='Ada'
          @editing={{true}}
          @onEditingChange={{sink.onEditingChange}}
          @onSubmit={{sink.onSubmit}}
          @onCancel={{sink.onCancel}}
        />
      </template>,
    );
    await fillIn(INPUT, 'Grace');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    assert.ok(q(FIELD), 'the parent keeps the field open');
    await fillIn(INPUT, 'Hopper');
    await triggerKeyEvent(INPUT, 'keydown', 'Enter');
    await triggerKeyEvent(INPUT, 'keydown', 'Escape');
    assert.deepEqual(sink.submitted, ['Grace', 'Hopper'], 'the second Enter commits too');
    assert.strictEqual(sink.cancels, 1, 'and Escape is heard after them');
    assert.deepEqual(sink.editing, [false, false, false], 'each close was requested');
  });

  test('a preview block replaces the plain text and receives the value', async function (assert) {
    await render(
      <template>
        <Editable @label='Name' @value='Ada'>
          <:preview as |value|><strong data-test-custom>{{value}}!</strong></:preview>
        </Editable>
      </template>,
    );
    assert.strictEqual(q(`${TRIGGER} [data-test-custom]`).textContent, 'Ada!');
    assert.strictEqual(q(TRIGGER).getAttribute('aria-label'), 'Edit Name, currently Ada', 'the name is still the value');
  });

  test('...attributes land on the root', async function (assert) {
    await render(<template><Editable @value='Ada' class='mine' data-x='1' /></template>);
    assert.ok(q(ROOT).classList.contains('mine'));
    assert.strictEqual(q(ROOT).dataset['x'], '1');
  });
});
