// Button unit tests. No assertion touches a computed style: the host test
// harness stamps the scoped-css attribute and delivers no stylesheet.
import { module, test } from 'qunit';
import { click, focus, render, settled } from '@ember/test-helpers';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Button } from './button';

function btn(sel = '[data-test-pretui-button]'): HTMLButtonElement {
  return document.querySelector(sel) as HTMLButtonElement;
}

module('Pretui | components/button', function (hooks) {
  setupCardTest(hooks);

  test('defaults to primary × accent at size m, as a native button', async function (assert) {
    await render(
      <template>
        <Button>Keep selling</Button>
      </template>,
    );
    let el = btn();
    assert.strictEqual(el.tagName, 'BUTTON', 'a native button, not a div');
    assert.strictEqual(el.type, 'button', 'never submits by accident');
    assert.strictEqual(el.dataset['tone'], 'primary');
    assert.strictEqual(el.dataset['appearance'], 'accent');
    assert.strictEqual(el.dataset['size'], 'm');
    assert.false(el.disabled);
    assert.strictEqual(el.dataset['state'], undefined, 'no busy state at rest');
    assert.strictEqual(
      el.dataset['shape'],
      'rounded',
      'theme radius by default',
    );
  });

  test('@shape picks the corner treatment and falls back to rounded', async function (assert) {
    await render(
      <template>
        <Button @shape='pill' data-test-pill>Follow</Button>
        <Button @shape='square' data-test-square>Follow</Button>
        {{! @glint-expect-error - deliberately invalid }}
        <Button @shape='blob' data-test-unknown>Follow</Button>
      </template>,
    );
    assert.strictEqual(btn('[data-test-pill]').dataset['shape'], 'pill');
    assert.strictEqual(btn('[data-test-square]').dataset['shape'], 'square');
    assert.strictEqual(btn('[data-test-unknown]').dataset['shape'], 'rounded');
  });

  test('busy stays focusable, announces itself, and shows a decorative spinner', async function (assert) {
    await render(
      <template>
        <Button @busy={{true}}>Saving</Button>
      </template>,
    );
    let el = btn();
    assert.strictEqual(el.dataset['state'], 'busy');
    assert.strictEqual(el.getAttribute('aria-busy'), 'true');
    assert.false(el.disabled, 'native disabled would drop focus to <body>');
    assert.strictEqual(el.getAttribute('aria-disabled'), 'true');
    assert
      .dom('[data-test-pretui-button-spinner]')
      .hasAttribute('aria-hidden', 'true');
    assert
      .dom('[data-test-pretui-button-busy-label]')
      .hasNoText('the visible label already says it is busy');
  });

  test('@busyLabel adds the busy state to the accessible name', async function (assert) {
    await render(
      <template>
        <Button @busy={{true}} @busyLabel='Saving draft'>Save</Button>
      </template>,
    );
    assert.dom('[data-test-pretui-button-busy-label]').hasText('Saving draft');
  });

  test('the busy text is empty at rest', async function (assert) {
    await render(
      <template>
        <Button>Save</Button>
      </template>,
    );
    assert.dom('[data-test-pretui-button-busy-label]').hasNoText();
    assert.dom('[data-test-pretui-button-spinner]').doesNotExist();
    assert.false(btn().hasAttribute('aria-disabled'));
  });

  test('focus stays on the button when it turns busy', async function (assert) {
    class State {
      @tracked busy = false;
    }
    let state = new State();
    await render(
      <template>
        <Button @busy={{state.busy}}>Save</Button>
      </template>,
    );
    await focus(btn());
    state.busy = true;
    await settled();
    assert.strictEqual(document.activeElement, btn());
  });

  test('a busy button blocks its own click handlers and form submission', async function (assert) {
    let clicks = 0;
    let submits = 0;
    let onClick = () => clicks++;
    let onSubmit = (event: Event) => {
      event.preventDefault();
      submits++;
    };
    await render(
      <template>
        <form {{on 'submit' onSubmit}}>
          <Button
            type='submit'
            @busy={{true}}
            {{on 'click' onClick}}
          >Pay</Button>
        </form>
      </template>,
    );
    await click(btn());
    assert.strictEqual(clicks, 0, 'the caller handler does not run');
    assert.strictEqual(submits, 0, 'the form does not submit');
  });

  test('a button at rest still runs its click handler', async function (assert) {
    let clicks = 0;
    let onClick = () => clicks++;
    await render(
      <template>
        <Button {{on 'click' onClick}}>Pay</Button>
      </template>,
    );
    await click(btn());
    assert.strictEqual(clicks, 1);
  });

  test('disabled and busy together use native disabled only', async function (assert) {
    await render(
      <template>
        <Button @busy={{true}} @disabled={{true}}>Saving</Button>
      </template>,
    );
    let el = btn();
    assert.true(el.disabled);
    assert.false(
      el.hasAttribute('aria-disabled'),
      'never both disabled and aria-disabled',
    );
  });

  test('splattributes win over the template defaults', async function (assert) {
    await render(
      <template>
        <Button type='submit' class='checkout'>Pay</Button>
      </template>,
    );
    let el = btn();
    assert.strictEqual(el.type, 'submit', 'a form can still opt into submit');
    assert.true(
      el.classList.contains('pretui-btn'),
      'the kit class survives a caller class',
    );
    assert.true(el.classList.contains('checkout'));
  });

  // Alias vocabulary: markup written with other kits' names must work unchanged.
  test('Button accepts isDisabled / loading / sm / destructive', async function (assert) {
    await render(
      <template>
        <Button
          @tone='destructive'
          @size='lg'
          @loading={{true}}
          data-test-alias-button
        >Delete</Button>
      </template>,
    );
    let el = btn('[data-test-alias-button]');
    assert.strictEqual(el.dataset['tone'], 'danger', 'destructive → danger');
    assert.strictEqual(el.dataset['size'], 'l', 'lg → l');
    assert.strictEqual(el.dataset['state'], 'busy', 'loading → busy');
    assert.strictEqual(
      el.getAttribute('aria-busy'),
      'true',
      'busy is announced, not only painted',
    );
    assert.strictEqual(
      el.getAttribute('aria-disabled'),
      'true',
      'a busy button is not actionable',
    );
  });

  test('Button variant accepts the alias spellings and never crashes on an unknown one', async function (assert) {
    await render(
      <template>
        <Button @variant='outline' data-test-outline>Outline</Button>
        <Button @isDisabled={{true}} data-test-aria-disabled>Off</Button>
      </template>,
    );
    let outline = btn('[data-test-outline]');
    assert.strictEqual(outline.dataset['tone'], 'neutral');
    assert.strictEqual(
      outline.dataset['appearance'],
      'outlined',
      'outline → neutral × outlined',
    );
    assert.true(
      btn('[data-test-aria-disabled]').disabled,
      'isDisabled disables',
    );
  });

  // A plain object answers `constructor` with an inherited function, so alias tables are null-prototype.
  test('a variant, size or appearance naming an Object.prototype member falls back', async function (assert) {
    await render(
      <template>
        <Button
          {{! @glint-expect-error - deliberately invalid, as an unchecked string
            reaching @variant/@size/@appearance is the authoring failure mode }}
          @variant='constructor'
          {{! @glint-expect-error }}
          @size='toString'
          {{! @glint-expect-error }}
          @appearance='valueOf'
          data-test-proto
        >Act</Button>
      </template>,
    );
    let el = btn('[data-test-proto]');
    assert.strictEqual(
      el.dataset['tone'],
      'primary',
      'falls back to the default tone',
    );
    assert.strictEqual(
      el.dataset['appearance'],
      'accent',
      'falls back to the default appearance',
    );
    assert.strictEqual(
      el.dataset['size'],
      'm',
      'falls back to the default size',
    );
  });
});
