import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { module, test } from 'qunit';

import cmContext from '@cardstack/host/lib/codemirror-context';

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

// CS-12111: an embed inserted into a Rich Markdown field previews correctly in
// the compose (edit) view, but after saving, the containing card's isolated
// view showed the embed as a broken link. The compose view resolves refs via a
// live `getCards` search; the saved isolated view resolves only through the
// query-backed `linkedCards` / `linkedFiles` relationships. This suite drives
// the real edit -> insert -> save -> isolated flow so the embed must resolve in
// isolated the same way it did in compose.
module('Acceptance | markdown embed save then isolated', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  const noteId = `${testRealmURL}Note/welcome`;

  hooks.beforeEach(async function () {
    let { createAndJoinRoom } = mockMatrixUtils;
    createAndJoinRoom({ sender: '@testuser:localhost', name: 'room-test' });
    setupUserSubscription();
    setupAuthEndpoints();

    await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'note.gts': `
            import { CardDef, Component, contains, field, StringField } from '@cardstack/base/card-api';
            import { RichMarkdownField } from '@cardstack/base/rich-markdown';
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
            import { CardDef, Component, contains, field, StringField } from '@cardstack/base/card-api';
            export class Pet extends CardDef {
              static displayName = 'Pet';
              @field name = contains(StringField);
              @field cardTitle = contains(StringField, {
                computeVia: function () {
                  return this.name;
                },
              });
              static atom = class Atom extends Component {
                <template>
                  <span data-test-pet-atom>{{@model.name}}</span>
                </template>
              };
              static embedded = class Embedded extends Component {
                <template>
                  <span data-test-pet-embedded>{{@model.name}}</span>
                </template>
              };
            }
          `,
          'Pet/mango.json': {
            data: {
              attributes: { name: 'Mango', cardTitle: 'Mango' },
              meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
            },
          },
          'documents/notes.txt': 'These are project notes.',
          'Note/welcome.json': {
            data: {
              attributes: {
                title: 'Welcome',
                cardTitle: 'Welcome',
                body: { content: '' },
              },
              meta: { adoptsFrom: { module: '../note', name: 'Note' } },
            },
          },
        },
      }),
    );
  });

  // Insert `source` into the mounted CodeMirror editor for the open Note, then
  // toggle back to isolated. Toggling tears down the editor, which flushes the
  // debounced save — the same save the app performs — so the isolated render
  // reads the freshly-saved (and reindexed) body.
  async function insertDirectiveThenViewIsolated(source: string) {
    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);
    await waitFor(
      `[data-test-stack-card="${noteId}"] [data-test-codemirror-editor]`,
      { timeout: 5000 },
    );
    let editorEl = document.querySelector(
      `[data-test-stack-card="${noteId}"] [data-test-codemirror-editor] .cm-editor`,
    ) as HTMLElement | null;
    let view = editorEl ? cmContext.EditorView.findFromDOM(editorEl) : null;
    view!.focus();
    view!.dispatch({ changes: { from: 0, insert: source } });
    await settled();
    // Toggle back to isolated (flushes the pending save on editor teardown).
    await click(`[data-test-operator-mode-stack="0"] [data-test-edit-button]`);
    await waitUntil(
      () =>
        !document.querySelector(
          `[data-test-stack-card="${noteId}"] [data-test-codemirror-editor]`,
        ),
      { timeout: 5000 },
    );
    await settled();
  }

  test('a just-inserted card embed resolves in the isolated view after save', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: noteId, format: 'isolated' }]],
    });

    await insertDirectiveThenViewIsolated(`:card[../Pet/mango]`);

    await waitFor(`[data-test-stack-card="${noteId}"] [data-test-pet-atom]`, {
      timeout: 5000,
    });
    assert
      .dom(`[data-test-stack-card="${noteId}"] [data-test-pet-atom]`)
      .hasText('Mango', 'the embedded card resolves in the isolated view');
    assert
      .dom(
        `[data-test-stack-card="${noteId}"] [data-test-markdown-bfm-unresolved-inline]`,
      )
      .doesNotExist('the embed is not rendered as a broken link');
  });

  test('a just-inserted file embed resolves in the isolated view after save', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: noteId, format: 'isolated' }]],
    });

    await insertDirectiveThenViewIsolated(`:file[../documents/notes.txt]`);

    await waitFor(
      `[data-test-stack-card="${noteId}"] [data-test-markdown-bfm-inline-file]`,
      { timeout: 5000 },
    );
    assert
      .dom(
        `[data-test-stack-card="${noteId}"] [data-test-markdown-bfm-inline-file]`,
      )
      .exists('the embedded file resolves in the isolated view');
    assert
      .dom(
        `[data-test-stack-card="${noteId}"] [data-test-markdown-bfm-unresolved-inline]`,
      )
      .doesNotExist('the file embed is not rendered as a broken link');
  });
});
