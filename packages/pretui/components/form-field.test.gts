// Pretui — FormField unit tests, stand-alone (no Form).
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FormField } from './form-field';
import type { FormIssue } from '../internal/forms-core';

const ERR: FormIssue = { targetPath: 'Total', severity: 'error', message: 'Total exceeds the budget.' };
const WARN: FormIssue = { targetPath: 'Total', severity: 'warning', message: 'Unusually high.' };
const MIXED: FormIssue[] = [WARN, ERR];

function field(): HTMLElement {
  return document.querySelector('[data-test-pretui-form-field]') as HTMLElement;
}
function control(): HTMLInputElement {
  return document.querySelector('[data-test-control]') as HTMLInputElement;
}
function label(): HTMLLabelElement {
  return document.querySelector('[data-test-pretui-label]') as HTMLLabelElement;
}

module('Pretui | components/form-field', function (hooks) {
  setupCardTest(hooks);

  test('wires the label to the control through the yielded id', async function (assert) {
    await render(
      <template>
        <FormField @label='Total'>
          <:control as |c|><input id={{c.id}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.strictEqual(label().tagName, 'LABEL');
    assert.strictEqual(label().getAttribute('for'), control().id, 'the pairing actually resolves');
    assert.strictEqual(label().control, control());
    assert.strictEqual(field().dataset['layout'], 'stacked', 'labels above by default');
    assert.strictEqual(field().dataset['mode'], 'submit', 'submit mode when there is no form');
    assert.strictEqual(field().dataset['invalid'], undefined);
  });

  test('takes a caller control id and hands it to the label', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @controlId='total'>
          <:control as |c|><input id={{c.id}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.strictEqual(control().id, 'total');
    assert.strictEqual(label().getAttribute('for'), 'total');
  });

  test('marks a required field for the eye and for assistive tech separately', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @required={{true}}>
          <:control as |c|><input id={{c.id}} required={{c.required}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    let star = field().querySelector('.pretui-formfield-req');
    assert.strictEqual(star?.textContent, '*');
    assert.strictEqual(star?.getAttribute('aria-hidden'), 'true', 'an asterisk reads as nothing');
    assert.true(label().textContent?.includes('(required)'), 'so the word is there for the reader who cannot see it');
    assert.strictEqual(field().dataset['required'], 'true');
    assert.true(control().required, 'and the control context carries it');
  });

  test('can drop the asterisk while keeping the accessible marking', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @required={{true}} @hideRequiredIndicator={{true}}>
          <:control as |c|><input id={{c.id}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.notOk(field().querySelector('.pretui-formfield-req'));
    assert.true(label().textContent?.includes('(required)'));
  });

  test('joins the description into describedBy ahead of any error', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @description='Whole units.' @issues={{MIXED}}>
          <:control as |c|><input id={{c.id}} aria-describedby={{c.describedBy}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    let ids = (control().getAttribute('aria-describedby') ?? '').split(' ');
    assert.strictEqual(ids.length, 2, 'description, then messages');
    assert.strictEqual(document.getElementById(ids[0] as string)?.textContent?.trim(), 'Whole units.');
    assert.true(
      document.getElementById(ids[1] as string)?.textContent?.includes('Total exceeds the budget.'),
      'the message row is the second reference',
    );
  });

  test('renders stand-alone issues immediately, errors first, and dresses the field invalid', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @issues={{MIXED}}>
          <:control as |c|><input id={{c.id}} aria-invalid={{if c.invalid 'true'}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.deepEqual(
      Array.from(field().querySelectorAll('[data-test-pretui-field-error]')).map(
        (e) => (e as HTMLElement).dataset['severity'],
      ),
      ['error', 'warning'],
      'authored order was warning-then-error; display is by severity',
    );
    assert.strictEqual(field().dataset['invalid'], 'true');
    assert.strictEqual(field().dataset['severity'], 'error', 'the top severity is what the dress follows');
    assert.strictEqual(control().getAttribute('aria-invalid'), 'true', 'and the control context agrees');
  });

  test('an advisory alone does not make a field invalid', async function (assert) {
    const ADVICE: FormIssue[] = [WARN];
    await render(
      <template>
        <FormField @label='Total' @issues={{ADVICE}}>
          <:control as |c|><input id={{c.id}} aria-invalid={{if c.invalid 'true'}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.strictEqual(field().dataset['invalid'], undefined, 'a warning is advice, not a verdict');
    assert.strictEqual(field().dataset['severity'], 'warning', 'but it still tints');
    assert.strictEqual(control().getAttribute('aria-invalid'), null);
  });

  test('can hide advisories and keep only what blocks', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @issues={{MIXED}} @showAdvisory={{false}}>
          <:control as |c|><input id={{c.id}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.strictEqual(field().querySelectorAll('[data-test-pretui-field-error]').length, 1);
  });

  test('forces the invalid dress without an issue when the control failed on its own', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @invalid={{true}}>
          <:control as |c|><input id={{c.id}} aria-invalid={{if c.invalid 'true'}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.strictEqual(field().dataset['invalid'], 'true');
    assert.strictEqual(control().getAttribute('aria-invalid'), 'true');
    assert.strictEqual(field().querySelectorAll('[data-test-pretui-field-error]').length, 0, 'no message to show');
  });

  test('reserves the message row by default so side-by-side fields do not jump', async function (assert) {
    await render(<template><FormField @label='Total'><:control as |c|><input id={{c.id}} /></:control></FormField></template>);
    assert.strictEqual((field().querySelector('.pretui-formfield-msgs') as HTMLElement).dataset['reserve'], 'true');

    await render(<template><FormField @label='Total' @reserveMessageSpace={{false}}><:control as |c|><input id={{c.id}} /></:control></FormField></template>);
    assert.strictEqual((field().querySelector('.pretui-formfield-msgs') as HTMLElement).dataset['reserve'], undefined);
  });

  test('static display is a labelled group showing the value, with no control', async function (assert) {
    await render(<template><FormField @label='Owner' @value='Mei Ling' @static={{true}} /></template>);
    assert.strictEqual(field().getAttribute('role'), 'group', 'no control for a <label for> to point at');
    assert.strictEqual(
      document.getElementById(field().getAttribute('aria-labelledby') as string)?.textContent?.trim(),
      'Owner',
    );
    assert.strictEqual(label().tagName, 'SPAN', 'a faux label, not a dangling <label>');
    assert.strictEqual(field().querySelector('.pretui-formfield-static')?.textContent?.trim(), 'Mei Ling');
    assert.strictEqual(field().dataset['static'], 'true');
  });

  test('static display shows the placeholder for an empty value and prefers the static block', async function (assert) {
    await render(<template><FormField @label='Owner' @static={{true}} /></template>);
    assert.strictEqual(field().querySelector('.pretui-formfield-static')?.textContent?.trim(), '—');

    await render(<template><FormField @label='Owner' @value='' @static={{true}} @emptyText='none' /></template>);
    assert.strictEqual(field().querySelector('.pretui-formfield-static')?.textContent?.trim(), 'none');

    await render(
      <template>
        <FormField @label='Owner' @value='Mei Ling' @static={{true}}>
          <:static><b data-test-rich>Mei Ling</b></:static>
        </FormField>
      </template>,
    );
    assert.ok(field().querySelector('[data-test-rich]'), 'a link or an Avatar goes in the static block');
  });

  test('a field-level help button is named and describes itself with the help text', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @help='Includes tax.'>
          <:control as |c|><input id={{c.id}} /></:control>
        </FormField>
      </template>,
    );
    let btn = field().querySelector('.pretui-formfield-helpbtn') as HTMLButtonElement;
    assert.strictEqual(btn.getAttribute('aria-label'), 'Help: Total');
    // Tooltip appends its own bubble id to the trigger's describedby, so the
    // attribute carries two ids; the help text is one of them.
    let described = (btn.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent?.trim());
    assert.true(described.includes('Includes tax.'), 'the described text resolves through a real id');
  });

  test('reflects disabled, readonly, layout and span for the CSS and the control', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @disabled={{true}} @readonly={{true}} @layout='horizontal' @span={{2}}>
          <:control as |c|><input id={{c.id}} disabled={{c.disabled}} readonly={{c.readonly}} data-test-control /></:control>
        </FormField>
      </template>,
    );
    assert.strictEqual(field().dataset['disabled'], 'true');
    assert.strictEqual(field().dataset['readonly'], 'true');
    assert.strictEqual(field().dataset['layout'], 'horizontal');
    assert.strictEqual(field().dataset['span'], '2');
    assert.true(control().disabled);
    assert.true(control().readOnly);
  });

  test('renders the after block beside the control and a hidden label out of the picture', async function (assert) {
    await render(
      <template>
        <FormField @label='Total' @labelHidden={{true}}>
          <:control as |c|><input id={{c.id}} /></:control>
          <:after><span data-test-unit>kg</span></:after>
        </FormField>
      </template>,
    );
    assert.ok(field().querySelector('.pretui-formfield-after [data-test-unit]'));
    assert.strictEqual((field().querySelector('.pretui-formfield-labelbox') as HTMLElement).dataset['hidden'], 'true');
    assert.ok(label(), 'still in the accessible tree');
  });
});
