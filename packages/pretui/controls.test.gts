// Pretui — proof of the React-dialect alias layer on the controls
// territory (react-ecosystem-gap.md, enhancement pass step 1). Every
// assertion here is written in the vocabulary an agent trained on shadcn /
// Radix / Mantine / MUI / React Aria would emit, NOT in the house names:
// the point of the layer is that markup written from React muscle memory
// works, so the test has to be written that way too. The canonical names
// are covered by the existing demo pages and forms-render.
//
// No assertion touches a computed style: `boxel test` stamps the scoped-css
// attribute and delivers no stylesheet.
import { module, test } from 'qunit';
import { render, click, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';
import { Checkbox } from './components/checkbox';
import { Field } from './components/field';
import { Input } from './components/input';
import { Rating } from './components/rating';
import { Select } from './components/select';
import { Switch } from './components/switch';
import { Tabs } from './components/tabs';
import { Textarea } from './components/textarea';
import { firstDefined, resolveSize, resolveTone, PRETUI_TONES } from './pretui-primitives';
import { SearchInput } from './components/search-input';
import { Stepper } from './components/stepper';
import { Alert } from './components/alert';

class Sink {
  @tracked last: unknown = undefined;
  take = (v: unknown) => (this.last = v);
}

const OPTS = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
];

function q(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

module('Pretui | React-dialect aliases — controls', function (hooks) {
  setupCardTest(hooks);

  // ── the resolvers, as pure functions ───────────────────────────────────
  test('resolveSize narrows every spelling onto the house scale', function (assert) {
    assert.strictEqual(resolveSize('sm'), 's', 'sm → s');
    assert.strictEqual(resolveSize('md'), 'm', 'md → m');
    assert.strictEqual(resolveSize('lg'), 'l', 'lg → l');
    assert.strictEqual(resolveSize('default'), 'm', 'default → m');
    assert.strictEqual(resolveSize('large'), 'l', 'MUI large → l');
    assert.strictEqual(resolveSize('xl'), 'xl', 'house names pass through');
    assert.strictEqual(resolveSize(undefined), 'm', 'default is m');
    assert.strictEqual(
      resolveSize('enormous'),
      'm',
      'an unknown size falls back rather than emitting a dead data-size',
    );
  });

  test('resolveTone maps the React tone spellings and narrows to the subset', function (assert) {
    assert.strictEqual(
      resolveTone('destructive', PRETUI_TONES, 'neutral'),
      'danger',
      'destructive → danger',
    );
    assert.strictEqual(
      resolveTone('brand', PRETUI_TONES, 'neutral'),
      'primary',
      'brand → primary',
    );
    assert.strictEqual(
      resolveTone('positive', PRETUI_TONES, 'neutral'),
      'success',
      'positive → success',
    );
    assert.strictEqual(
      resolveTone('notice', PRETUI_TONES, 'neutral'),
      'warning',
      'notice → warning',
    );
    assert.strictEqual(
      resolveTone('error', PRETUI_TONES, 'neutral'),
      'danger',
      'error → danger',
    );
    assert.strictEqual(
      resolveTone('primary', ['info', 'danger'], 'info'),
      'info',
      'a tone outside a component subset falls back',
    );
  });

  test('firstDefined prefers the canonical name and keeps false', function (assert) {
    assert.strictEqual(firstDefined(undefined, 'alias'), 'alias');
    assert.strictEqual(firstDefined('canon', 'alias'), 'canon');
    assert.strictEqual(
      firstDefined(false, true),
      false,
      'false is a value, not an absence — the `??` trap this exists to avoid',
    );
  });

  test('Input accepts isInvalid / isRequired / readOnly and notifies through onChange', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Input
        @isInvalid={{true}}
        @isRequired={{true}}
        @readOnly={{false}}
        @onChange={{sink.take}}
        data-test-alias-input
      />
    </template>);
    let wrap = q('[data-test-pretui-input]') as HTMLElement;
    assert.strictEqual(
      wrap.dataset['invalid'],
      'true',
      'isInvalid dresses the field',
    );
    let input = q('[data-test-alias-input]') as HTMLInputElement;
    assert.true(input.required, 'isRequired reaches the native attribute');
    await fillIn(input, 'hello');
    assert.strictEqual(
      sink.last,
      'hello',
      '@onChange fires per keystroke, which is what React onChange means',
    );
  });

  test('Textarea accepts onValueChange', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Textarea @onValueChange={{sink.take}} data-test-alias-textarea />
    </template>);
    await fillIn(
      q('[data-test-alias-textarea]') as HTMLTextAreaElement,
      'note',
    );
    assert.strictEqual(sink.last, 'note', '@onValueChange fires');
  });

  // ── Select ─────────────────────────────────────────────────────────────
  test('Select accepts @items and notifies through @onChange', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Select @items={{OPTS}} @onChange={{sink.take}} />
    </template>);
    await click('[data-test-pretui-select] .pretui-selecttrigger');
    let opts = document.querySelectorAll(
      '[data-test-pretui-select] .ember-power-select-option',
    );
    assert.strictEqual(opts.length, 2, '@items populated the listbox');
    await click(opts[1] as HTMLElement);
    assert.strictEqual(sink.last, 'b', '@onChange received the value');
  });

  // ── Switch / Checkbox — @checked, never a shared isSelected ────────────
  test('Switch accepts isSelected and notifies through onChange', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Switch @isSelected={{false}} @onChange={{sink.take}} />
    </template>);
    let sw = q('[data-test-pretui-switch]') as HTMLButtonElement;
    assert.strictEqual(sw.getAttribute('aria-checked'), 'false');
    await click(sw);
    assert.strictEqual(sink.last, true, '@onChange fired with the next state');
    assert.strictEqual(
      sw.getAttribute('aria-checked'),
      'false',
      'controlled by isSelected: the DOM does not move on its own',
    );
  });

  test('Checkbox accepts isSelected / isDisabled', async function (assert) {
    await render(<template>
      <Checkbox @label='Ship it' @isSelected={{true}} @isDisabled={{true}} />
    </template>);
    let box = q(
      '[data-test-pretui-checkbox] input.pretui-checkbox',
    ) as HTMLInputElement;
    assert.true(box.checked, 'isSelected → checked');
    assert.true(box.disabled, 'isDisabled → disabled');
  });

  // ── Tabs ───────────────────────────────────────────────────────────────
  test('Tabs accepts @items and @onChange', async function (assert) {
    let sink = new Sink();
    await render(<template>
      <Tabs @items={{OPTS}} @onChange={{sink.take}} />
    </template>);
    let tabs = document.querySelectorAll('[data-test-pretui-tabs] [role="tab"]');
    assert.strictEqual(tabs.length, 2, '@items rendered the tablist');
    await click(tabs[1] as HTMLElement);
    assert.strictEqual(sink.last, 'b', '@onChange received the value');
  });

  // ── Rating ─────────────────────────────────────────────────────────────
  test('Rating accepts isReadOnly', async function (assert) {
    await render(<template>
      <Rating @value={{3}} @isReadOnly={{true}} />
    </template>);
    let rating = q('[data-test-pretui-rating]') as HTMLElement;
    assert.strictEqual(rating.dataset['readonly'], 'true');
    assert.strictEqual(rating.getAttribute('aria-readonly'), 'true');
  });

  // ── Field string sugar ─────────────────────────────────────────────────
  test('Field accepts description and errorMessage', async function (assert) {
    await render(<template>
      <Field @label='Email' @description='We never share it.' />
      <Field @label='Age' @errorMessage='Must be a number.' />
    </template>);
    let fields = document.querySelectorAll('[data-test-pretui-field]');
    assert.strictEqual(
      (fields[0] as HTMLElement).textContent?.includes('We never share it.'),
      true,
      '@description renders on the message line',
    );
    assert.strictEqual(
      (fields[1] as HTMLElement).dataset['invalid'],
      'true',
      '@errorMessage puts the field in the invalid dress',
    );
  });

  // ── controls-extras ────────────────────────────────────────────────────
  test('Stepper and SearchInput accept the alias notify and isDisabled', async function (assert) {
    let stepped = new Sink();
    let searched = new Sink();
    await render(<template>
      <Stepper @defaultValue={{2}} @onChange={{stepped.take}} />
      <SearchInput @onChange={{searched.take}} data-test-alias-search />
    </template>);
    await click(
      '[data-test-pretui-stepper] button[aria-label="Increment"]',
    );
    assert.strictEqual(stepped.last, 3, 'Stepper @onChange fired');

    await fillIn(
      q('[data-test-pretui-search-input] input') as HTMLInputElement,
      'boxel',
    );
    assert.strictEqual(searched.last, 'boxel', 'SearchInput @onChange fired');
  });

  // ── feedback ───────────────────────────────────────────────────────────
  test('Alert accepts the shadcn variant enum and the destructive tone', async function (assert) {
    await render(<template>
      <Alert @variant='destructive' @title='Gone' />
      <Alert @tone='positive' @title='Saved' />
    </template>);
    let alerts = document.querySelectorAll('[data-test-pretui-alert]');
    assert.strictEqual(
      (alerts[0] as HTMLElement).getAttribute('role'),
      'alert',
      'variant=destructive reaches the danger tone, so the role escalates',
    );
    assert.strictEqual(
      (alerts[1] as HTMLElement).getAttribute('role'),
      'status',
      'positive → success stays a polite status',
    );
  });
});
