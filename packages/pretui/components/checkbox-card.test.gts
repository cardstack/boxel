// Pretui — CheckboxCard unit tests. The card is a <label> around a real
// checkbox, so what is asserted is the platform contract underneath: a
// group, one checkbox per card, the checked inputs following the array
// value, and the callbacks carrying the toggled array. No assertion touches
// a computed style: the component's own `<style scoped>` is inert here.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { CheckboxCard } from './checkbox-card';
import type { ChoiceCardOption } from '../internal/choice-cards';

const ADDONS: ChoiceCardOption[] = [
  { value: 'backups', title: 'Backups', description: 'Nightly', meta: '+$4' },
  { value: 'sso', title: 'SSO', description: 'SAML and OIDC', meta: '+$8' },
  { value: 'legacy', title: 'Legacy API', disabled: true },
];

class Sink {
  @tracked last: string[] | undefined;
  calls = 0;
  take = (values: string[]) => {
    this.last = values;
    this.calls++;
  };
}

const DEFAULT_ADDONS = [ADDONS[0]!.value, ADDONS[1]!.value];

class Holder {
  @tracked value: string[] = ['backups'];
}

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function cards(): HTMLElement[] {
  return all('[data-test-pretui-checkbox-card] label.pretui-optioncard');
}
function boxes(): HTMLInputElement[] {
  return all('[data-test-pretui-checkbox-card] input[type="checkbox"]') as HTMLInputElement[];
}

module('Pretui | components/checkbox-card', function (hooks) {
  setupCardTest(hooks);

  test('CheckboxCard is a group of labels, each wrapping one real checkbox', async function (assert) {
    await render(<template>
      <CheckboxCard @label='Add-ons' @options={{ADDONS}} class='from-caller' />
    </template>);
    let root = q('[data-test-pretui-checkbox-card]');
    assert.strictEqual(root.getAttribute('role'), 'group', 'a group, not a radiogroup');
    assert.strictEqual(root.getAttribute('aria-label'), 'Add-ons', '@label names the group');
    assert.true(root.classList.contains('from-caller'), '...attributes reach the root');
    assert.strictEqual(cards().length, 3, 'one card per option');
    cards().forEach((card) => {
      assert.strictEqual(card.tagName, 'LABEL', 'the card is the label');
      assert.strictEqual(card.querySelectorAll('input[type="checkbox"]').length, 1, 'one checkbox inside');
    });
    assert.true(boxes().every((b) => !b.name), 'checkboxes carry no shared name — they are independent');
    assert.deepEqual(
      boxes().map((b) => b.value),
      ['backups', 'sso', 'legacy'],
      'each checkbox carries its option value',
    );
    assert.strictEqual(q('.pretui-optioncard-title').textContent?.trim(), 'Backups');
    assert.strictEqual(q('.pretui-optioncard-desc').textContent?.trim(), 'Nightly');
    assert.strictEqual(q('.pretui-optioncard-meta').textContent?.trim(), '+$4');
  });

  test('CheckboxCard uncontrolled: clicking toggles the card and reports the whole array', async function (assert) {
    let sink = new Sink();
    let alias = new Sink();
    await render(<template>
      <CheckboxCard @options={{ADDONS}} @onValueChange={{sink.take}} @onChange={{alias.take}} />
    </template>);
    assert.deepEqual(
      cards().map((c) => c.dataset['selected']),
      ['false', 'false', 'false'],
      'nothing chosen by default',
    );
    await click(cards()[0]);
    assert.true(boxes()[0].checked, 'the first checkbox is checked');
    assert.deepEqual(sink.last, ['backups'], 'onValueChange received the array');
    assert.deepEqual(alias.last, ['backups'], 'onChange alias received it too');
    await click(cards()[1]);
    assert.deepEqual(sink.last, ['backups', 'sso'], 'a second click appends');
    assert.deepEqual(
      cards().map((c) => c.dataset['selected']),
      ['true', 'true', 'false'],
      'data-selected follows both',
    );
    await click(cards()[0]);
    assert.deepEqual(sink.last, ['sso'], 'clicking a chosen card removes it');
    assert.false(boxes()[0].checked, 'and unchecks its checkbox');
    assert.strictEqual(sink.calls, 3);
  });

  test('CheckboxCard @defaultValue seeds the uncontrolled group', async function (assert) {
    let seed = ['sso'];
    await render(<template>
      <CheckboxCard @options={{ADDONS}} @defaultValue={{seed}} />
    </template>);
    assert.deepEqual(
      cards().map((c) => c.dataset['selected']),
      ['false', 'true', 'false'],
    );
    assert.true(boxes()[1].checked);
  });

  test('CheckboxCard controlled: the array does not move on its own, the parent moves it', async function (assert) {
    let holder = new Holder();
    let sink = new Sink();
    await render(<template>
      <CheckboxCard @options={{ADDONS}} @value={{holder.value}} @onValueChange={{sink.take}} />
    </template>);
    await click(cards()[1]);
    assert.deepEqual(sink.last, ['backups', 'sso'], 'the toggled array is reported');
    assert.strictEqual(
      cards()[1].dataset['selected'],
      'false',
      'but the card does not select itself while @value is set',
    );
    assert.false(boxes()[1].checked, 'the clicked checkbox is put back, so it matches its card');
    holder.value = ['backups', 'sso'];
    await render(<template>
      <CheckboxCard @options={{ADDONS}} @value={{holder.value}} @onValueChange={{sink.take}} />
    </template>);
    assert.deepEqual(
      cards().map((c) => c.dataset['selected']),
      ['true', 'true', 'false'],
      'the parent moving @value selects the cards',
    );
    assert.true(boxes()[1].checked, 'and checks the checkbox');
  });

  test('CheckboxCard @name is the form field every checkbox submits under', async function (assert) {
    await render(<template>
      <form data-test-form><CheckboxCard @name='addons' @options={{ADDONS}} @defaultValue={{DEFAULT_ADDONS}} /></form>
    </template>);
    assert.true(boxes().every((b) => b.name === 'addons'));
    let data = new FormData(q('[data-test-form]') as HTMLFormElement);
    assert.deepEqual(data.getAll('addons'), DEFAULT_ADDONS, 'a form submits every chosen value under the name');
  });

  test('CheckboxCard disables a single option through option.disabled and the whole group through @disabled', async function (assert) {
    await render(<template><CheckboxCard @options={{ADDONS}} /></template>);
    assert.true(boxes()[2].disabled, 'the disabled option has a disabled checkbox');
    assert.strictEqual(cards()[2].dataset['disabled'], 'true', 'and the card is stamped');
    assert.false(boxes()[0].disabled);
    assert.strictEqual(cards()[0].dataset['disabled'], 'false');

    await render(<template><CheckboxCard @options={{ADDONS}} @disabled={{true}} /></template>);
    assert.true(boxes().every((b) => b.disabled), '@disabled disables every checkbox');
    assert.true(cards().every((c) => c.dataset['disabled'] === 'true'), 'and stamps every card');

    await render(<template><CheckboxCard @options={{ADDONS}} @isDisabled={{true}} /></template>);
    assert.true(boxes().every((b) => b.disabled), 'isDisabled is accepted as the alias');
  });

  test('CheckboxCard lands @orientation and @columns as data attributes and defaults to vertical', async function (assert) {
    await render(<template><CheckboxCard @options={{ADDONS}} /></template>);
    assert.strictEqual(q('[data-test-pretui-checkbox-card]').dataset['orientation'], 'vertical');
    assert.notOk(q('[data-test-pretui-checkbox-card]').dataset['columns']);

    await render(<template>
      <CheckboxCard @options={{ADDONS}} @orientation='horizontal' @columns={{2}} />
    </template>);
    let root = q('[data-test-pretui-checkbox-card]');
    assert.strictEqual(root.dataset['orientation'], 'horizontal');
    assert.strictEqual(root.dataset['columns'], '2');
  });

  test('CheckboxCard accepts @items as the alias of @options', async function (assert) {
    await render(<template><CheckboxCard @items={{ADDONS}} /></template>);
    assert.strictEqual(cards().length, 3);
  });

  test('CheckboxCard yields the option and its selected state to a default block, and renders a media block', async function (assert) {
    let seed = ['sso'];
    await render(<template>
      <CheckboxCard @options={{ADDONS}} @defaultValue={{seed}}>
        <:media as |option|><span data-test-media>{{option.value}}</span></:media>
        <:default as |option selected|>
          <span data-test-custom data-on={{if selected 'yes' 'no'}}>{{option.title}}!</span>
        </:default>
      </CheckboxCard>
    </template>);
    assert.strictEqual(all('.pretui-optioncard-title').length, 0, 'the generated title is replaced');
    assert.deepEqual(
      all('[data-test-custom]').map((el) => el.textContent?.trim()),
      ['Backups!', 'SSO!', 'Legacy API!'],
    );
    assert.deepEqual(
      all('[data-test-custom]').map((el) => el.dataset['on']),
      ['no', 'yes', 'no'],
      'the block sees which cards are selected',
    );
    assert.deepEqual(
      all('[data-test-media]').map((el) => el.textContent?.trim()),
      ['backups', 'sso', 'legacy'],
    );
    assert.strictEqual(all('.pretui-optioncard-media').length, 3);
  });

  test('CheckboxCard without a media block renders no media slot', async function (assert) {
    await render(<template><CheckboxCard @options={{ADDONS}} /></template>);
    assert.strictEqual(all('.pretui-optioncard-media').length, 0);
  });
});
