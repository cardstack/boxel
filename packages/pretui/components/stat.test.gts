// Pretui — Stat unit tests. Imports from ../reading; when Stat moves to
// its own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Stat } from './stat';

function q(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | components/stat', function (hooks) {
  setupCardTest(hooks);

  test('Stat rolls its headline by default and labels it', async function (assert) {
    await render(<template><Stat @label='Lots cured' @value={{1204}} @locale='en-US' /></template>);
    assert.strictEqual(q('.pretui-stat-label').textContent?.trim(), 'Lots cured');
    assert.ok(q('[data-test-pretui-odometer]'), 'the headline is an Odometer');
    assert.strictEqual(q('.pretui-odo-sr').textContent?.trim(), '1,204');
    assert.strictEqual(q('.pretui-stat-foot').textContent?.trim(), '', 'no delta, no hint, no empty text');
  });

  test('Stat renders plain text when rolling is turned off, formatted identically', async function (assert) {
    await render(<template><Stat @label='Lots' @value={{1204}} @roll={{false}} @locale='en-US' /></template>);
    assert.notOk(q('[data-test-pretui-odometer]'));
    assert.strictEqual(
      q('.pretui-stat-value').textContent?.trim(),
      '1,204',
      'the two branches share formatNumber, so they cannot disagree',
    );
  });

  test('Stat renders a signed delta and its hint', async function (assert) {
    await render(
      <template><Stat @label='Lots' @value={{1204}} @delta={{-18}} @hint='vs spring' @locale='en-US' /></template>,
    );
    let delta = q('[data-test-pretui-delta]');
    assert.strictEqual(delta.dataset['sign'], 'down');
    assert.strictEqual(delta.textContent?.trim(), '-18');
    assert.strictEqual(q('.pretui-stat-hint').textContent?.trim(), 'vs spring');
  });

  test('Stat renders a zero delta rather than treating it as absent', async function (assert) {
    await render(<template><Stat @label='Lots' @value={{10}} @delta={{0}} /></template>);
    assert.strictEqual(q('[data-test-pretui-delta]').dataset['sign'], 'flat', '"no change" is a real answer');
  });

  test('Stat uses a pre-formatted string headline verbatim', async function (assert) {
    await render(<template><Stat @label='Yield' @value='61%' /></template>);
    assert.strictEqual(q('.pretui-odo-sr').textContent?.trim(), '61%');
  });

  test('Stat formats a currency headline through the same knobs as FormatNumber', async function (assert) {
    await render(
      <template><Stat @label='Booked' @value={{12480}} @style='currency' @currency='USD' @locale='en-US' @maximumFractionDigits={{0}} /></template>,
    );
    assert.strictEqual(q('.pretui-odo-sr').textContent?.trim(), '$12,480');
  });

  test('Stat reserves a column width from @minDigits and drops it when unset', async function (assert) {
    await render(
      <template>
        <Stat @label='A' @value={{7}} @minDigits={{4}} />
        <Stat @label='B' @value={{7}} />
      </template>,
    );
    assert.deepEqual(
      all('.pretui-stat-value').map((v) => v.getAttribute('style')),
      ['--pretui-stat-min-digits: 4', null],
      'unset reserves nothing, so the box is content-sized exactly as before',
    );
  });

  test('Stat prints the placeholder for a value that is not a number', async function (assert) {
    await render(<template><Stat @label='Lots' @value='' @roll={{false}} @placeholder='—' /></template>);
    assert.strictEqual(q('.pretui-stat-value').textContent?.trim(), '—');
  });
});
