// Pretui — Field unit tests.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Field } from './field';

const Mark: TemplateOnlyComponent<{ Element: SVGSVGElement }> = <template>
  <svg data-test-mark ...attributes></svg>
</template>;

module('Pretui | components/field', function (hooks) {
  setupCardTest(hooks);

  test('is vertical by default, its label pointing at the control by id', async function (assert) {
    await render(
      <template>
        <Field @label='Name' as |controlId|>
          <input id={{controlId}} data-test-control />
        </Field>
      </template>,
    );
    assert.dom('[data-test-pretui-field]').hasAttribute('data-orientation', 'vertical');
    let control = document.querySelector('[data-test-control]') as HTMLInputElement;
    assert.dom('label[data-test-pretui-field-label]').hasAttribute('for', control.id);
    assert.strictEqual(control.labels?.[0]?.textContent?.trim(), 'Name', 'the control is named by the label');
  });

  test('horizontal puts the label and its icon in a column of their own', async function (assert) {
    await render(
      <template>
        <Field @label='Name' @orientation='horizontal' @icon={{Mark}} as |controlId|>
          <input id={{controlId}} />
        </Field>
      </template>,
    );
    assert.dom('[data-test-pretui-field]').hasAttribute('data-orientation', 'horizontal');
    assert.dom('[data-test-pretui-field-head] [data-test-mark]').hasAttribute('aria-hidden', 'true', 'the icon is decorative');
    assert.dom('[data-test-pretui-field-body] input').exists('the control is in the column beside the label');
  });

  test('a group is named by the label, which then points at no control', async function (assert) {
    await render(
      <template>
        <Field @label='Kind' @labelTag='span' as |_controlId _messageId labelId|>
          <div role='radiogroup' aria-labelledby={{labelId}} data-test-group></div>
        </Field>
      </template>,
    );
    assert.dom('label').doesNotExist('no label element points at nothing');
    let labelId = document.querySelector('[data-test-group]')!.getAttribute('aria-labelledby')!;
    assert.dom(`#${labelId}`).hasText('Kind');
  });

  test('yields no label id without a label, so nothing points at a missing id', async function (assert) {
    await render(
      <template>
        <Field as |_controlId _messageId labelId|>
          <span aria-labelledby={{labelId}} data-test-control></span>
        </Field>
      </template>,
    );
    assert.dom('[data-test-control]').doesNotHaveAttribute('aria-labelledby');
  });

  test('@reserveMessage={{false}} keeps no message line until there is a message', async function (assert) {
    await render(
      <template>
        <Field @label='Name' @reserveMessage={{false}} as |controlId|>
          <input id={{controlId}} />
        </Field>
      </template>,
    );
    assert.dom('[data-test-pretui-field-message]').doesNotExist('no line kept with nothing to say');

    await render(
      <template>
        <Field @label='Name' @reserveMessage={{false}} @error='Required' as |controlId|>
          <input id={{controlId}} />
        </Field>
      </template>,
    );
    assert.dom('[data-test-pretui-field-message]').includesText('Required', 'an error still shows');
  });

  test('horizontal with no label gives the control the whole row', async function (assert) {
    await render(
      <template>
        <Field @orientation='horizontal' as |controlId|>
          <span id={{controlId}}></span>
        </Field>
      </template>,
    );
    assert.dom('[data-test-pretui-field-head]').doesNotExist();
    assert
      .dom('[data-test-pretui-field] > [data-test-pretui-field-body]:first-child')
      .exists('the body is the first column’s, which its rule spans across the row');
  });
});
