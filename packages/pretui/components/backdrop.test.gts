// Pretui — Backdrop unit tests. Imports from ../texture; when Backdrop moves
// to its own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied).
import { module, test } from 'qunit';
import { render, click, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Backdrop } from './backdrop';

function backdrop(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-backdrop]');
}

module('Pretui | components/backdrop', function (hooks) {
  setupCardTest(hooks);

  test('with no dismiss handler it is an inert, hidden scrim covering the viewport', async function (assert) {
    await render(<template><Backdrop /></template>);
    let el = backdrop() as HTMLElement;
    assert.strictEqual(el.tagName, 'DIV', 'not a button — there is nothing to press');
    assert.strictEqual(el.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(el.dataset['tone'], 'scrim');
    assert.strictEqual(el.dataset['position'], 'fixed');
    assert.strictEqual(el.dataset['blur'], 'false');
    assert.strictEqual(el.getAttribute('style'), null, 'no knobs, no inline style');
  });

  test('with a dismiss handler it becomes a real, named button — click and Escape dismiss (Enter/Space are native to a button)', async function (assert) {
    let dismissed = 0;
    const onDismiss = () => (dismissed += 1);
    await render(<template><Backdrop @onDismiss={{onDismiss}} /></template>);
    let el = backdrop() as HTMLButtonElement;
    assert.strictEqual(el.tagName, 'BUTTON', 'the clickable-div pattern has no keyboard path; this does');
    assert.strictEqual(el.getAttribute('aria-label'), 'Close');
    assert.strictEqual(el.tabIndex, -1, 'out of the tab order by default — the owning surface owns Escape');

    await click(el);
    await triggerKeyEvent(el, 'keydown', 'Escape');
    assert.strictEqual(dismissed, 2);
  });

  test('can join the tab order and take a caller label', async function (assert) {
    const noop = () => {};
    await render(<template><Backdrop @onDismiss={{noop}} @focusable={{true}} @label='Dismiss the sheet' /></template>);
    assert.strictEqual((backdrop() as HTMLButtonElement).tabIndex, 0);
    assert.strictEqual(backdrop()?.getAttribute('aria-label'), 'Dismiss the sheet');
  });

  test('renders nothing while closed', async function (assert) {
    await render(<template><Backdrop @open={{false}} /></template>);
    assert.strictEqual(backdrop(), null);
  });

  test('only a positive blur turns the filter on, and knobs travel as custom properties', async function (assert) {
    await render(<template><Backdrop @blur={{0}} /></template>);
    assert.strictEqual(backdrop()?.dataset['blur'], 'false', 'blur(0px) would still promote a compositing layer');

    await render(<template><Backdrop @tone='frost' @blur={{12}} @z={{70}} @position='absolute' /></template>);
    let el = backdrop() as HTMLElement;
    assert.strictEqual(el.dataset['blur'], 'true');
    assert.strictEqual(el.dataset['tone'], 'frost');
    assert.strictEqual(el.dataset['position'], 'absolute');
    assert.strictEqual(el.style.getPropertyValue('--pretui-backdrop-blur'), '12px');
    assert.strictEqual(el.style.getPropertyValue('--pretui-backdrop-z'), '70');

    await render(<template><Backdrop @blur={{999}} /></template>);
    assert.strictEqual((backdrop() as HTMLElement).style.getPropertyValue('--pretui-backdrop-blur'), '40px', 'clamped');
  });
});
