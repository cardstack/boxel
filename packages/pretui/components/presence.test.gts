// Pretui — Presence unit tests. Imports from ../motion-core; when Presence moves to its
// own file only the import path changes.
//
// No assertion touches a computed style: the
// component's own `<style scoped>` is inert in this harness (the scoped-css
// attribute is stamped, the rules are not applied) — so motion is asserted
// as the custom properties and structure the CSS animates from, never as
// movement.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Presence } from './presence';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-presence]') as HTMLElement;
}

module('Pretui | components/presence', function (hooks) {
  setupCardTest(hooks);

  test('shown by default, with enter and exit transforms and an exit two-thirds the entrance', async function (assert) {
    await render(<template><Presence><p data-test-body>hi</p></Presence></template>);
    assert.strictEqual(root().dataset['show'], 'true');
    assert.false(root().inert);
    assert.strictEqual(root().getAttribute('style'), '--pretui-presence-enter: none; --pretui-presence-exit: none; --pretui-presence-enter-duration: 0.220s; --pretui-presence-exit-duration: 0.147s; --pretui-presence-delay: 0.000s', 'leaving should not linger');
  });

  test('hidden keeps the content in the DOM for the exit transition, but inert', async function (assert) {
    await render(<template><Presence @show={{false}}><p data-test-body>hi</p></Presence></template>);
    assert.strictEqual(root().dataset['show'], 'false');
    assert.true(root().inert, 'out of the tab order and the accessibility tree while it fades');
    assert.ok(root().querySelector('[data-test-body]'), 'do NOT also wrap it in an if — the exit would have nothing to animate');
  });

  test('exit defaults to the entrance preset and is separately settable, with its own duration', async function (assert) {
    await render(<template><Presence @enter='rise' @duration={{0.6}} @delay={{0.1}}>x</Presence></template>);
    let style = root().getAttribute('style') ?? '';
    assert.true(style.includes('--pretui-presence-enter: translateY(var(--pretui-motion-distance, 8px)); --pretui-presence-exit: translateY(var(--pretui-motion-distance, 8px))'));
    assert.true(style.includes('--pretui-presence-enter-duration: 0.600s; --pretui-presence-exit-duration: 0.400s; --pretui-presence-delay: 0.100s'));

    await render(<template><Presence @enter='rise' @exit='fade' @exitDuration={{0.1}} @distance={{20}}>x</Presence></template>);
    style = root().getAttribute('style') ?? '';
    assert.true(style.includes('--pretui-presence-exit: none'));
    assert.true(style.includes('--pretui-presence-exit-duration: 0.100s'));
    assert.true(style.includes('--pretui-motion-distance: 20px'));
  });
});
