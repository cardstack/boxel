// Pretui — LoadingOverlay unit tests. What it controls is the region's busy
// state, the one status announcement, the content staying mounted, and the
// inert lock.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`.
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { LoadingOverlay } from './loading-overlay';

class State {
  @tracked open = false;
}

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-loading-overlay]') as HTMLElement;
}
function content(): HTMLElement {
  return document.querySelector('[data-test-pretui-loading-overlay-content]') as HTMLElement;
}
function status(): HTMLElement {
  return document.querySelector('[data-test-pretui-loading-overlay-status]') as HTMLElement;
}

module('Pretui | components/loading-overlay', function (hooks) {
  setupCardTest(hooks);

  test('closed, the region is not busy and nothing covers it', async function (assert) {
    await render(<template>
      <LoadingOverlay data-region='billing'><button type='button' class='t-save'>Save</button></LoadingOverlay>
    </template>);
    assert.strictEqual(root().getAttribute('aria-busy'), 'false');
    assert.strictEqual(root().getAttribute('data-region'), 'billing', 'attributes land on the region');
    assert.notOk(document.querySelector('[data-test-pretui-loading-overlay-scrim]'), 'no scrim');
    assert.strictEqual(status().textContent?.trim(), '', 'the status region is empty');
    assert.ok(document.querySelector('.t-save'), 'the content renders');
  });

  test('open, the region is busy, the scrim covers it and the status announces the label', async function (assert) {
    await render(<template>
      <LoadingOverlay @open={{true}} @label='Saving billing details'><p>Form</p></LoadingOverlay>
    </template>);
    assert.strictEqual(root().getAttribute('aria-busy'), 'true');
    assert.ok(document.querySelector('[data-test-pretui-loading-overlay-scrim]'), 'the scrim is shown');
    assert.strictEqual(status().getAttribute('role'), 'status');
    assert.strictEqual(status().textContent?.trim(), 'Saving billing details');
    assert.strictEqual(
      document.querySelectorAll('[role="status"]').length,
      1,
      'one announcement: the spinner does not add a second status',
    );
  });

  test('the content stays mounted across open and close', async function (assert) {
    let state = new State();
    await render(<template>
      <LoadingOverlay @open={{state.open}}><input class='t-field' aria-label='Account' /></LoadingOverlay>
    </template>);
    let field = document.querySelector('.t-field');
    state.open = true;
    await settled();
    assert.strictEqual(document.querySelector('.t-field'), field, 'the same element, not a re-render');
    state.open = false;
    await settled();
    assert.strictEqual(document.querySelector('.t-field'), field);
  });

  test('@lock makes the content inert only while open', async function (assert) {
    let state = new State();
    await render(<template>
      <LoadingOverlay @open={{state.open}} @lock={{true}}><input class='t-field' aria-label='Account' /></LoadingOverlay>
    </template>);
    assert.false(content().inert, 'closed, the content is live');
    state.open = true;
    await settled();
    assert.true(content().inert, 'open and locked, the content is inert');
    state.open = false;
    await settled();
    assert.false(content().inert, 'and live again when loading ends');
  });

  test('without @lock the content stays reachable under the scrim', async function (assert) {
    await render(<template>
      <LoadingOverlay @open={{true}}><input class='t-field' aria-label='Account' /></LoadingOverlay>
    </template>);
    assert.false(content().inert);
  });

  test('the label is announced by default and painted only with @showLabel', async function (assert) {
    await render(<template>
      <LoadingOverlay @open={{true}} />
    </template>);
    assert.strictEqual(status().textContent?.trim(), 'Loading', 'the default label');
    assert.notOk(document.querySelector('.pretui-lo-label'), 'not painted');
  });
});
