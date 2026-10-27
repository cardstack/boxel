// Pretui — ContextRing unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ContextRing } from './context-ring';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-context-ring]') as HTMLElement;
}

module('Pretui | components/context-ring', function (hooks) {
  setupCardTest(hooks);

  test('names how full the context is, in words and counts', async function (assert) {
    await render(<template><ContextRing @used={{52000}} @limit={{200000}} /></template>);
    assert.strictEqual(root().getAttribute('role'), 'img');
    assert.strictEqual(root().getAttribute('aria-label'), 'Context 26% used: 52k of 200k tokens');
    assert.strictEqual(root().getAttribute('title'), root().getAttribute('aria-label'), 'the tooltip says the same');
    assert.strictEqual(root().dataset['warn'], undefined);
  });

  test('past the warning share it says "nearly full" in its name, not only in its colour', async function (assert) {
    await render(<template><ContextRing @used={{170000}} @limit={{200000}} @compact={{true}} /></template>);
    assert.strictEqual(root().dataset['warn'], 'true');
    assert.strictEqual(root().getAttribute('aria-label'), 'Context 85% used, nearly full: 170k of 200k tokens');
    assert.strictEqual(root().getAttribute('title'), root().getAttribute('aria-label'), 'compact mode keeps the warning in the tooltip');

    await render(<template><ContextRing @used={{60}} @limit={{100}} @warnAt={{0.5}} /></template>);
    assert.strictEqual(root().getAttribute('aria-label'), 'Context 60% used, nearly full: 60 of 100 tokens', '@warnAt moves the threshold');
  });
});
