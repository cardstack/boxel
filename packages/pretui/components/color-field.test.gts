// Pretui — ColorField unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ColorField } from './color-field';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

module('Pretui | components/color-field', function (hooks) {
  setupCardTest(hooks);

  test('ColorField shows the hex and names the trigger by the colour, not the raw string', async function (assert) {
    await render(<template><ColorField @label='Brand' @defaultValue='rgb(255 0 0)' /></template>);
    let trigger = q('.pretui-colorfield-trigger');
    assert.strictEqual(
      q('.pretui-colorfield-value').textContent?.trim(),
      '#ff0000',
      'one canonical spelling on screen whatever the caller wrote',
    );
    assert.true(
      (trigger.getAttribute('aria-label') ?? '').startsWith('Colour: '),
      'the accessible name describes the colour in words',
    );
    assert.strictEqual(trigger.getAttribute('aria-haspopup'), 'dialog');
    assert.strictEqual(trigger.getAttribute('aria-expanded'), 'false');
  });

  test('ColorField says so when there is no colour yet', async function (assert) {
    await render(<template><ColorField @label='Brand' /></template>);
    assert.strictEqual(q('.pretui-colorfield-value').textContent?.trim(), '');
    assert.strictEqual(q('.pretui-colorfield-trigger').getAttribute('aria-label'), 'Choose a colour');
  });

  test('ColorField opens its picker as a dialog', async function (assert) {
    await render(<template><ColorField @label='Brand' @defaultValue='#ff0000' /></template>);
    await click('.pretui-colorfield-trigger');
    assert.strictEqual(q('.pretui-colorfield-trigger').getAttribute('aria-expanded'), 'true');
    assert.ok(q('.pretui-colorfield-panel'), 'the panel is rendered only once it is open');
  });

  test('ColorField wires the trigger to the field label', async function (assert) {
    await render(<template><ColorField @label='Brand colour' @defaultValue='#ff0000' /></template>);
    let trigger = q('.pretui-colorfield-trigger');
    assert.true(trigger.id.length > 0, 'the control has an id for the label to point at');
    assert.strictEqual(
      document.querySelector(`label[for="${trigger.id}"]`)?.textContent?.trim(),
      'Brand colour',
      'and the pairing actually resolves',
    );
  });

  test('ColorField is disabled through to the trigger', async function (assert) {
    await render(<template><ColorField @label='Brand' @defaultValue='#ff0000' @disabled={{true}} /></template>);
    assert.true((q('.pretui-colorfield-trigger') as HTMLButtonElement).disabled);
  });
});
