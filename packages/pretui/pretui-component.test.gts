// PretUISpec's isolated view: it loads the component's usage page and example
// gallery when it renders, and falls back when there is no page.
import { module, test } from 'qunit';
import { render, waitFor } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CURRENT_RELEASE, PretUISpec } from './pretui-component';
import { loadDemo } from './demo-locations';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Isolated = PretUISpec.isolated as any;

function specModel(name: string, overrides: Record<string, unknown> = {}) {
  return {
    componentName: name,
    implementationStatus: 'implemented',
    ownership: 'pretui',
    tier: 'Element',
    category: 'Actions',
    ...overrides,
  };
}

module('Pretui | PretUISpec', function (hooks) {
  setupCardTest(hooks);

  test('renders the usage page and examples it loads', async function (assert) {
    let model = specModel('Button');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="included"] [data-test-pretui-usage]');
    assert
      .dom('[data-demo-policy="included"] [data-test-pretui-usage]')
      .exists();
    await waitFor('[data-test-pretui-examples]');
    assert.dom('[data-test-pretui-examples]').containsText('Examples');
  });

  test('a page in a shared usage module renders too', async function (assert) {
    let model = specModel('EmailInput');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="included"] [data-test-pretui-usage]');
    assert
      .dom('[data-demo-policy="included"] [data-test-pretui-usage]')
      .exists();
  });

  test('a component with no usage page says so', async function (assert) {
    let model = specModel('NoSuchComponent');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="missing"]');
    assert
      .dom('[data-demo-policy="missing"]')
      .containsText('No usage page yet');
  });

  test('a planned entry that has a page shows it', async function (assert) {
    let model = specModel('Button', { implementationStatus: 'planned' });
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="included"] [data-test-pretui-usage]');
    assert
      .dom('[data-demo-policy="included"] [data-test-pretui-usage]')
      .exists();
  });

  test('a Runtime entry without a page is excluded', async function (assert) {
    let model = specModel('UsageString', { tier: 'Runtime' });
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-demo-policy="excluded"]').exists();
  });

  test('a host-owned entry without a page is excluded as host chrome', async function (assert) {
    let model = specModel('NoSuchComponent', { ownership: 'host' });
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="excluded"]');
    assert.dom('[data-demo-policy="excluded"]').containsText('Host chrome');
  });

  test('a component introduced in the current release is marked new', async function (assert) {
    let model = specModel('Button', { introducedVersion: CURRENT_RELEASE });
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-test-pretui-new]').exists();
  });

  test('a component from an earlier release is not marked new', async function (assert) {
    let model = specModel('Button', { introducedVersion: '0.0.1' });
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-test-pretui-new]').doesNotExist();
  });

  test('an in-use component shows its version', async function (assert) {
    let model = specModel('Button', {
      adoptionStatus: 'in-use',
      version: '1.2.0',
    });
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-test-pretui-version]').containsText('1.2.0');
    assert
      .dom('[data-test-pretui-status]')
      .hasAttribute('data-tone', 'success');
  });

  test('a component not yet in use shows no version', async function (assert) {
    let model = specModel('Button', {
      adoptionStatus: 'demo-ready',
      version: '1.2.0',
    });
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-test-pretui-version]').doesNotExist();
  });

  test('a deprecated component carries a danger-toned status chip', async function (assert) {
    let model = specModel('Button', { adoptionStatus: 'deprecated' });
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-test-pretui-status]').hasAttribute('data-tone', 'danger');
  });

  test('the status chip names the adoption status, else the implementation status', async function (assert) {
    let adopted = specModel('Button', { adoptionStatus: 'demo-ready' });
    await render(<template><Isolated @model={{adopted}} /></template>);
    assert.dom('[data-test-pretui-status]').hasText('Demo ready');

    let planned = specModel('Button', { implementationStatus: 'planned' });
    await render(<template><Isolated @model={{planned}} /></template>);
    assert.dom('[data-test-pretui-status]').hasText('Planned');

    let unset = specModel('Button', { implementationStatus: undefined });
    await render(<template><Isolated @model={{unset}} /></template>);
    assert.dom('[data-test-pretui-status]').doesNotExist();
  });

  test('each input page loads from its own usage module', async function (assert) {
    for (let name of [
      'OtpInput',
      'TimeInput',
      'Label',
      'CopyButton',
      'Stepper',
      'InputGroup',
      'EmailInput',
      'PhoneInput',
      'NumberInput',
      'PasswordInput',
      'SearchInput',
      'UrlInput',
    ]) {
      assert.ok(await loadDemo({ name }), name);
    }
  });

  test('the breadcrumb names the kit without linking to a catalog card this package does not ship', async function (assert) {
    let model = specModel('Button');
    await render(<template><Isolated @model={{model}} /></template>);
    assert.dom('[data-test-pretui-spec-crumb]').containsText('Pret UI');
    assert
      .dom('[data-test-pretui-spec-crumb] button')
      .doesNotExist('no navigation to a card that is not here');
  });
});
