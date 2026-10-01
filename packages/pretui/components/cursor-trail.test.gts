// Pretui — CursorTrail unit tests. Imports from ../motion-pointer; when CursorTrail moves to its
// own file only the import path changes.
//
// Local-only test file, kept off the realm by `.boxelignore` (`*.test.gts`);
// run with `boxel test`. No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CursorTrail } from './cursor-trail';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-cursor-trail]') as HTMLElement;
}
function prop(name: string): string {
  return root().style.getPropertyValue(name);
}
function marks(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.pretui-trail-mark')) as HTMLElement[];
}

module('Pretui | components/cursor-trail', function (hooks) {
  setupCardTest(hooks);

  test('fans six marks from head to tail, each smaller, fainter and slower, in a hidden layer over live content', async function (assert) {
    await render(<template><CursorTrail><button type='button' data-test-live>Press</button></CursorTrail></template>);
    assert.ok(root().querySelector('[data-test-live]'), 'the control is a live child, not replaced by the overlay layer (pointer-events is CSS, unverifiable here)');
    assert.strictEqual(root().querySelector('.pretui-trail-layer')?.getAttribute('aria-hidden'), 'true');
    assert.strictEqual(marks().length, 6);
    assert.deepEqual(marks().map((m) => m.dataset['shape']), Array(6).fill('dot'));
    assert.strictEqual(marks()[0]?.getAttribute('style'), '--pretui-trail-scale: 1.000; --pretui-trail-opacity: 1.000; --pretui-trail-dur: 0.050s', 'the head is full size and nearly instant');
    assert.strictEqual(marks()[5]?.getAttribute('style'), '--pretui-trail-scale: 0.420; --pretui-trail-opacity: 0.280; --pretui-trail-dur: 0.470s', 'the tail lags by the default 0.42s');
    assert.strictEqual(prop('--pretui-trail-size'), '', 'no knobs, no size override');
    assert.strictEqual(prop('--pretui-trail-hue'), '');
  });

  test('clamps the count, takes size, shape and lag, and validates the hue', async function (assert) {
    await render(<template><CursorTrail @count={{99}} @size={{20}} @shape='ring' @lag={{1}} @hue='var(--chart-3)'>x</CursorTrail></template>);
    assert.strictEqual(marks().length, 24, 'capped at 24');
    assert.deepEqual([...new Set(marks().map((m) => m.dataset['shape']))], ['ring']);
    assert.true(marks()[23]?.getAttribute('style')?.endsWith('--pretui-trail-dur: 1.050s'));
    assert.strictEqual(prop('--pretui-trail-size'), '20px');
    assert.strictEqual(prop('--pretui-trail-hue'), 'var(--chart-3)');

    await render(<template><CursorTrail @count={{0}} @hue='red; background: url(javascript:0)'>x</CursorTrail></template>);
    assert.strictEqual(marks().length, 1, 'floored at one');
    assert.strictEqual(prop('--pretui-trail-hue'), '', 'the unsafe hue is dropped whole');
    assert.strictEqual(root().style.getPropertyValue('background'), '', 'and the hue carries nothing past the guard (the numeric args are another matter — see magnetic.test.gts)');
  });

  test('a seed jitters the mark sizes deterministically, and the mark block replaces the default', async function (assert) {
    await render(<template><CursorTrail @seed='wuyi' @count={{4}}><:default>x</:default><:mark as |m|><i data-test-mark data-depth={{m.depth}}>{{m.index}}</i></:mark></CursorTrail></template>);
    let first = marks().map((m) => m.getAttribute('style'));
    await render(<template><CursorTrail @seed='wuyi' @count={{4}}><:default>x</:default><:mark as |m|><i data-test-mark>{{m.index}}</i></:mark></CursorTrail></template>);
    assert.deepEqual(marks().map((m) => m.getAttribute('style')), first, 'the same seed, the same fan');
    let custom = Array.from(root().querySelectorAll('[data-test-mark]'));
    assert.deepEqual(custom.map((c) => c.textContent), ['0', '1', '2', '3'], 'the mark block replaces the default glyph inside each mark wrapper');

    await render(<template><CursorTrail @seed='wuyi' @count={{4}}>x</CursorTrail></template>);
    let seeded = marks().map((m) => m.getAttribute('style'));
    await render(<template><CursorTrail @seed='anxi' @count={{4}}>x</CursorTrail></template>);
    assert.notDeepEqual(marks().map((m) => m.getAttribute('style')), seeded, 'a different seed, a different fan');
    await render(<template><CursorTrail @count={{4}}>x</CursorTrail></template>);
    assert.notDeepEqual(marks().map((m) => m.getAttribute('style')), seeded, 'and unseeded differs from seeded — the seed does something');
    assert.strictEqual(marks()[0]?.getAttribute('style'), '--pretui-trail-scale: 1.000; --pretui-trail-opacity: 1.000; --pretui-trail-dur: 0.050s', 'unseeded: no jitter on the head mark');
  });
});
