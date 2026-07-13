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
import type MarkdownEmbedChooserService from '@cardstack/host/services/markdown-embed-chooser';
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
// `@content` arg we read for assertions. `calls` counts onUpdate invocations
// so a test can prove a single edit doesn't save twice.
class ContentHarness {
  @tracked content = '';
  calls = 0;
  set = (text: string) => {
    this.calls += 1;
    this.content = text;
  };
}

// The editor debounces saves by SAVE_DEBOUNCE_MS (500ms); a raw setTimeout is
// not tracked by `settled()`, so wait it out explicitly to catch a stray
// debounced save firing after the immediate one.
const SAVE_DEBOUNCE_MS = 500;
function waitOutDebounce() {
  return new Promise((resolve) => setTimeout(resolve, SAVE_DEBOUNCE_MS + 200));
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
  // The editing document's own URL. When set, document-relative refs in the
  // body (`../books/mango`) resolve against it — matching the live editor.
  cardReferenceBaseUrl?: string;
}) {
  // Static `<template>` in this file can't reference a runtime-loaded
  // component, so build the layout with precompileTemplate and inject
  // CodeMirrorEditor through the scope. The modal is a regular host
  // component import so it can live alongside in static scope.
  let { CodeMirrorEditor, harness, cardReferenceBaseUrl } = opts;
  await render(
    precompileTemplate(
      `
      <HostContextProvider>
        <MarkdownEmbedChooserModal />
        <div class="editor-sized">
          <CodeMirrorEditor
            @content={{harness.content}}
            @onUpdate={{harness.set}}
            @cardReferenceBaseUrl={{cardReferenceBaseUrl}}
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
          cardReferenceBaseUrl,
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
  // Same URL length as mango so an in-place swap leaves the directive's
  // from/to unchanged — the exact case `sameToolbarState` must not dedupe away.
  const manga = `${testRealmURL}books/manga`;

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
        'books/manga.json': new Book({ title: 'Manga' }),
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
    // CodeMirror view. `EditorView.findFromDOM` walks up from any node
    // under the editor; the cmContext exposes the constructor.
    let editor = document.querySelector(
      '[data-test-codemirror-editor] .cm-editor',
    ) as HTMLElement | null;
    let view = editor ? cmContext.EditorView.findFromDOM(editor) : null;
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

  // A stray lone backtick (here in `Mod-\``) must not pair — across a blank
  // line — with the backtick fence below: that would form a spurious
  // inline-code region hiding every directive in between, leaving their
  // toolbar stuck on "+". The caret in each embed must show the Edit pencil.
  test('caret inside a directive after a lone backtick still swaps to Edit', async function (assert) {
    let harness = new ContentHarness();
    let content = [
      '- Keyboard shortcuts (Mod-`)',
      '',
      `Inline card reference: :card[${mango}]`,
      '',
      `::card[${mango}]`,
      '',
      '```typescript',
      'let greeting = "hi";',
      '```',
    ].join('\n');
    harness.content = content;
    await renderEditorAndModal({ CodeMirrorEditor, harness });

    await waitFor('[data-test-codemirror-editor] .cm-content', {
      timeout: 5000,
    });

    let editor = document.querySelector(
      '[data-test-codemirror-editor] .cm-editor',
    ) as HTMLElement | null;
    let view = editor ? cmContext.EditorView.findFromDOM(editor) : null;
    view?.focus();

    let inlineStart = content.indexOf(`:card[${mango}]`);
    let blockStart = content.indexOf(`::card[${mango}]`);

    let placeCaret = async (head: number) => {
      view?.dispatch({ selection: { anchor: head, head } });
      await settled();
    };

    // Start of the inline directive.
    await placeCaret(inlineStart);
    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });
    assert
      .dom('[data-test-toolbar="edit-embed"]')
      .exists('Edit pencil at the start of the 2nd (inline) embed');
    assert.dom('[data-test-toolbar="add-embed"]').doesNotExist();

    // Mid-URL of the inline directive.
    await placeCaret(inlineStart + ':card['.length + 5);
    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });
    assert
      .dom('[data-test-toolbar="edit-embed"]')
      .exists('Edit pencil mid-URL of the 2nd (inline) embed');

    // Mid-URL of the block directive.
    await placeCaret(blockStart + '::card['.length + 5);
    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });
    assert
      .dom('[data-test-toolbar="edit-embed"]')
      .exists('Edit pencil mid-URL of the 3rd (block) embed');
    assert.dom('[data-test-toolbar="add-embed"]').doesNotExist();

    // Caret in prose between embeds falls back to the Add popover.
    await placeCaret(content.indexOf('Inline card reference') + 3);
    await waitFor('[data-test-toolbar="add-embed"]', { timeout: 5000 });
    assert
      .dom('[data-test-toolbar="add-embed"]')
      .exists('caret in prose shows the Add button, not the pencil');
    assert.dom('[data-test-toolbar="edit-embed"]').doesNotExist();
  });

  test('Remove saves exactly once (no duplicate debounced save)', async function (assert) {
    let harness = new ContentHarness();
    harness.content = `:card[${mango}]`;
    await renderEditorAndModal({ CodeMirrorEditor, harness });

    await waitFor('[data-test-codemirror-editor] .cm-content', {
      timeout: 5000,
    });
    let editor = document.querySelector(
      '[data-test-codemirror-editor] .cm-editor',
    ) as HTMLElement | null;
    let view = editor ? cmContext.EditorView.findFromDOM(editor) : null;
    view?.focus();
    view?.dispatch({ selection: { anchor: 3, head: 3 } });

    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });
    await click('[data-test-toolbar="edit-embed"]');
    await waitFor('[data-test-markdown-embed-chooser-modal]');
    await click('[data-test-markdown-embed-chooser-remove]');
    await waitUntil(
      () => !document.querySelector('[data-test-markdown-embed-chooser-modal]'),
    );
    await settled();

    assert.strictEqual(harness.calls, 1, 'the delete saved immediately, once');
    await waitOutDebounce();
    assert.strictEqual(
      harness.calls,
      1,
      'no second save fires after the debounce window',
    );
  });

  test('Accepting an edit saves exactly once (no duplicate debounced save)', async function (assert) {
    let harness = new ContentHarness();
    harness.content = `:card[${mango}]`;
    await renderEditorAndModal({ CodeMirrorEditor, harness });

    await waitFor('[data-test-codemirror-editor] .cm-content', {
      timeout: 5000,
    });
    let editor = document.querySelector(
      '[data-test-codemirror-editor] .cm-editor',
    ) as HTMLElement | null;
    let view = editor ? cmContext.EditorView.findFromDOM(editor) : null;
    view?.focus();
    view?.dispatch({ selection: { anchor: 3, head: 3 } });

    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });
    await click('[data-test-toolbar="edit-embed"]');
    await waitFor('[data-test-markdown-embed-chooser-modal]');

    // Change the format so the CTA becomes ACCEPT, then accept the edit — this
    // routes through `_replaceRange`, which must also cancel the debounce.
    await click('[data-test-markdown-embed-preview-format-select]');
    await waitFor('.ember-power-select-option', { timeout: 3000 });
    await click('[data-test-format-option="embedded"]');
    await click('[data-test-markdown-embed-preview-cta]');
    await waitUntil(
      () => !document.querySelector('[data-test-markdown-embed-chooser-modal]'),
    );
    await settled();

    assert.strictEqual(
      harness.content,
      `::card[${mango} | embedded]`,
      'the edit replaced the directive in place',
    );
    assert.strictEqual(harness.calls, 1, 'the replace saved immediately, once');
    await waitOutDebounce();
    assert.strictEqual(
      harness.calls,
      1,
      'no second save fires after the debounce window',
    );
  });

  test('an in-place URL edit refreshes the directive the pencil acts on', async function (assert) {
    let content = `:card[${mango}]`;
    let harness = new ContentHarness();
    harness.content = content;
    await renderEditorAndModal({ CodeMirrorEditor, harness });

    await waitFor('[data-test-codemirror-editor] .cm-content', {
      timeout: 5000,
    });
    let editor = document.querySelector(
      '[data-test-codemirror-editor] .cm-editor',
    ) as HTMLElement | null;
    let view = editor ? cmContext.EditorView.findFromDOM(editor) : null;
    view?.focus();
    view?.dispatch({ selection: { anchor: 3, head: 3 } });
    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });

    // Rewrite the URL's last character in place (mango → manga) without moving
    // the cursor. The directive keeps the same from/to, so a from/to-only
    // comparison would keep targeting the stale URL.
    let oPos = content.lastIndexOf('mango') + 'mango'.length - 1;
    view?.dispatch({ changes: { from: oPos, to: oPos + 1, insert: 'a' } });
    await settled();

    // (sanity) the editor's live document holds the new URL. Read the view
    // directly rather than `harness.content`, which only updates on the
    // debounced onUpdate that hasn't fired yet.
    assert.strictEqual(view?.state.doc.toString(), `:card[${manga}]`);

    await click('[data-test-toolbar="edit-embed"]');
    await waitFor('[data-test-markdown-embed-chooser-modal]', {
      timeout: 5000,
    });

    // The pencil opens the chooser against the URL currently under the cursor.
    // Asserting on the request (rather than the rendered title, which is the
    // same placeholder for both fixture cards) isolates the toolbar-state
    // refresh: before the fix it would still target the stale `mango`.
    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    assert.strictEqual(
      svc.currentRequest?.initialTarget?.url,
      manga,
      'the pencil edits the freshly-typed URL, not the stale one',
    );
    svc.resolve(undefined);
    await settled();
  });

  test('the pencil resolves a document-relative ref so the preview loads (not a blank pane)', async function (assert) {
    // The body stores refs relative to the editing document; the chooser loads
    // its preview through `store.get`, which needs the canonical absolute URL.
    // A verbatim `../books/mango` would fail to resolve and the pane would show
    // nothing — the pencil must resolve it against the document base first.
    let docUrl = `${testRealmURL}experiments/playground`;
    let harness = new ContentHarness();
    harness.content = `:card[../books/mango]`;
    await renderEditorAndModal({
      CodeMirrorEditor,
      harness,
      cardReferenceBaseUrl: docUrl,
    });

    await waitFor('[data-test-codemirror-editor] .cm-content', {
      timeout: 5000,
    });
    let editor = document.querySelector(
      '[data-test-codemirror-editor] .cm-editor',
    ) as HTMLElement | null;
    let view = editor ? cmContext.EditorView.findFromDOM(editor) : null;
    view?.focus();
    // Drop the caret inside the relative URL (`:card[` is 6 chars).
    view?.dispatch({ selection: { anchor: 8, head: 8 } });
    await waitFor('[data-test-toolbar="edit-embed"]', { timeout: 5000 });

    await click('[data-test-toolbar="edit-embed"]');
    await waitFor('[data-test-markdown-embed-chooser-modal]', {
      timeout: 5000,
    });

    let svc = getService(
      'markdown-embed-chooser',
    ) as MarkdownEmbedChooserService;
    assert.strictEqual(
      svc.currentRequest?.initialTarget?.url,
      mango,
      'the relative ref resolves to its absolute URL before the chooser loads it',
    );

    // The resolved card actually renders its embed preview — the regression was
    // a blank pane because the unresolved relative URL never loaded.
    await waitFor(
      '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview]',
      { timeout: 5000 },
    );
    assert
      .dom(
        '[data-test-markdown-embed-chooser-tab-panel="card"] [data-test-markdown-embed-preview]',
      )
      .exists('the resolved card renders its preview in edit mode');

    svc.resolve(undefined);
    await settled();
  });
});
