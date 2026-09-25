// Pretui — Cue unit tests. Imports from its own module rather than the
// './controls' barrel: the per-component test is the unit contract and has to
// keep holding as the barrel is dismantled.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Cue } from './cue';
import type { CueTone } from './cue';

function cue(): HTMLElement {
  return document.querySelector('[data-test-pretui-cue]') as HTMLElement;
}
function all(sel: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(sel)) as HTMLElement[];
}

module('Pretui | components/cue', function (hooks) {
  setupCardTest(hooks);

  test('defaults to a neutral description on the block-end edge', async function (assert) {
    await render(<template><Cue @text='Two decimal places' /></template>);
    let el = cue();
    assert.strictEqual(el.dataset['kind'], 'description');
    assert.strictEqual(el.dataset['position'], 'block-end');
    assert.strictEqual(el.dataset['tone'], 'neutral');
    assert.strictEqual(el.textContent?.trim(), 'Two decimal places');
    assert.notOk(el.querySelector('.pretui-cue-glyph'), 'neutral is the one tone with no glyph');
    assert.strictEqual(el.getAttribute('role'), null, 'a description is not a live region');
  });

  test('mints a unique id per instance and lets a caller pin one', async function (assert) {
    await render(
      <template>
        <Cue @text='one' />
        <Cue @text='two' />
        <Cue @text='three' @id='pinned-hint' />
      </template>,
    );
    let ids = all('[data-test-pretui-cue]').map((e) => e.id);
    assert.strictEqual(new Set(ids).size, 3, 'two cues in the same form never collide');
    assert.strictEqual(ids[2], 'pinned-hint', 'so an external control can point aria-describedby at it');
    assert.true(ids.every(Boolean), 'every cue is referenceable');
  });

  test('every non-neutral tone carries a glyph, so it survives greyscale', async function (assert) {
    await render(
      <template>
        <Cue @tone='info' @text='i' />
        <Cue @tone='success' @text='s' />
        <Cue @tone='warning' @text='w' />
        <Cue @tone='danger' @text='d' />
      </template>,
    );
    let glyphs = all('[data-test-pretui-cue]').map((e) =>
      e.querySelector('.pretui-cue-glyph')?.textContent?.trim(),
    );
    assert.deepEqual(glyphs, ['i', '✓', '!', '✕'], 'colour is never the only signal');
    assert.deepEqual(
      all('.pretui-cue-glyph').map((g) => g.getAttribute('aria-hidden')),
      Array(4).fill('true'),
      'and the glyph is decorative — the text carries the meaning',
    );
  });

  test('accepts the React tone spellings', async function (assert) {
    await render(
      <template>
        <Cue @tone='destructive' @text='a' />
        <Cue @tone='positive' @text='b' />
        <Cue @tone='notice' @text='c' />
      </template>,
    );
    assert.deepEqual(
      all('[data-test-pretui-cue]').map((e) => e.dataset['tone']),
      ['danger', 'success', 'warning'],
    );
  });

  test('falls back rather than emitting a dead tone', async function (assert) {
    // Cast because the point of the test is a value the type forbids: an
    // agent writing a template does not get a type-check, so the runtime
    // narrowing has to hold on its own.
    const UNKNOWN = 'chartreuse' as CueTone;
    await render(<template><Cue @tone={{UNKNOWN}} @text='x' /></template>);
    assert.strictEqual(cue().dataset['tone'], 'neutral', 'an unknown tone lands on the default');
  });

  test('the error kind is a description in the danger tone by default', async function (assert) {
    await render(<template><Cue @kind='error' @text='Required' /></template>);
    let el = cue();
    assert.strictEqual(el.dataset['kind'], 'error');
    assert.strictEqual(el.dataset['tone'], 'danger', 'the tone follows the kind without being restated');
    assert.strictEqual(el.querySelector('.pretui-cue-glyph')?.textContent?.trim(), '✕');
  });

  test('an explicit tone still wins over the kind default', async function (assert) {
    await render(<template><Cue @kind='error' @tone='warning' @text='Check this' /></template>);
    assert.strictEqual(cue().dataset['tone'], 'warning');
  });

  test('the status kind announces politely', async function (assert) {
    await render(<template><Cue @kind='status' @text='Saved' /></template>);
    let el = cue();
    assert.strictEqual(el.getAttribute('role'), 'status');
    assert.strictEqual(el.getAttribute('aria-live'), 'polite');
  });

  test('a decorative cue is hidden from assistive tech entirely', async function (assert) {
    await render(<template><Cue @decorative={{true}} @text='※' /></template>);
    assert.strictEqual(cue().getAttribute('aria-hidden'), 'true');
  });

  test('positions on any logical edge', async function (assert) {
    await render(<template><Cue @position='inline-start' @text='USD' /></template>);
    assert.strictEqual(
      cue().dataset['position'],
      'inline-start',
      'logical, so RTL is free — this is the reading start, not the left',
    );
  });

  test('yields a block when a cue needs markup, and @text wins over it', async function (assert) {
    await render(<template><Cue><b data-test-strong>Bold</b> hint</Cue></template>);
    assert.ok(cue().querySelector('[data-test-strong]'));

    await render(<template><Cue @text='literal'><b>Bold</b></Cue></template>);
    assert.strictEqual(cue().textContent?.trim(), 'literal');
  });
});
