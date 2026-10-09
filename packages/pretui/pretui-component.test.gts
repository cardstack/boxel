// PretUISpec's isolated view: it loads the component's usage page and example
// gallery when it renders, and falls back when there is no page.
import { module, test } from 'qunit';
import { render, waitFor, click, fillIn } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { PretUISpec } from './pretui-component';
import { loadDemo, siblingHref } from './demo-locations';
import { PretuiNote } from './pretui-note';
import { realmURL } from 'https://cardstack.com/base/card-api';

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
    await waitFor('[data-demo-policy="included"] [data-test-pretui-usage]');
    assert.dom('[data-demo-policy="included"] [data-test-pretui-usage]').exists();
    await waitFor('[data-test-pretui-examples]');
    assert.dom('[data-test-pretui-examples]').containsText('Examples');
  });

  test('a page in a shared usage module renders too', async function (assert) {
    let model = specModel('EmailInput');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="included"] [data-test-pretui-usage]');
    assert.dom('[data-demo-policy="included"] [data-test-pretui-usage]').exists();
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
    let model = specModel('Button', 'planned');
    await render(<template><Isolated @model={{model}} /></template>);
    await waitFor('[data-demo-policy="included"] [data-test-pretui-usage]');
    assert.dom('[data-demo-policy="included"] [data-test-pretui-usage]').exists();
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
    assert.dom('[data-test-pretui-spec-crumb]').containsText('Pret UI');
    assert.dom('[data-test-pretui-spec-crumb] button').doesNotExist('no navigation to a card that is not here');
  });

  test('a note adopts from the PretuiNote module in this package, wherever the Spec lives', async function (assert) {
    assert.ok(PretuiNote, 'the note card ships with the package');
    let created: { module: string; name: string }[] = [];
    let createdIn: URL[] = [];
    let context = {
      actions: {
        createCard: (ref: { module: string; name: string }, realm: URL) => {
          created.push(ref);
          createdIn.push(realm);
          return Promise.resolve(undefined);
        },
      },
    };
    // a prefix-form id is not a URL base, so the realm must come from the card
    let model = {
      ...specModel('Button'),
      id: '@cardstack/catalog/Spec/pretui-button',
      [realmURL]: new URL('https://example.test/some-catalog/'),
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
    assert.strictEqual(createdIn[0]?.href, 'https://example.test/some-catalog/', "the note is created in the Spec's realm");
  });

  test('notes are found and opened by their prefix-form ids', async function (assert) {
    let searchedIn: string[] = [];
    let viewed: unknown[] = [];
    let noteId = '@cardstack/catalog/PretuiNote/sample-note';
    let context = {
      getCards: (_parent: unknown, _query: unknown, realms: () => string[] | undefined) => {
        searchedIn.push(...(realms() ?? []));
        return { instances: [{ id: noteId, note: 'Tighten the hit area', status: 'open' }] };
      },
    };
    let viewCard = (card: unknown) => viewed.push(card);
    let model = {
      ...specModel('Button'),
      id: '@cardstack/catalog/Spec/pretui-button',
      [realmURL]: new URL('https://example.test/some-catalog/'),
    };
    await render(<template><Isolated @model={{model}} @context={{context}} @viewCard={{viewCard}} /></template>);
    assert.deepEqual(searchedIn, ['https://example.test/some-catalog/'], "notes are searched in the Spec's realm");
    await click('[data-test-pretui-note]');
    assert.deepEqual(viewed, [noteId], 'the note opens by its id as given');
  });
});
