// Pretui — AgentMark unit tests.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
// No assertion touches a computed style: the component's own `<style scoped>`
// is inert in this harness (the scoped-css attribute is stamped, the rules
// are not applied).
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { AgentMark } from './agent-mark';

function root(): HTMLElement {
  return document.querySelector('[data-test-pretui-agent-mark]') as HTMLElement;
}

module('Pretui | components/agent-mark', function (hooks) {
  setupCardTest(hooks);

  test('is a decorative mark sized in rem from a px argument', async function (assert) {
    await render(<template><AgentMark /></template>);
    assert.strictEqual(root().getAttribute('aria-hidden'), 'true');
    assert.strictEqual(root().getAttribute('data-test-pretui-agent-mark'), 'settled');
    assert.strictEqual(root().style.getPropertyValue('--pretui-agent-mark-size'), '1rem');

    await render(<template><AgentMark @size={{24}} @working={{true}} /></template>);
    assert.strictEqual(root().getAttribute('data-test-pretui-agent-mark'), 'working');
    assert.strictEqual(root().style.getPropertyValue('--pretui-agent-mark-size'), '1.5rem');
  });
});
