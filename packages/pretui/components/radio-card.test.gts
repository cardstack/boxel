// Pretui — RadioCard unit tests. The card is a <label> around a real radio,
// so what is asserted is the platform contract that makes it work: one
// radiogroup, one shared name, the checked input following the value, and
// the callbacks. No assertion touches a computed style: the component's own
// `<style scoped>` is inert in this harness.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { RadioCard } from './radio-card';
import type { ChoiceCardOption } from '../internal/choice-cards';

const PLANS: ChoiceCardOption[] = [
  { value: 'starter', title: 'Starter', description: 'One workspace', meta: '$0' },
  { value: 'team', title: 'Team', description: 'Shared workspaces', meta: '$24' },
  { value: 'legacy', title: 'Legacy', disabled: true },
];

class Sink {
  @tracked last: string | undefined;
  calls = 0;
  take = (value: string) => {
    this.last = value;
    this.calls++;
  };
}

class Holder {
  @tracked value = 'starter';
}

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}
function cards(): HTMLElement[] {
  return all('[data-test-pretui-radio-card] label.pretui-optioncard');
}
function radios(): HTMLInputElement[] {
  return all('[data-test-pretui-radio-card] input[type="radio"]') as HTMLInputElement[];
}

module('Pretui | components/radio-card', function (hooks) {
  setupCardTest(hooks);

  test('RadioCard is a radiogroup of labels, each wrapping one real radio with a shared name', async function (assert) {
    await render(<template>
      <RadioCard @label='Plan' @options={{PLANS}} @defaultValue='team' class='from-caller' />
    </template>);
    let root = q('[data-test-pretui-radio-card]');
    assert.strictEqual(root.getAttribute('role'), 'radiogroup', 'a real radiogroup');
    assert.strictEqual(root.getAttribute('aria-label'), 'Plan', '@label names the group');
    assert.true(root.classList.contains('from-caller'), '...attributes reach the root');
    assert.strictEqual(cards().length, 3, 'one card per option');
    cards().forEach((card) => {
      assert.strictEqual(card.tagName, 'LABEL', 'the card is the label');
      assert.strictEqual(card.querySelectorAll('input[type="radio"]').length, 1, 'one radio inside');
    });
    let names = new Set(radios().map((r) => r.name));
    assert.strictEqual(names.size, 1, 'the radios share one name, so arrow keys move between them');
    assert.ok([...names][0], 'the shared name is non-empty');
    assert.deepEqual(
      radios().map((r) => r.value),
      ['starter', 'team', 'legacy'],
      'each radio carries its option value',
    );
    assert.strictEqual(
      q('.pretui-optioncard-title').textContent?.trim(),
      'Starter',
      'the generated body shows the title',
    );
    assert.strictEqual(
      q('.pretui-optioncard-desc').textContent?.trim(),
      'One workspace',
      'and the description',
    );
    assert.strictEqual(q('.pretui-optioncard-meta').textContent?.trim(), '$0', 'and the meta figure');
  });

  test('RadioCard uncontrolled: clicking a card checks it, stamps data-selected and reports the value', async function (assert) {
    let sink = new Sink();
    let alias = new Sink();
    await render(<template>
      <RadioCard @options={{PLANS}} @defaultValue='starter' @onValueChange={{sink.take}} @onChange={{alias.take}} />
    </template>);
    assert.deepEqual(
      cards().map((c) => c.dataset['selected']),
      ['true', 'false', 'false'],
      'defaultValue selects the first card',
    );
    assert.true(radios()[0].checked, 'and checks its radio');
    await click(cards()[1]);
    assert.true(radios()[1].checked, 'the second radio is now checked');
    assert.false(radios()[0].checked, 'and the first is not');
    assert.deepEqual(
      cards().map((c) => c.dataset['selected']),
      ['false', 'true', 'false'],
      'data-selected followed the click',
    );
    assert.strictEqual(sink.last, 'team', 'onValueChange received the value');
    assert.strictEqual(alias.last, 'team', 'onChange alias received it too');
  });

  test('RadioCard controlled: the value does not move on its own, the parent moves it', async function (assert) {
    let holder = new Holder();
    let sink = new Sink();
    await render(<template>
      <RadioCard @options={{PLANS}} @value={{holder.value}} @onValueChange={{sink.take}} />
    </template>);
    await click(cards()[1]);
    assert.strictEqual(sink.last, 'team', 'the request is reported');
    assert.strictEqual(
      cards()[1].dataset['selected'],
      'false',
      'but the card does not select itself while @value is set',
    );
    assert.strictEqual(cards()[0].dataset['selected'], 'true', 'the controlled value still wins');
    assert.false(radios()[1].checked, 'the clicked radio is put back, so it matches its card');
    assert.true(radios()[0].checked, 'and the controlled one stays checked');
    await click(cards()[1]);
    assert.strictEqual(sink.calls, 2, 'the card can be requested again');
    holder.value = 'team';
    await render(<template>
      <RadioCard @options={{PLANS}} @value={{holder.value}} @onValueChange={{sink.take}} />
    </template>);
    assert.strictEqual(cards()[1].dataset['selected'], 'true', 'the parent moving @value selects the card');
    assert.true(radios()[1].checked, 'and checks its radio');
  });

  test('RadioCard @name is the form field every radio submits under', async function (assert) {
    await render(<template>
      <form data-test-form><RadioCard @name='plan' @options={{PLANS}} @defaultValue='team' /></form>
    </template>);
    assert.deepEqual(radios().map((r) => r.name), ['plan', 'plan', 'plan']);
    let data = new FormData(q('[data-test-form]') as HTMLFormElement);
    assert.strictEqual(data.get('plan'), 'team', 'a form submits the chosen value');
  });

  test('RadioCard disables a single option through option.disabled and the whole group through @disabled', async function (assert) {
    await render(<template><RadioCard @options={{PLANS}} /></template>);
    assert.true(radios()[2].disabled, 'the disabled option has a disabled radio');
    assert.strictEqual(cards()[2].dataset['disabled'], 'true', 'and the card is stamped');
    assert.false(radios()[0].disabled, 'the others are live');
    assert.strictEqual(cards()[0].dataset['disabled'], 'false');

    await render(<template><RadioCard @options={{PLANS}} @disabled={{true}} /></template>);
    assert.true(radios().every((r) => r.disabled), '@disabled disables every radio');
    assert.true(cards().every((c) => c.dataset['disabled'] === 'true'), 'and stamps every card');

    await render(<template><RadioCard @options={{PLANS}} @isDisabled={{true}} /></template>);
    assert.true(radios().every((r) => r.disabled), 'isDisabled is accepted as the alias');
  });

  test('RadioCard lands @orientation and @columns as data attributes and defaults to vertical', async function (assert) {
    await render(<template><RadioCard @options={{PLANS}} /></template>);
    assert.strictEqual(q('[data-test-pretui-radio-card]').dataset['orientation'], 'vertical');
    assert.notOk(q('[data-test-pretui-radio-card]').dataset['columns'], 'no columns unless asked');

    await render(<template>
      <RadioCard @options={{PLANS}} @orientation='horizontal' @columns={{3}} />
    </template>);
    let root = q('[data-test-pretui-radio-card]');
    assert.strictEqual(root.dataset['orientation'], 'horizontal');
    assert.strictEqual(root.dataset['columns'], '3');
  });

  test('RadioCard accepts @items as the alias of @options', async function (assert) {
    await render(<template><RadioCard @items={{PLANS}} /></template>);
    assert.strictEqual(cards().length, 3, '@items rendered the cards');
  });

  test('RadioCard yields the option and its selected state to a default block, and renders a media block', async function (assert) {
    await render(<template>
      <RadioCard @options={{PLANS}} @defaultValue='team'>
        <:media as |option|><span data-test-media>{{option.value}}</span></:media>
        <:default as |option selected|>
          <span data-test-custom data-on={{if selected 'yes' 'no'}}>{{option.title}}!</span>
        </:default>
      </RadioCard>
    </template>);
    assert.strictEqual(all('.pretui-optioncard-title').length, 0, 'the generated title is replaced');
    assert.deepEqual(
      all('[data-test-custom]').map((el) => el.textContent?.trim()),
      ['Starter!', 'Team!', 'Legacy!'],
      'the block receives each option',
    );
    assert.deepEqual(
      all('[data-test-custom]').map((el) => el.dataset['on']),
      ['no', 'yes', 'no'],
      'and whether it is selected',
    );
    assert.deepEqual(
      all('[data-test-media]').map((el) => el.textContent?.trim()),
      ['starter', 'team', 'legacy'],
      'the media block renders once per card with the option',
    );
    assert.strictEqual(all('.pretui-optioncard-media').length, 3, 'inside the media slot');
  });

  test('RadioCard without a media block renders no media slot', async function (assert) {
    await render(<template><RadioCard @options={{PLANS}} /></template>);
    assert.strictEqual(all('.pretui-optioncard-media').length, 0);
  });
});
