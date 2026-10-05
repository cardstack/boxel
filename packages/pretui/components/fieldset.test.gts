// Pretui — Fieldset unit tests. The component is a real <fieldset> with a
// real <legend>, so what it controls is that pairing, the native disabled
// inheritance, the description wiring and the orientation attribute.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Fieldset } from './fieldset';
import { Checkbox } from './checkbox';
import { Input } from './input';

function root(): HTMLFieldSetElement {
  return document.querySelector('[data-test-pretui-fieldset]') as HTMLFieldSetElement;
}
function legend(): HTMLLegendElement | null {
  return root().querySelector('legend');
}

module('Pretui | components/fieldset', function (hooks) {
  setupCardTest(hooks);

  test('Fieldset is a real <fieldset> whose <legend> is the accessible name, and ...attributes reach it', async function (assert) {
    await render(
      <template>
        <Fieldset @legend='Roast profile' data-section='roast'>
          <Checkbox @label='Include notes' />
        </Fieldset>
      </template>,
    );
    let el = root();
    assert.strictEqual(el.tagName, 'FIELDSET');
    assert.strictEqual(el.getAttribute('data-section'), 'roast', 'attributes land on the fieldset');
    assert.strictEqual(legend()?.textContent?.trim(), 'Roast profile');
    assert.strictEqual(el.firstElementChild, legend(), 'the legend is the first child, where the platform reads the group name from');
    assert.strictEqual(el.dataset['orientation'], 'vertical', 'the default orientation');
    assert.notOk(el.hasAttribute('aria-describedby'), 'no description, no dangling reference');
  });

  test('Fieldset @disabled disables every control inside through the platform', async function (assert) {
    await render(
      <template>
        <Fieldset @legend='Roast profile' @disabled={{true}}>
          <Checkbox @label='Include notes' />
          <Input @value='Lot 7' />
        </Fieldset>
      </template>,
    );
    assert.true(root().disabled, 'the fieldset itself carries disabled');
    let box = root().querySelector('input[type="checkbox"]') as HTMLInputElement;
    let text = root().querySelector('input[type="text"]') as HTMLInputElement;
    assert.false(box.disabled, 'the checkbox was not told individually');
    assert.true(box.matches(':disabled'), 'the checkbox is disabled by inheritance');
    assert.true(text.matches(':disabled'), 'so is the text input');
  });

  test('Fieldset accepts isDisabled as the React Aria spelling', async function (assert) {
    await render(
      <template>
        <Fieldset @legend='Roast profile' @isDisabled={{true}}>
          <Checkbox @label='Include notes' />
        </Fieldset>
      </template>,
    );
    assert.true(root().disabled, 'isDisabled → disabled');
  });

  test('Fieldset description is wired to the group with aria-describedby', async function (assert) {
    await render(
      <template>
        <Fieldset @legend='Roast profile' @description='Applied to every lot in this batch.'>
          <Checkbox @label='Include notes' />
        </Fieldset>
      </template>,
    );
    let id = root().getAttribute('aria-describedby');
    assert.ok(id, 'the fieldset points at its description');
    let desc = document.getElementById(id as string);
    assert.strictEqual(desc?.textContent?.trim(), 'Applied to every lot in this batch.');
    assert.strictEqual(desc?.tagName, 'P');
  });

  test('Fieldset @hideLegend keeps the legend in the DOM', async function (assert) {
    await render(
      <template>
        <Fieldset @legend='Roast profile' @hideLegend={{true}}>
          <Checkbox @label='Include notes' />
        </Fieldset>
      </template>,
    );
    assert.strictEqual(legend()?.textContent?.trim(), 'Roast profile', 'assistive tech still gets the name');
    assert.strictEqual(legend()?.dataset['hidden'], 'true', 'the stylesheet is told not to paint it');
  });

  test('Fieldset legend block wins over @legend, and there is no legend without either', async function (assert) {
    await render(
      <template>
        <Fieldset @legend='Ignored'>
          <:legend><em>Roast</em> profile</:legend>
          <:default><Checkbox @label='Include notes' /></:default>
        </Fieldset>
      </template>,
    );
    assert.strictEqual(legend()?.textContent?.replace(/\s+/g, ' ').trim(), 'Roast profile');
    assert.ok(legend()?.querySelector('em'), 'the block carries markup');

    await render(
      <template>
        <Fieldset>
          <Checkbox @label='Include notes' />
        </Fieldset>
      </template>,
    );
    assert.notOk(legend(), 'no legend is rendered when nothing names the group');
  });

  test('Fieldset orientation lands as a data attribute', async function (assert) {
    await render(
      <template>
        <Fieldset @legend='Roast profile' @orientation='horizontal'>
          <Checkbox @label='Light' />
          <Checkbox @label='Dark' />
        </Fieldset>
      </template>,
    );
    assert.strictEqual(root().dataset['orientation'], 'horizontal');
    assert.strictEqual(root().querySelectorAll('.pretui-fieldset-body > *').length, 2, 'the controls sit in the body');
  });
});
