// Pretui — FormLayout unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FormLayout } from './form-layout';

function layout(): HTMLElement {
  return document.querySelector('[data-test-pretui-form-layout]') as HTMLElement;
}
function fields(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-test-pretui-form-field]')) as HTMLElement[];
}

module('Pretui | components/form-layout', function (hooks) {
  setupCardTest(hooks);

  test('defaults to one stacked column and says so in both channels', async function (assert) {
    await render(<template><FormLayout as |L|><span data-test-dir>{{L.direction}}/{{L.columns}}</span></FormLayout></template>);
    assert.strictEqual(layout().dataset['direction'], 'stacked');
    assert.strictEqual(layout().dataset['columns'], '1');
    assert.strictEqual(
      (layout().querySelector('.pretui-formlayout-grid') as HTMLElement).dataset['columns'],
      '1',
      'the grid repeats the count so the fold rules can target it',
    );
    assert.strictEqual(document.querySelector('[data-test-dir]')?.textContent, 'stacked/1', 'the block sees the same values');
  });

  test('curries its direction into every yielded Field', async function (assert) {
    await render(
      <template>
        <FormLayout @direction='horizontal' @columns={{2}} as |L|>
          <L.Field @label='A'><:control as |c|><input id={{c.id}} /></:control></L.Field>
          <L.Field @label='B'><:control as |c|><input id={{c.id}} /></:control></L.Field>
        </FormLayout>
      </template>,
    );
    assert.strictEqual(layout().dataset['direction'], 'horizontal');
    assert.strictEqual(layout().dataset['columns'], '2');
    assert.deepEqual(
      fields().map((f) => f.dataset['layout']),
      ['horizontal', 'horizontal'],
      'a field inside a horizontal layout puts its label beside without being told',
    );
  });

  test('a yielded Field can still span columns', async function (assert) {
    await render(
      <template>
        <FormLayout @columns={{2}} as |L|>
          <L.Field @label='Notes' @span={{2}}><:control as |c|><textarea id={{c.id}}></textarea></:control></L.Field>
        </FormLayout>
      </template>,
    );
    assert.strictEqual(fields()[0]?.dataset['span'], '2');
  });

  test('yields a Section that renders as a fieldset inside the grid', async function (assert) {
    await render(
      <template>
        <FormLayout as |L|>
          <L.Section @title='Terms' as |S|>
            <S.Field @label='Net days'><:control as |c|><input id={{c.id}} /></:control></S.Field>
          </L.Section>
        </FormLayout>
      </template>,
    );
    let section = layout().querySelector('[data-test-pretui-form-section]') as HTMLElement;
    assert.strictEqual(section.tagName, 'FIELDSET');
    assert.strictEqual(section.querySelector('legend')?.textContent?.trim(), 'Terms');
    assert.strictEqual(section.querySelectorAll('[data-test-pretui-form-field]').length, 1);
  });
});
