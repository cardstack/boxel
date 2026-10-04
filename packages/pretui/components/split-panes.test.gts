// Pretui — SplitPanes unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { SplitPanes } from './split-panes';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-split-panes]') as HTMLElement;
}

module('Pretui | components/split-panes', function (hooks) {
  setupCardTest(hooks);

  test('wraps boxel-ui ResizablePanelGroup horizontally by default and yields Panel and Handle', async function (assert) {
    await render(
      <template>
        <SplitPanes as |Panel Handle|>
          <Panel @defaultSize={{30}} @minSize={{20}}><div data-test-left>nav</div></Panel>
          <Handle />
          <Panel @defaultSize={{70}}><div data-test-right>body</div></Panel>
        </SplitPanes>
      </template>,
    );
    assert.strictEqual(root().dataset['orientation'], 'horizontal');
    assert.ok(root().querySelector('[data-test-left]'));
    assert.ok(root().querySelector('[data-test-right]'));
    // `[aria-label="Resize handle"]`, `[data-test-resize-handle]` and
    // `.resize-handle.vertical` are boxel-ui's own DOM: a boxel-ui version bump
    // can redden these two tests for a change pretui did not make. They are
    // kept because they are the only outside evidence that orientation reached
    // the engine.
    let handle = root().querySelector('[aria-label="Resize handle"]') as HTMLElement;
    assert.ok(handle, 'the engine handle is a named control');
    assert.ok(root().querySelector('[data-test-resize-handle]'));
  });

  test('forwards a vertical orientation', async function (assert) {
    await render(
      <template>
        <SplitPanes @orientation='vertical' as |Panel Handle|>
          <Panel @defaultSize={{50}}>a</Panel>
          <Handle />
          <Panel @defaultSize={{50}}>b</Panel>
        </SplitPanes>
      </template>,
    );
    assert.strictEqual(root().dataset['orientation'], 'vertical');
    assert.ok(root().querySelector('.resize-handle.vertical'), 'the engine paints the handle for that axis');
  });
});
