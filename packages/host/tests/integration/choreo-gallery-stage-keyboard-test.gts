/**
 * The stages' keyboard paths: every focusable part of a stage shows the
 * site's focus ring, and what a pointer does on a stage's open surface a
 * key can do too.
 */
import { click, focus, triggerKeyEvent, waitUntil } from '@ember/test-helpers';

import { animationsSettled } from 'glimmer-motion/test-support';
import { module, test } from 'qunit';

import { setupChoreoGalleryTest } from '../helpers/choreo-gallery-stage';

/** the focus ring the browser draws on `el` once it has keyboard focus */
async function ringOn(el: HTMLElement) {
  await focus(el);
  return {
    focusVisible: el.matches(':focus-visible'),
    outline: getComputedStyle(el).outlineStyle,
  };
}

/** the keydown that reaches the document, if a stage lets it through */
async function keyAtDocument(el: HTMLElement, key: string) {
  let seen: KeyboardEvent | undefined;
  let listen = (event: KeyboardEvent) => (seen = event);
  document.addEventListener('keydown', listen);
  try {
    await triggerKeyEvent(el, 'keydown', key);
  } finally {
    document.removeEventListener('keydown', listen);
  }
  return seen;
}

module('Integration | Choreo gallery | stage keyboard', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  test('a camera print shows the focus ring', async function (assert) {
    await gallery.renderStage(await gallery.stage('camera', 'Camera'));
    let print = document.querySelector<HTMLElement>('[data-test-cam-print]')!;
    let ring = await ringOn(print);
    assert.true(ring.focusVisible, 'the print has keyboard focus');
    assert.notStrictEqual(ring.outline, 'none', 'the print draws a ring');
  });

  test('Escape backs out of a camera dive and returns focus to the print', async function (assert) {
    await gallery.renderStage(await gallery.stage('camera', 'Camera'));
    let print = document.querySelector<HTMLElement>('[data-test-cam-print]')!;
    assert.strictEqual(print.getAttribute('aria-pressed'), 'false');

    await focus(print);
    await click(print);
    await waitUntil(() => document.querySelector('[data-test-cam-love]'));
    assert.strictEqual(
      print.getAttribute('aria-pressed'),
      'true',
      'the open print reads as pressed',
    );

    // focus in the dock, which closes with the dive
    let love = document.querySelector<HTMLElement>('[data-test-cam-love]')!;
    await focus(love);
    let reached = await keyAtDocument(love, 'Escape');
    await animationsSettled();
    assert.strictEqual(reached, undefined, 'the stage kept the key');
    assert.dom('[data-test-cam-love]').doesNotExist('the dive closed');
    assert.strictEqual(print.getAttribute('aria-pressed'), 'false');
    assert.strictEqual(
      document.activeElement,
      print,
      'focus is back on the print that was open',
    );
  });

  test('Escape with no dive open is left for the host', async function (assert) {
    await gallery.renderStage(await gallery.stage('camera', 'Camera'));
    let print = document.querySelector<HTMLElement>('[data-test-cam-print]')!;
    await focus(print);
    let reached = await keyAtDocument(print, 'Escape');
    assert.ok(reached, 'the key reaches the host');
    assert.false(reached!.defaultPrevented, 'the stage left it alone');
  });

  test('a wires mark and comment show the focus ring', async function (assert) {
    await gallery.renderStage(await gallery.stage('wires', 'Wires'));
    for (let selector of ['[data-test-wires-mark]', '[data-test-wires-note]']) {
      let el = document.querySelector<HTMLElement>(selector)!;
      let ring = await ringOn(el);
      assert.true(ring.focusVisible, `${selector} has keyboard focus`);
      assert.notStrictEqual(ring.outline, 'none', `${selector} draws a ring`);
    }
  });
});
