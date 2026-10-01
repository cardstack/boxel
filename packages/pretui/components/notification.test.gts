// Pretui — Notification unit tests: tone resolution, the opt-in live region,
// the busy state, the inline action and the named dismiss button.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Notification } from './notification';

// not a tone this component knows, so the fallback is what is under test
const SIDEWAYS = 'sideways' as unknown as 'neutral';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-notification]') as HTMLElement;
}

module('Pretui | components/notification', function (hooks) {
  setupCardTest(hooks);

  test('it renders the title and message, with attributes on the root', async function (assert) {
    await render(<template>
      <Notification @title='Lot 7 is ready' @message='Labels are printed.' data-kind='shipping' />
    </template>);
    assert.strictEqual(root().getAttribute('data-kind'), 'shipping');
    assert.strictEqual(
      document.querySelector('[data-test-pretui-notification-title]')?.textContent?.trim(),
      'Lot 7 is ready',
    );
    assert.strictEqual(
      document.querySelector('[data-test-pretui-notification-message]')?.textContent?.trim(),
      'Labels are printed.',
    );
    assert.strictEqual(root().dataset['tone'], 'neutral', 'neutral by default');
  });

  test('@description is an alias of @message', async function (assert) {
    await render(<template><Notification @title='Saved' @description='All changes are stored.' /></template>);
    assert.strictEqual(
      document.querySelector('[data-test-pretui-notification-message]')?.textContent?.trim(),
      'All changes are stored.',
    );
  });

  test('tone spellings resolve; an unknown tone is neutral', async function (assert) {
    await render(<template>
      <div class='t-a'><Notification @title='A' @tone='error' /></div>
      <div class='t-b'><Notification @title='B' @tone='positive' /></div>
      <div class='t-c'><Notification @title='C' @tone={{SIDEWAYS}} /></div>
    </template>);
    let tone = (sel: string) =>
      (document.querySelector(`${sel} [data-test-pretui-notification]`) as HTMLElement).dataset['tone'];
    assert.strictEqual(tone('.t-a'), 'danger');
    assert.strictEqual(tone('.t-b'), 'success');
    assert.strictEqual(tone('.t-c'), 'neutral');
  });

  test('it is not a live region unless @live asks, and then politeness follows the tone', async function (assert) {
    await render(<template>
      <div class='t-quiet'><Notification @title='Quiet' @tone='danger' /></div>
      <div class='t-ok'><Notification @title='Saved' @tone='success' @live={{true}} /></div>
      <div class='t-bad'><Notification @title='Failed' @tone='danger' @live={{true}} /></div>
    </template>);
    let el = (sel: string) => document.querySelector(`${sel} [data-test-pretui-notification]`) as HTMLElement;
    assert.notOk(el('.t-quiet').hasAttribute('role'), 'a listed notification is not announced');
    assert.notOk(el('.t-quiet').hasAttribute('aria-live'));
    assert.strictEqual(el('.t-ok').getAttribute('role'), 'status');
    assert.strictEqual(el('.t-ok').getAttribute('aria-live'), 'polite');
    assert.strictEqual(el('.t-bad').getAttribute('role'), 'alert');
    assert.strictEqual(el('.t-bad').getAttribute('aria-live'), 'assertive');
  });

  test('@busy marks it busy and shows a spinner that adds no second announcement', async function (assert) {
    await render(<template><Notification @title='Uploading' @busy={{true}} /></template>);
    assert.strictEqual(root().getAttribute('aria-busy'), 'true');
    assert.ok(root().querySelector('[data-test-pretui-spinner]'), 'the spinner shows');
    assert.strictEqual(root().querySelectorAll('[role="status"]').length, 0, 'the spinner is not its own status');
  });

  test('the inline action fires @onAction', async function (assert) {
    let fired = 0;
    let act = () => fired++;
    await render(<template><Notification @title='Archived' @actionLabel='Undo' @onAction={{act}} /></template>);
    let button = document.querySelector('[data-test-pretui-notification-action]') as HTMLButtonElement;
    assert.strictEqual(button.textContent?.trim(), 'Undo');
    assert.strictEqual(button.type, 'button');
    await click(button);
    assert.strictEqual(fired, 1);
  });

  test('the dismiss button exists only with @onDismiss, is named, and fires it', async function (assert) {
    let dismissed = 0;
    let dismiss = () => dismissed++;
    await render(<template>
      <div class='t-none'><Notification @title='Sticky' /></div>
      <div class='t-x'><Notification @title='Closable' @onDismiss={{dismiss}} @dismissLabel='Dismiss shipping notice' /></div>
    </template>);
    assert.notOk(document.querySelector('.t-none [data-test-pretui-notification-dismiss]'));
    let x = document.querySelector('.t-x [data-test-pretui-notification-dismiss]') as HTMLButtonElement;
    assert.strictEqual(x.getAttribute('aria-label'), 'Dismiss shipping notice');
    await click(x);
    assert.strictEqual(dismissed, 1);
  });

  test('the default and action blocks replace the message and the inline action', async function (assert) {
    await render(<template>
      <Notification @title='Invoice due' @message='ignored' @actionLabel='ignored'>
        <:default><strong class='t-body'>Due Friday</strong></:default>
        <:action><a href='#pay' class='t-pay'>Pay</a></:action>
      </Notification>
    </template>);
    assert.ok(document.querySelector('.t-body'));
    assert.notOk(document.querySelector('[data-test-pretui-notification-message]'));
    assert.ok(document.querySelector('.t-pay'));
    assert.notOk(document.querySelector('[data-test-pretui-notification-action]'));
  });
});
