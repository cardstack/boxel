// Pretui — Tilt unit tests. Imports from ../motion-pointer; when Tilt moves to its
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
import { Tilt } from './tilt';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-tilt]') as HTMLElement;
}

function prop(name: string): string {
  return root().style.getPropertyValue(name);
}

module('Pretui | components/tilt', function (hooks) {
  setupCardTest(hooks);

  test('rests on a card plate with a glare, leaning toward the pointer', async function (assert) {
    await render(<template><Tilt><p data-test-body>card</p></Tilt></template>);
    assert.strictEqual(prop('--pretui-tilt-sign'), '1');
    assert.strictEqual(prop('--pretui-tilt-max'), '', 'the CSS default holds unless asked');
    assert.strictEqual(root().dataset['plate'], 'true', 'the resting state that makes it visible in a still frame');
    assert.strictEqual(root().dataset['press'], 'true');
    assert.ok(root().querySelector('.pretui-tilt-plate [data-test-body]'));
    assert.strictEqual(root().querySelector('.pretui-tilt-glare')?.getAttribute('aria-hidden'), 'true');
  });

  test('reverse flips the sign; max, perspective, plate, press and glare are knobs', async function (assert) {
    await render(<template><Tilt @reverse={{true}} @max={{4}} @perspective={{600}} @plate={{false}} @press={{false}} @glare={{false}}>x</Tilt></template>);
    assert.deepEqual([prop('--pretui-tilt-sign'), prop('--pretui-tilt-max'), prop('--pretui-tilt-perspective')], ['-1', '4', '600px']);
    assert.strictEqual(root().dataset['plate'], 'false');
    assert.strictEqual(root().dataset['press'], 'false');
    assert.strictEqual(root().querySelector('.pretui-tilt-glare'), null);
  });
});
