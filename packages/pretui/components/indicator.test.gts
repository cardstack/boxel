// Pretui — Indicator unit tests: the dot is decoration, the label is the meaning.
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Indicator } from './indicator';

module('Pretui | components/indicator', function (hooks) {
  setupCardTest(hooks);

  test('the dot is hidden from assistive technology and the label follows the child', async function (assert) {
    await render(<template><Indicator @label='Online' data-who='ana'><span class='t-name'>Ana Ruiz</span></Indicator></template>);
    let root = document.querySelector('[data-test-pretui-indicator]') as HTMLElement;
    let dot = document.querySelector('[data-test-pretui-indicator-dot]') as HTMLElement;
    let label = document.querySelector('[data-test-pretui-indicator-label]') as HTMLElement;
    assert.strictEqual(root.getAttribute('data-who'), 'ana');
    assert.strictEqual(dot.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(label.textContent?.trim(), 'Online');
    assert.strictEqual(root.textContent?.replace(/\s+/g, ' ').trim(), 'Ana Ruiz Online', 'read in order: child, then meaning');
    assert.strictEqual(dot.dataset['tone'], 'success', 'success by default');
  });

  test('@ping, @tone and @placement', async function (assert) {
    await render(<template><Indicator @label='Live' @ping={{true}} @tone='danger' @placement='top-left'><span>Studio</span></Indicator></template>);
    let dot = document.querySelector('[data-test-pretui-indicator-dot]') as HTMLElement;
    assert.strictEqual(dot.dataset['ping'], 'true');
    assert.strictEqual(dot.dataset['tone'], 'danger');
    assert.strictEqual((document.querySelector('[data-test-pretui-indicator]') as HTMLElement).dataset['placement'], 'top-start');
  });

  test('@invisible removes the dot and its announcement together', async function (assert) {
    await render(<template><Indicator @label='Online' @invisible={{true}}><span class='t-child'>Ana</span></Indicator></template>);
    assert.notOk(document.querySelector('[data-test-pretui-indicator-dot]'));
    assert.notOk(document.querySelector('[data-test-pretui-indicator-label]'), 'no label for a dot that is not there');
    assert.ok(document.querySelector('.t-child'));
  });

  test('a focusable child is described by the label', async function (assert) {
    await render(<template><Indicator @label='Online'><button type='button'>Ana Ruiz</button></Indicator></template>);
    let btn = document.querySelector('[data-test-pretui-indicator] button') as HTMLElement;
    let label = document.querySelector('[data-test-pretui-indicator-label]') as HTMLElement;
    assert.strictEqual(btn.getAttribute('aria-describedby'), label.id);
  });
});
