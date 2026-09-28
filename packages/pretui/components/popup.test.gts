// Pretui — Popup unit tests. Imports from ../overlay; when Popup moves to its
// own file only the import path changes.
//
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules are
// not applied).
import { module, test } from 'qunit';
import { render, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { Popup } from './popup';

module('Pretui | components/popup', function (hooks) {
  setupCardTest(hooks);

  test('renders its anchor inline and nothing else while closed', async function (assert) {
    await render(
      <template>
        <Popup @open={{false}}>
          <:anchor><button type='button' data-test-anchor>Open</button></:anchor>
          <:default><div data-test-panel>panel</div></:default>
        </Popup>
      </template>,
    );
    assert.ok(document.querySelector('.pretui-popup-anchor [data-test-anchor]'));
    assert.strictEqual(document.querySelector('[data-test-panel]'), null, 'the floating panel is not in the DOM until open');
    assert.strictEqual(document.querySelector('.pretui-popup'), null);
  });

  test('mounts the floating panel while open and unmounts it on close', async function (assert) {
    class State {
      @tracked open = true;
    }
    let state = new State();
    await render(
      <template>
        {{! @placement / @distance drive anchorTo's geometry, which this
            harness cannot see (no applied stylesheet); they are passed only
            so the anchoring call runs at all. }}
        <Popup @open={{state.open}} @placement='top-end' @distance={{10}}>
          <:anchor><button type='button' data-test-anchor>Open</button></:anchor>
          <:default><div data-test-panel>panel</div></:default>
        </Popup>
      </template>,
    );
    let panel = document.querySelector('.pretui-popup') as HTMLElement;
    assert.ok(panel.querySelector('[data-test-panel]'));
    assert.true(panel.closest('.pretui-popup-anchor') !== null, 'rendered inside its anchor, not portaled');

    state.open = false;
    await settled();
    assert.strictEqual(document.querySelector('.pretui-popup'), null, 'flipping @open removes the panel; the anchor stays');
    assert.ok(document.querySelector('.pretui-popup-anchor [data-test-anchor]'));
  });
});
