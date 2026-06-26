import { precompileTemplate } from '@ember/template-compilation';
import {
  type RenderingTestContext,
  click,
  fillIn,
  render,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { provide } from 'ember-provide-consume-context';

import { module, test } from 'qunit';

import {
  baseRealm,
  CardContextName,
  GetCardContextName,
  GetCardCollectionContextName,
  GetCardsContextName,
} from '@cardstack/runtime-common';

import MarkdownEmbedChooserModal from '@cardstack/host/components/markdown-embed-chooser/modal';
import cmContext from '@cardstack/host/lib/codemirror-context';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type LoaderService from '@cardstack/host/services/loader-service';
import type StoreService from '@cardstack/host/services/store';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../../helpers';
import {
  CardDef,
  StringField,
  contains,
  field,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

// The mini choosers + card resources consume host context via @consume.
class HostContextProvider extends GlimmerComponent<{
  Blocks: { default: [] };
}> {
  @provide(GetCardContextName)
  get getCardFn() {
    return getCard;
  }
  @provide(GetCardsContextName)
  get getCardsFn() {
    let store = getService('store') as StoreService;
    return store.getSearchResource.bind(store);
  }
  @provide(GetCardCollectionContextName)
  get getCardCollectionFn() {
    return getCardCollection;
  }
  @provide(CardContextName)
  get cardContext() {
    return {};
  }
  <template>
    {{! template-lint-disable no-yield-only }}
    {{yield}}
  </template>
}

// Tracked content harness so the editor's onUpdate updates the same
// `@content` arg we read for assertions.
class ContentHarness {
  @tracked content = '';
  set = (text: string) => {
    this.content = text;
  };
}

async function loadCodeMirrorEditor() {
  let loader = (getService('loader-service') as LoaderService).loader;
  let mod = (await loader.import(
    'https://cardstack.com/base/codemirror-editor',
  )) as { default: unknown };
  return mod.default as any;
}

async function renderEditorAndModal(opts: {
  CodeMirrorEditor: any;
  harness: ContentHarness;
}) {
  // Static `<template>` in this file can't reference a runtime-loaded
  // component, so build the layout with precompileTemplate and inject
  // CodeMirrorEditor through the scope. The modal is a regular host
  // component import so it can live alongside in static scope.
  let { CodeMirrorEditor, harness } = opts;
  await render(
    precompileTemplate(
      `
      <HostContextProvider>
        <MarkdownEmbedChooserModal />
        <div class="editor-sized">
          <CodeMirrorEditor
            @content={{harness.content}}
            @onUpdate={{harness.set}}
          />
        </div>
      </HostContextProvider>
      <style>
        .editor-sized {
          width: 600px;
          height: 240px;
        }
      </style>
    `,
      {
        strictMode: true,
        scope: () => ({
          HostContextProvider,
          MarkdownEmbedChooserModal,
          CodeMirrorEditor,
          harness,
        }),
      },
    ),
  );
}

module('Integration | codemirror embed toolbar', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  // The base codemirror-editor lazy-loads its host-side CodeMirror context
  // via `globalThis.__loadCodeMirror`. Wire it to the real context so the
  // editor mounts (instead of the loading placeholder).
  hooks.beforeEach(function () {
    (globalThis as any).__loadCodeMirror = async () => cmContext;
  });
  hooks.afterEach(function () {
    delete (globalThis as any).__loadCodeMirror;
  });

  let CodeMirrorEditor: any;

  hooks.beforeEach(async function () {
    CodeMirrorEditor = await loadCodeMirrorEditor();
  });

  const mango = `${testRealmURL}books/mango`;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Book extends CardDef {
      static displayName = 'Book';
      @field title = contains(StringField);
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealmURL,
      contents: {
        'book.gts': { Book },
        'books/mango.json': new Book({ title: 'Mango' }),
      },
    });
    await getService('realm').login(testRealmURL);
  });

  test('toolbar shows Add-embed by default; popover opens Cards/Files items', async function (assert) {
    let harness = new ContentHarness();
    await renderEditorAndModal({ CodeMirrorEditor, harness });

    await waitFor('[data-test-codemirror-editor]', { timeout: 5000 });
    await waitFor('[data-test-toolbar="add-embed"]', { timeout: 5000 });
    assert
      .dom('[data-test-toolbar="add-embed"]')
      .exists('Add embed lives in the toolbar when no directive is focused');
    assert
      .dom('[data-test-toolbar-embed-popover]')
      .doesNotExist('popover is closed by default');

    await click('[data-test-toolbar="add-embed"]');
    assert.dom('[data-test-toolbar-embed-popover]').exists();
    assert
      .dom('[data-test-toolbar-embed="card"]')
      .hasText('Add a card', 'first menu item targets the Cards tab');
    assert
      .dom('[data-test-toolbar-embed="file"]')
      .hasText('Add a file', 'second menu item targets the Files tab');
  });

  test('picking a card from the popover inserts `:card[URL]` at the cursor', async function (assert) {
    let harness = new ContentHarness();
    await renderEditorAndModal({ CodeMirrorEditor, harness });

    await waitFor('[data-test-toolbar="add-embed"]', { timeout: 5000 });
    await click('[data-test-toolbar="add-embed"]');
    await click('[data-test-toolbar-embed="card"]');

    await waitFor('[data-test-markdown-embed-chooser-modal]');
    await fillIn(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-search-field]',
      'Mango',
    );
    await waitFor(
      `[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-item-button="${mango}"]`,
      { timeout: 5000 },
    );
    await click(
      `[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-item-button="${mango}"]`,
    );

    await waitFor('[data-test-markdown-embed-preview-cta]:not([disabled])', {
      timeout: 5000,
    });
    await click('[data-test-markdown-embed-preview-cta]');

    await waitUntil(
      () => !document.querySelector('[data-test-markdown-embed-chooser-modal]'),
    );
    await settled();
    assert.strictEqual(
      harness.content,
      `:card[${mango}]`,
      'editor content carries the inserted BFM directive',
    );
  });

  test('cursor over a directive swaps the toolbar to Edit; Remove deletes the ref', async function (assert) {
    let harness = new ContentHarness();
    harness.content = `:card[${mango}]`;
    await renderEditorAndModal({ CodeMirrorEditor, harness });

    await waitFor('[data-test-codemirror-editor] .cm-content', {
      timeout: 5000,
    });

    // Drop the cursor inside the directive by dispatching against the
    // CodeMirror view (the contenteditable .cm-content sits on the view).
    let editor = document.querySelector(
      '[data-test-codemirror-editor] .cm-editor',
    ) as HTMLElement | null;
    // @ts-ignore — `cmView` is attached by CodeMirror to the editor root.
    let view = editor?.cmView?.view;
    view?.focus();
    view?.dispatch({ selection: { anchor: 3, head: 3 } });

    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });
    assert
      .dom('[data-test-toolbar="edit-embed"]')
      .exists(
        'Edit pencil replaces the Add popover when the cursor is inside a directive',
      );

    await click('[data-test-toolbar="edit-embed"]');
    await waitFor('[data-test-markdown-embed-chooser-modal]');
    assert
      .dom('[data-test-markdown-embed-chooser-current]')
      .exists('edit modal opens with the current-target tile');

    await click('[data-test-markdown-embed-chooser-remove]');
    await waitUntil(
      () => !document.querySelector('[data-test-markdown-embed-chooser-modal]'),
    );
    await settled();
    assert.strictEqual(
      harness.content,
      '',
      'Remove deletes the directive from the source',
    );
  });
});
