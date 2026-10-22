// Pretui — FormSection unit tests, stand-alone (no Form). The forced-open-
// after-refused-submit rule is asserted in form.test.gts, where there is a
// submit to refuse.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click, settled } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { FormSection } from './form-section';
import type { FormIssue } from '../internal/forms-core';

const NET_ERR: FormIssue = { targetPath: 'Net days', severity: 'error', message: 'Must be 30 or fewer.' };
const NET_WARN: FormIssue = { targetPath: 'Net days', severity: 'warning', message: 'Longer than usual.' };
const OTHER: FormIssue = { targetPath: 'Total', severity: 'error', message: 'Not this section.' };

function section(): HTMLFieldSetElement {
  return document.querySelector('[data-test-pretui-form-section]') as HTMLFieldSetElement;
}
function toggle(): HTMLButtonElement | null {
  return section().querySelector('.pretui-formsection-toggle') as HTMLButtonElement | null;
}
function body(): HTMLElement {
  return section().querySelector('.pretui-formsection-body') as HTMLElement;
}
function badge(): string | undefined {
  return section().querySelector('.pretui-formsection-badge')?.textContent?.trim();
}

module('Pretui | components/form-section', function (hooks) {
  setupCardTest(hooks);

  test('is a fieldset whose legend is the title, open and undisclosable by default', async function (assert) {
    await render(<template><FormSection @title='Terms'>body</FormSection></template>);
    assert.strictEqual(section().tagName, 'FIELDSET', 'the group semantics come from the platform');
    assert.strictEqual(section().querySelector('legend')?.textContent?.trim(), 'Terms');
    assert.strictEqual(toggle(), null, 'no disclosure unless asked');
    assert.strictEqual(section().dataset['open'], 'true');
    assert.false(body().hidden);
    assert.strictEqual(section().dataset['span'], 'all', 'a group spans the whole grid unless told otherwise');
  });

  test('wires its description to the fieldset', async function (assert) {
    await render(<template><FormSection @title='Terms' @description='When we get paid.'>body</FormSection></template>);
    let id = section().getAttribute('aria-describedby') as string;
    assert.strictEqual(document.getElementById(id)?.textContent?.trim(), 'When we get paid.');
  });

  test('a collapsible section owns a toggle with aria-expanded and aria-controls', async function (assert) {
    await render(<template><FormSection @title='Terms' @collapsible={{true}}>body</FormSection></template>);
    let t = toggle() as HTMLButtonElement;
    assert.ok(t);
    assert.strictEqual(t.getAttribute('aria-expanded'), 'true', 'open by default');
    assert.strictEqual(document.getElementById(t.getAttribute('aria-controls') as string), body());
    assert.true(t.textContent?.includes('Terms'), 'the title is the button, so the legend stays the accessible name');
  });

  test('toggles closed and open, hiding the body rather than dropping it', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(
      <template><FormSection @title='Terms' @collapsible={{true}} @onOpenChange={{record}}><span data-test-inner>body</span></FormSection></template>,
    );
    await click(toggle() as HTMLElement);
    assert.strictEqual(section().dataset['open'], 'false');
    assert.true(body().hidden, 'hidden, not removed — so fields inside stay registered and their issues still route');
    assert.ok(document.querySelector('[data-test-inner]'), 'the content is still in the DOM');
    assert.deepEqual(seen, [false]);

    await click(toggle() as HTMLElement);
    assert.strictEqual(section().dataset['open'], 'true');
    assert.deepEqual(seen, [false, true]);
  });

  test('starts closed from @defaultOpen=false', async function (assert) {
    await render(<template><FormSection @title='Terms' @collapsible={{true}} @defaultOpen={{false}}>body</FormSection></template>);
    assert.strictEqual(toggle()?.getAttribute('aria-expanded'), 'false');
    assert.true(body().hidden);
  });

  test('a controlled @open holds its state and reports the request', async function (assert) {
    let seen: boolean[] = [];
    const record = (open: boolean) => seen.push(open);
    await render(
      <template><FormSection @title='Terms' @collapsible={{true}} @open={{true}} @onOpenChange={{record}}>body</FormSection></template>,
    );
    await click(toggle() as HTMLElement);
    assert.strictEqual(section().dataset['open'], 'true', 'the owner decides');
    assert.deepEqual(seen, [false]);
  });

  test('disabling the fieldset deadens every control inside but not the disclosure', async function (assert) {
    await render(
      <template>
        <FormSection @title='Terms' @collapsible={{true}} @disabled={{true}} as |S|>
          <S.Field @label='Net days'><:control as |c|><input id={{c.id}} data-test-control /></:control></S.Field>
        </FormSection>
      </template>,
    );
    assert.true(section().disabled);
    let control = document.querySelector('[data-test-control]') as HTMLInputElement;
    assert.true(control.matches(':disabled'), 'native fieldset disabling reaches the control');
    let t = toggle() as HTMLButtonElement;
    assert.ok(t.closest('legend'), 'the toggle lives in the legend');
    assert.false(t.matches(':disabled'), 'which a disabled fieldset leaves alive, so a disabled section can still be collapsed');
  });

  test('counts the issues of the fields it holds in its legend, and only those', async function (assert) {
    const ISSUES: FormIssue[] = [NET_ERR, OTHER];
    await render(
      <template>
        <FormSection @title='Terms' @issues={{ISSUES}} as |S|>
          <S.Field @label='Net days' @path='Net days'><:control as |c|><input id={{c.id}} /></:control></S.Field>
        </FormSection>
      </template>,
    );
    await settled();
    assert.strictEqual(badge(), '1 error', 'the Total issue belongs to some other section');
    assert.strictEqual(
      section().querySelector('.pretui-formsection-badge')?.closest('legend'),
      section().querySelector('legend'),
      'in the legend on purpose: a collapsed section announces "Terms, 1 error" the moment AT reaches it',
    );
  });

  test('says "notices" for advisories, pluralises, and can be silenced', async function (assert) {
    const TWO_WARN: FormIssue[] = [NET_WARN, { ...NET_WARN, message: 'Second notice.' }];
    await render(
      <template>
        <FormSection @title='Terms' @issues={{TWO_WARN}} as |S|>
          <S.Field @label='Net days' @path='Net days'><:control as |c|><input id={{c.id}} /></:control></S.Field>
        </FormSection>
      </template>,
    );
    await settled();
    assert.strictEqual(badge(), '2 notices');
    assert.strictEqual((section().querySelector('.pretui-formsection-badge') as HTMLElement).dataset['severity'], 'warning');

    await render(
      <template>
        <FormSection @title='Terms' @issues={{TWO_WARN}} @hideIssueCount={{true}} as |S|>
          <S.Field @label='Net days' @path='Net days'><:control as |c|><input id={{c.id}} /></:control></S.Field>
        </FormSection>
      </template>,
    );
    await settled();
    assert.strictEqual(badge(), undefined);
  });

  test('counts declared @paths for fields it cannot see', async function (assert) {
    const ISSUES: FormIssue[] = [NET_ERR];
    const PATHS = ['Net days'];
    await render(<template><FormSection @title='Terms' @issues={{ISSUES}} @paths={{PATHS}}>lazy body</FormSection></template>);
    assert.strictEqual(badge(), '1 error', 'a lazily rendered section can still badge honestly');
  });

  test('renders the actions block at the right of the legend and honours @span', async function (assert) {
    await render(
      <template>
        <FormSection @title='Rows' @span={{1}}>
          <:default>body</:default>
          <:actions><button type='button' data-test-add>Add</button></:actions>
        </FormSection>
      </template>,
    );
    assert.ok(section().querySelector('legend [data-test-add]'));
    assert.strictEqual(section().dataset['span'], '1');
  });
});
