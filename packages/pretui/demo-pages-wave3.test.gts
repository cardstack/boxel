// Pretui — render proof for the usage pages of the controls/motion wave that
// added Dropzone, FileTrigger, Reorder, ActionBar, KnownDate, TextEffects,
// PathText and TextMorph.
//
// Why this file exists: a clean `boxel realm indexing-errors` proves a module
// EVALUATES, not that it renders — the indexer never runs a template's
// render-time getters or modifier bodies. A usage page that throws when it is
// opened is exactly the failure mode a catalog tile cannot survive, because
// the tile claims the component is live. These are deliberately shallow: each
// page is mounted, and the component under demonstration is asserted present.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { DEMOS_ACTION_BAR } from './components/action-bar.usage';
import { DEMOS_DROPZONE } from './components/dropzone.usage';
import { DEMOS_FILE_TRIGGER } from './components/file-trigger.usage';
import { DEMOS_KNOWN_DATE } from './components/known-date.usage';
import { DEMOS_PATH_TEXT } from './components/path-text.usage';
import { DEMOS_CONTROLS_REORDER } from './components/reorder.usage';
import { DEMOS_TEXT_EFFECTS } from './components/text-effects.usage';
import { DEMOS_TEXT_MORPH } from './components/text-morph.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_ACTION_BAR, ...DEMOS_DROPZONE, ...DEMOS_FILE_TRIGGER, ...DEMOS_KNOWN_DATE, ...DEMOS_PATH_TEXT, ...DEMOS_CONTROLS_REORDER, ...DEMOS_TEXT_EFFECTS, ...DEMOS_TEXT_MORPH };

/* eslint-disable @typescript-eslint/no-explicit-any -- the DEMOS registries
   are Record<string, unknown> by design (they are looked up by name at
   runtime), so a test that mounts one has to assert the component shape. */
const Pages = {
  FileTrigger: PAGES['FileTrigger'] as any,
  Dropzone: PAGES['Dropzone'] as any,
  Reorder: PAGES['Reorder'] as any,
  ActionBar: PAGES['ActionBar'] as any,
  KnownDate: PAGES['KnownDate'] as any,
  TextEffects: PAGES['TextEffects'] as any,
  PathText: PAGES['PathText'] as any,
  TextMorph: PAGES['TextMorph'] as any,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}

module('Pretui | usage pages | wave 3', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('every page in the wave is registered', function (assert) {
    for (let name of Object.keys(Pages)) {
      assert.ok(
        (Pages as Record<string, unknown>)[name],
        name + ' has a usage page — a tile with no page is a tile that lies',
      );
    }
  });

  test('FileTrigger page mounts', async function (assert) {
    let Page = Pages.FileTrigger;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-file-trigger]'));
  });

  test('Dropzone page mounts', async function (assert) {
    let Page = Pages.Dropzone;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-dropzone]'));
  });

  test('Reorder page mounts', async function (assert) {
    let Page = Pages.Reorder;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-reorder]'));
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-reorder-handle]').length,
      6,
      'with the demo list in place',
    );
  });

  test('ActionBar page mounts with a live selection', async function (assert) {
    let Page = Pages.ActionBar;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-action-bar]'));
  });

  test('KnownDate page mounts', async function (assert) {
    let Page = Pages.KnownDate;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-known-date]'));
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-known-date-part]').length,
      3,
      'three boxes',
    );
  });

  test('TextEffects page mounts', async function (assert) {
    let Page = Pages.TextEffects;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-text-effects]'));
  });

  test('PathText page mounts', async function (assert) {
    let Page = Pages.PathText;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-path-text]'));
    assert.ok(root().querySelector('textPath'), 'and draws its textPath');
  });

  test('TextMorph page mounts', async function (assert) {
    let Page = Pages.TextMorph;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-text-morph]'));
  });
});
