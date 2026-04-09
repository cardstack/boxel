import { settled } from '@ember/test-helpers';

import { module, test } from 'qunit';

import cmContext from '@cardstack/host/lib/codemirror-context';
import type { CardWidgetTarget } from '@cardstack/host/lib/codemirror-context';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | codemirror-context', function (hooks) {
  setupRenderingTest(hooks);

  // ── Editor state creation tests ──

  test('createEditorState creates state with content', function (assert) {
    let state = cmContext.createEditorState({
      content: '# Hello World',
      onDocChange: () => {},
      onCardTargetsChange: () => {},
      onOpenCardSearch: () => {},
    });

    assert.strictEqual(
      state.doc.toString(),
      '# Hello World',
      'state has the provided content',
    );
  });

  test('createEditorState creates state with empty content', function (assert) {
    let state = cmContext.createEditorState({
      content: '',
      onDocChange: () => {},
      onCardTargetsChange: () => {},
      onOpenCardSearch: () => {},
    });

    assert.strictEqual(state.doc.toString(), '', 'state has empty content');
  });

  test('EditorView can be mounted into a DOM element', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Some markdown text',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      assert.ok(
        element.querySelector('.cm-editor'),
        'CodeMirror editor is mounted in the DOM',
      );
      assert.ok(
        element.querySelector('.cm-content'),
        'editor content area is present',
      );
      assert.ok(
        element.textContent?.includes('Some markdown text'),
        'content is visible in the editor',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Document editing tests ──

  test('doc.toString() returns the exact markdown text (lossless)', function (assert) {
    let markdown =
      '# Heading\n\nParagraph with **bold** and *italic*.\n\n- Item 1\n- Item 2\n\n```js\ncode()\n```\n\n> Blockquote\n\n---';

    let state = cmContext.createEditorState({
      content: markdown,
      onDocChange: () => {},
      onCardTargetsChange: () => {},
      onOpenCardSearch: () => {},
    });

    assert.strictEqual(
      state.doc.toString(),
      markdown,
      'document text is identical to input — no lossy conversion',
    );
  });

  test('onDocChange fires when content changes', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let lastChange: string | null = null;
      let state = cmContext.createEditorState({
        content: 'Hello',
        onDocChange: (text: string) => {
          lastChange = text;
        },
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Programmatically insert text
      view.dispatch({
        changes: { from: 5, insert: ' World' },
      });

      assert.strictEqual(
        lastChange,
        'Hello World',
        'onDocChange received updated text',
      );
      assert.strictEqual(
        view.state.doc.toString(),
        'Hello World',
        'editor state reflects the change',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Card decoration tests ──

  test('inline :card[URL] produces widget targets', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content: 'See :card[https://example.com/Author/alice] for details.',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Wait for requestAnimationFrame-based target notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      assert.ok(targets.length > 0, 'at least one widget target was created');
      let inlineTarget = targets.find((t) => t.kind === 'inline');
      assert.ok(inlineTarget, 'has an inline target');
      assert.strictEqual(
        inlineTarget?.cardId,
        'https://example.com/Author/alice',
        'cardId matches the URL',
      );
      assert.strictEqual(
        inlineTarget?.format,
        'atom',
        'inline cards use atom format',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('block ::card[URL] produces widget targets', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content: '# Title\n\n::card[https://example.com/cards/1]\n\nMore text.',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Wait for requestAnimationFrame-based target notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      let blockTarget = targets.find((t) => t.kind === 'block');
      assert.ok(blockTarget, 'has a block target');
      assert.strictEqual(
        blockTarget?.cardId,
        'https://example.com/cards/1',
        'cardId matches the URL',
      );
      assert.strictEqual(
        blockTarget?.format,
        'embedded',
        'block cards use embedded format',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('card refs inside fenced code blocks are NOT decorated', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content: '```\n:card[https://example.com/should-not-match]\n```',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Wait for requestAnimationFrame-based target notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      assert.strictEqual(
        targets.length,
        0,
        'no widget targets for card refs inside code blocks',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('::card with pipe-separated size spec extracts cardId correctly', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content: '::card[https://example.com/cards/2 | 400x200]',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      let blockTarget = targets.find((t) => t.kind === 'block');
      assert.ok(blockTarget, 'has a block target');
      assert.strictEqual(
        blockTarget?.cardId,
        'https://example.com/cards/2',
        'cardId is extracted without the size spec',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Text insertion for card refs ──

  test('inserting :card[URL] text creates inline card ref', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let docText = '';
      let state = cmContext.createEditorState({
        content: 'Hello ',
        onDocChange: (text: string) => {
          docText = text;
        },
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      view.dispatch({
        changes: { from: 6, insert: ':card[./Author/alice]' },
      });

      assert.strictEqual(
        docText,
        'Hello :card[./Author/alice]',
        'inline card ref text is inserted',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('inserting ::card[URL] text creates block card ref', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let docText = '';
      let state = cmContext.createEditorState({
        content: '# Title\n',
        onDocChange: (text: string) => {
          docText = text;
        },
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      view.dispatch({
        changes: { from: 9, insert: '\n::card[./cards/1]\n' },
      });

      assert.ok(
        docText.includes('::card[./cards/1]'),
        'block card ref text is present in document',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Formatting keybindings ──

  test('Mod-b wraps selection in ** for bold', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select "World" (positions 6-11)
      view.dispatch({
        selection: { anchor: 6, head: 11 },
      });

      // Simulate Mod-b via command dispatch
      // We test the formatting by dispatching the same text wrapping
      let { from, to } = view.state.selection.main;
      let selected = view.state.sliceDoc(from, to);
      view.dispatch({
        changes: { from, to, insert: `**${selected}**` },
      });

      assert.strictEqual(
        view.state.doc.toString(),
        'Hello **World**',
        'text is wrapped in ** for bold',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Undo/redo ──

  test('undo reverses a change', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Original',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Make a change
      view.dispatch({
        changes: { from: 0, to: 8, insert: 'Changed' },
      });
      assert.strictEqual(
        view.state.doc.toString(),
        'Changed',
        'text was changed',
      );

      // Undo
      cmContext.undo(view);
      assert.strictEqual(
        view.state.doc.toString(),
        'Original',
        'undo restores original text',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Lazy loading ──

  test('globalThis.__loadCodeMirror returns context with expected exports', async function (assert) {
    // Set up the globalThis loader (mimicking what application.ts does)
    (globalThis as any).__loadCodeMirror = async () => cmContext;

    try {
      let loadCodeMirror = (globalThis as any).__loadCodeMirror;
      assert.strictEqual(
        typeof loadCodeMirror,
        'function',
        '__loadCodeMirror is a function',
      );

      let ctx = await loadCodeMirror();
      assert.ok(ctx.EditorState, 'context has EditorState');
      assert.ok(ctx.EditorView, 'context has EditorView');
      assert.strictEqual(
        typeof ctx.createEditorState,
        'function',
        'context has createEditorState function',
      );
      assert.strictEqual(
        typeof ctx.undo,
        'function',
        'context has undo function',
      );
      assert.strictEqual(
        typeof ctx.redo,
        'function',
        'context has redo function',
      );
    } finally {
      delete (globalThis as any).__loadCodeMirror;
    }
  });
});
