// Pretui — UrlInput unit tests. Imports from ./extras; when UrlInput moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, fillIn, focus, blur } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { UrlInput } from './extras';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function field(wrapper: string): HTMLInputElement {
  return q(`${wrapper} input`) as HTMLInputElement;
}

module('Pretui | components/url-input', function (hooks) {
  setupCardTest(hooks);

  test('UrlInput stays neutral until it has been touched', async function (assert) {
    await render(<template><UrlInput @controlId='site' /></template>);
    assert.strictEqual(q('[data-test-pretui-url-input]').dataset['state'], 'initial');
    assert.strictEqual(field('[data-test-pretui-url-input]').type, 'url');
    assert.strictEqual(field('[data-test-pretui-url-input]').id, 'site');
  });

  test('UrlInput holds its first error until blur, then revalidates live', async function (assert) {
    let errors: (string | null)[] = [];
    const onValidation = (e: string | null) => errors.push(e);
    await render(<template><UrlInput @onValidation={{onValidation}} /></template>);
    let input = field('[data-test-pretui-url-input]');

    await fillIn(input, 'wuyi-origins');
    assert.strictEqual(
      q('[data-test-pretui-url-input]').dataset['state'],
      'initial',
      'no red while the reader is still typing the first time',
    );
    assert.deepEqual(errors, [], 'and nothing reported yet');

    await blur(input);
    assert.strictEqual(q('[data-test-pretui-url-input]').dataset['state'], 'invalid');
    assert.strictEqual(errors.at(-1), 'Not a valid URL — include the protocol (https://…).');

    await fillIn(input, 'https://wuyi-origins.test');
    assert.strictEqual(
      q('[data-test-pretui-url-input]').dataset['state'],
      'valid',
      'once touched, recovery is instant rather than waiting for another blur',
    );
    assert.strictEqual(errors.at(-1), null);
  });

  test('UrlInput rejects a URL that parses but is not web-fetchable', async function (assert) {
    let errors: (string | null)[] = [];
    const onValidation = (e: string | null) => errors.push(e);
    await render(<template><UrlInput @onValidation={{onValidation}} /></template>);
    let input = field('[data-test-pretui-url-input]');
    await fillIn(input, 'ftp://files.example.test');
    await blur(input);
    assert.strictEqual(errors.at(-1), 'URL must use http:// or https://.');
  });

  test('UrlInput treats an empty field as fine unless it is required', async function (assert) {
    await render(<template><UrlInput /></template>);
    await focus(field('[data-test-pretui-url-input]'));
    await blur(field('[data-test-pretui-url-input]'));
    assert.strictEqual(q('[data-test-pretui-url-input]').dataset['state'], 'initial', 'empty and optional is not an error');

    let errors: (string | null)[] = [];
    const onValidation = (e: string | null) => errors.push(e);
    await render(<template><UrlInput @required={{true}} @onValidation={{onValidation}} /></template>);
    await focus(field('[data-test-pretui-url-input]'));
    await blur(field('[data-test-pretui-url-input]'));
    assert.strictEqual(errors.at(-1), 'URL is required.');
  });

  test('UrlInput reports every keystroke through the notify aliases', async function (assert) {
    let seen: string[] = [];
    const a = (v: string) => seen.push(`in:${v}`);
    const b = (v: string) => seen.push(`ch:${v}`);
    await render(<template><UrlInput @onInput={{a}} @onChange={{b}} /></template>);
    await fillIn(field('[data-test-pretui-url-input]'), 'x');
    assert.deepEqual(seen, ['in:x', 'ch:x'], 'both, in order, neither doubled');
  });
});
