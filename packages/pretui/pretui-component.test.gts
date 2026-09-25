// PretUISpec's isolated view: it loads the component's usage page and example
// gallery when it renders, and falls back when there is no page.
import { module, test } from 'qunit';
import { render, waitFor, click, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PretUISpec } from './pretui-component';
import { loadDemo, siblingHref } from './demo-locations';
import { PretuiNote } from './pretui-note';

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
    assert.dom('.wb-crumb').containsText('Pretui');
    assert.dom('.wb-crumb button').doesNotExist('no navigation to a card that is not here');
  });

  test('a note adopts from the PretuiNote module in this package, wherever the Spec lives', async function (assert) {
    assert.ok(PretuiNote, 'the note card ships with the package');
    let created: { module: string; name: string }[] = [];
    let context = {
      actions: {
        createCard: (ref: { module: string; name: string }) => {
          created.push(ref);
          return Promise.resolve(undefined);
        },
      },
    };
    let model = {
      ...specModel('Button'),
      id: 'https://example.test/some-catalog/components/button-spec',
    };
    await render(<template><Isolated @model={{model}} @context={{context}} /></template>);
    await click('[data-test-pretui-note-add]');
    let draft = document.querySelector('[data-test-pretui-note-draft]') as HTMLElement;
    let field = (draft.matches('textarea') ? draft : draft.querySelector('textarea')) as HTMLTextAreaElement;
    await fillIn(field, 'Needs a loading state');
    await click('[data-test-pretui-note-save]');
    assert.strictEqual(created.length, 1, 'save creates one note');
    assert.deepEqual(
      created[0],
      { module: siblingHref('./pretui-note'), name: 'PretuiNote' },
      'the note adopts from the package module, not a path beside the Spec instance',
    );
  });
});
