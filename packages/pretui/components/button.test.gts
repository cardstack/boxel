// Pretui — Button unit tests. Imports the component from its own module, so
// the test holds as the unit contract independent of any barrel. No assertion
// touches a computed style: the host test harness stamps the scoped-css
// attribute and delivers no stylesheet.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
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
  });

  test('busy implies disabled, announces itself, and shows the spinner', async function (assert) {
    await render(
      <template>
        <Button @busy={{true}}>Saving</Button>
      </template>,
    );
    let el = btn();
    assert.strictEqual(el.dataset['state'], 'busy');
    assert.strictEqual(el.getAttribute('aria-busy'), 'true');
    assert.true(el.disabled, 'a busy button is not actionable');
    assert.ok(el.querySelector('.pretui-spinner'), 'the spinner is rendered');
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

  // ── React-dialect aliases (moved from controls.test.gts) ───────────────
  // Written in the vocabulary an agent trained on shadcn / Radix / Mantine /
  // MUI / React Aria emits, NOT the house names — the point of the alias
  // layer is that markup written from React muscle memory works.
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
    assert.true(el.disabled, 'a busy button is not actionable');
  });

  test('Button variant accepts the shadcn spellings and never crashes on an unknown one', async function (assert) {
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
      'shadcn outline → neutral × outlined',
    );
    assert.true(
      btn('[data-test-aria-disabled]').disabled,
      'isDisabled disables',
    );
  });

  // Prototype-key hazard: an alias table is indexed with whatever a card
  // author typed, and a plain object answers `constructor` with an inherited
  // function rather than undefined.
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
