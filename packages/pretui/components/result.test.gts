// Pretui — Result unit tests: the status resolution, the heading, the code
// defaults and the blocks.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Result } from './result';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-result]') as HTMLElement;
}
function heading(): HTMLElement | null {
  return document.querySelector('[data-test-pretui-result-title]');
}

module('Pretui | components/result', function (hooks) {
  setupCardTest(hooks);

  test('a Result is a section with one heading, a description, and attributes on the root', async function (assert) {
    await render(<template>
      <Result @status='success' @title='Order placed' @description='Lot 7 ships Thursday.' data-flow='checkout' />
    </template>);
    assert.strictEqual(root().tagName, 'SECTION');
    assert.strictEqual(root().getAttribute('data-flow'), 'checkout');
    assert.strictEqual(root().dataset['status'], 'success');
    assert.strictEqual(heading()?.getAttribute('role'), 'heading');
    assert.strictEqual(heading()?.getAttribute('aria-level'), '2', 'level 2 by default');
    assert.strictEqual(heading()?.textContent?.trim(), 'Order placed');
    assert.strictEqual(
      document.querySelector('[data-test-pretui-result-description]')?.textContent?.trim(),
      'Lot 7 ships Thursday.',
    );
  });

  test('the glyph is decoration, hidden from assistive technology', async function (assert) {
    await render(<template><Result @status='danger' @title='Payment failed' /></template>);
    let mark = document.querySelector('.pretui-result-mark');
    assert.strictEqual(mark?.getAttribute('aria-hidden'), 'true');
  });

  test('@headingLevel sets the level', async function (assert) {
    await render(<template><Result @title='Done' @headingLevel={{1}} /></template>);
    assert.strictEqual(heading()?.getAttribute('aria-level'), '1');
  });

  test('an HTTP code gets its numerals and a default title', async function (assert) {
    await render(<template><Result @status='404' /></template>);
    assert.strictEqual(root().dataset['status'], '404');
    assert.strictEqual(document.querySelector('.pretui-result-code')?.textContent?.trim(), '404');
    assert.strictEqual(heading()?.textContent?.trim(), 'This page does not exist');
  });

  test('a numeric status resolves like its string', async function (assert) {
    await render(<template><Result @status={{403}} /></template>);
    assert.strictEqual(root().dataset['status'], '403');
    assert.strictEqual(heading()?.textContent?.trim(), 'You do not have access to this page');
  });

  test('the caller title wins over a code default', async function (assert) {
    await render(<template><Result @status='500' @title='The roastery is offline' /></template>);
    assert.strictEqual(heading()?.textContent?.trim(), 'The roastery is offline');
  });

  test('tone spellings resolve; an unknown status falls back to info', async function (assert) {
    await render(<template>
      <div class='t-a'><Result @status='error' @title='A' /></div>
      <div class='t-b'><Result @status='positive' @title='B' /></div>
      <div class='t-c'><Result @status='sideways' @title='C' /></div>
    </template>);
    let status = (sel: string) =>
      (document.querySelector(`${sel} [data-test-pretui-result]`) as HTMLElement).dataset['status'];
    assert.strictEqual(status('.t-a'), 'danger');
    assert.strictEqual(status('.t-b'), 'success');
    assert.strictEqual(status('.t-c'), 'info');
  });

  test('no title, no heading: a tone status without a title renders none', async function (assert) {
    await render(<template><Result @status='info' /></template>);
    assert.notOk(heading());
  });

  test('the icon, default and extra blocks render in place', async function (assert) {
    await render(<template>
      <Result @status='success' @title='Done'>
        <:icon><span class='t-icon'>★</span></:icon>
        <:default><p class='t-body'>Order 1042</p></:default>
        <:extra><button type='button' class='t-action'>View order</button></:extra>
      </Result>
    </template>);
    assert.ok(document.querySelector('.pretui-result-mark .t-icon'), 'the icon replaces the glyph');
    assert.notOk(document.querySelector('.pretui-result-glyph'));
    assert.ok(document.querySelector('.pretui-result-body .t-body'));
    assert.ok(document.querySelector('[data-test-pretui-result-extra] .t-action'));
  });
});
