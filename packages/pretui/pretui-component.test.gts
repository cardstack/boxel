// PretUISpec's isolated view: it loads the component's usage page and example
// gallery when it renders, and falls back when there is no page.
import { module, test } from 'qunit';
import { render, waitFor } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PretUISpec } from './pretui-component';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Isolated = PretUISpec.isolated as any;

function specModel(name: string, stage = 'live', tier = 'Element') {
  return { componentName: name, stage, tier, category: 'Actions' };
}

module('Pretui | PretUISpec', function (hooks) {
  setupCardTest(hooks);

  test('renders the usage page and examples it loads', async function (assert) {
    let model = specModel('Button');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="included"] .FreestyleUsage');
    assert.dom('[data-demo-policy="included"] .FreestyleUsage').exists();
    await waitFor('[data-test-pretui-examples]');
    assert.dom('[data-test-pretui-examples]').containsText('Examples');
  });

  test('a page in a shared usage module renders too', async function (assert) {
    let model = specModel('EmailInput');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="included"] .FreestyleUsage');
    assert.dom('[data-demo-policy="included"] .FreestyleUsage').exists();
  });

  test('a component with no usage page says so', async function (assert) {
    let model = specModel('NoSuchComponent');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="missing"]');
    assert
      .dom('[data-demo-policy="missing"]')
      .containsText('No usage page yet');
  });

  test('a Runtime entry without a page is excluded', async function (assert) {
    let model = specModel('UsageString', 'live', 'Runtime');
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-demo-policy="excluded"]').exists();
  });
});
