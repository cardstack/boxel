import {
  click,
  fillIn,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { module, test } from 'qunit';

import {
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

module('Acceptance | markdown embed chooser modal', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  const noteId = `${testRealmURL}Note/welcome`;
  const mangoId = `${testRealmURL}Pet/mango`;

  hooks.beforeEach(async function () {
    let { createAndJoinRoom } = mockMatrixUtils;
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    // Realm contents:
    // - `note.gts` defines a Note card with a RichMarkdownField body. The
    //   edit template renders the field, which mounts the CodeMirror editor
    //   + the toolbar we're testing.
    // - `pet.gts` is the card we'll embed via the chooser.
    // - One Note instance ("Welcome") starts empty; one Pet instance
    //   ("Mango") is the row we pick in the chooser.
    await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'note.gts': `
              import { CardDef, Component, contains, field, StringField } from 'https://cardstack.com/base/card-api';
              import { RichMarkdownField } from 'https://cardstack.com/base/rich-markdown';
              export class Note extends CardDef {
                static displayName = 'Note';
                @field title = contains(StringField);
                @field body = contains(RichMarkdownField);
                static isolated = class Isolated extends Component<typeof this> {
                  <template>
                    <div data-test-note-isolated>
                      <h1 data-test-note-title><@fields.title /></h1>
                      <@fields.body />
                    </div>
                  </template>
                };
                static edit = class Edit extends Component<typeof this> {
                  <template>
                    <div data-test-note-edit>
                      <h1 data-test-note-title><@fields.title /></h1>
                      <@fields.body />
                    </div>
                  </template>
                };
              }
            `,
          'pet.gts': `
              import { CardDef, Component, contains, field, StringField } from 'https://cardstack.com/base/card-api';
              export class Pet extends CardDef {
                static displayName = 'Pet';
                @field name = contains(StringField);
                @field cardTitle = contains(StringField, {
                  computeVia: function () {
                    return this.name;
                  },
                });
                static atom = class Atom extends Component<typeof this> {
                  <template>
                    <span data-test-pet-atom>{{@model.name}}</span>
                  </template>
                };
              }
            `,
          'Pet/mango.json': {
            data: {
              attributes: { name: 'Mango', cardTitle: 'Mango' },
              meta: {
                adoptsFrom: { module: '../pet', name: 'Pet' },
              },
            },
          },
          'Note/welcome.json': {
            data: {
              attributes: {
                title: 'Welcome',
                cardTitle: 'Welcome',
                body: { content: '' },
              },
              meta: {
                adoptsFrom: { module: '../note', name: 'Note' },
              },
            },
          },
        },
      }),
    );
  });

  test('opens via the toolbar Add-embed popover and inserts the picked card as a BFM directive', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: noteId,
            format: 'isolated',
          },
        ],
      ],
    });

    // Switch the open card to edit mode so the RichMarkdownField renders
    // its CodeMirror editor (with the toolbar we are exercising).
    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);
    await waitFor(
      `[data-test-stack-card="${noteId}"] [data-test-codemirror-editor]`,
      { timeout: 5000 },
    );
    await waitFor('[data-test-toolbar="add-embed"]', { timeout: 5000 });

    // Open the Add-embed popover and pick the Cards menu item.
    await click('[data-test-toolbar="add-embed"]');
    assert
      .dom('[data-test-toolbar-embed-popover]')
      .exists('popover renders with the two menu items');
    await click('[data-test-toolbar-embed="card"]');

    // The combined chooser modal opens on the Cards tab.
    await waitFor('[data-test-markdown-embed-chooser-modal]', {
      timeout: 5000,
    });
    assert
      .dom('[data-test-markdown-embed-chooser-tab="card"]')
      .hasAttribute('aria-selected', 'true', 'cards tab is the default');

    // Search for Mango, click the row, wait for the pane to unlock, insert.
    await fillIn(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-search-field]',
      'Mango',
    );
    await waitFor(
      `[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-item-button="${mangoId}"]`,
      { timeout: 5000 },
    );
    await click(
      `[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-item-button="${mangoId}"]`,
    );
    await waitFor('[data-test-markdown-embed-preview-cta]:not([disabled])', {
      timeout: 5000,
    });
    await click('[data-test-markdown-embed-preview-cta]');

    await waitUntil(
      () => !document.querySelector('[data-test-markdown-embed-chooser-modal]'),
    );
    await settled();

    // Read the editor's doc directly: the toolbar dispatched a CM change
    // and the source now carries the BFM directive at the cursor position.
    let editorEl = document.querySelector(
      `[data-test-stack-card="${noteId}"] [data-test-codemirror-editor] .cm-editor`,
    ) as HTMLElement | null;
    // @ts-ignore — CodeMirror attaches `cmView` to the editor root.
    let docText = editorEl?.cmView?.view?.state.doc.toString();
    assert.strictEqual(
      docText,
      `:card[${mangoId}]`,
      'source carries the inserted inline atom directive',
    );
  });

  test('cursor inside an existing directive swaps the toolbar to the Edit pencil', async function (assert) {
    // Open the card on the stack, then patch the body content to a pre-
    // existing :card[...] directive so the cursor lands inside it once the
    // editor mounts.
    await visitOperatorMode({
      stacks: [
        [
          {
            id: noteId,
            format: 'isolated',
          },
        ],
      ],
    });
    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);
    await waitFor(
      `[data-test-stack-card="${noteId}"] [data-test-codemirror-editor]`,
      { timeout: 5000 },
    );

    // Inject the directive directly into the CodeMirror view, then drop
    // the cursor inside it.
    let editorEl = document.querySelector(
      `[data-test-stack-card="${noteId}"] [data-test-codemirror-editor] .cm-editor`,
    ) as HTMLElement | null;
    // @ts-ignore — CodeMirror attaches `cmView` to the editor root.
    let view = editorEl?.cmView?.view;
    assert.ok(view, 'codemirror view is reachable');
    view.focus();
    view.dispatch({
      changes: { from: 0, insert: `:card[${mangoId}]` },
    });
    view.dispatch({ selection: { anchor: 3, head: 3 } });

    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });
    assert
      .dom('[data-test-toolbar="edit-embed"]')
      .exists('Edit pencil replaces the Add popover when cursor is inside');

    await click('[data-test-toolbar="edit-embed"]');
    await waitFor('[data-test-markdown-embed-chooser-modal]');
    assert
      .dom('[data-test-markdown-embed-chooser-current]')
      .exists('edit modal opens on the current-target tile');

    // Cancel via the X to leave the source untouched.
    await click('[data-test-close-modal]');
    await waitUntil(
      () => !document.querySelector('[data-test-markdown-embed-chooser-modal]'),
    );
  });
});
