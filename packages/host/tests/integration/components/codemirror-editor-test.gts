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
        // Card ref is on line 3 so the cursor (at pos 0, line 1) doesn't
        // suppress the replace widget via cursor-aware decoration logic.
        content:
          'Some intro text\n\nSee :card[https://example.com/Author/alice] for details.',
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
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
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
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
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

  test('inline :file[URL] produces a file widget target', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content:
          'Some intro text\n\nSee :file[https://example.com/docs/report.pdf] for details.',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({ state, parent: element });

      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      let inlineTarget = targets.find((t) => t.kind === 'inline');
      assert.ok(inlineTarget, 'has an inline target');
      assert.strictEqual(
        inlineTarget?.cardId,
        'https://example.com/docs/report.pdf',
        'cardId matches the file URL',
      );
      assert.strictEqual(
        inlineTarget?.refType,
        'file',
        'file ref carries refType "file"',
      );
      assert.strictEqual(
        inlineTarget?.format,
        'atom',
        'inline files use atom format',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('block ::file[URL] produces a file widget target', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content:
          '# Title\n\n::file[https://example.com/data/sample.csv]\n\nMore text.',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({ state, parent: element });

      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      let blockTarget = targets.find((t) => t.kind === 'block');
      assert.ok(blockTarget, 'has a block target');
      assert.strictEqual(
        blockTarget?.cardId,
        'https://example.com/data/sample.csv',
        'cardId matches the file URL',
      );
      assert.strictEqual(
        blockTarget?.refType,
        'file',
        'file ref carries refType "file"',
      );
      assert.strictEqual(
        blockTarget?.format,
        'embedded',
        'block files use embedded format',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('card and file refs coexist with distinct refTypes', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content:
          'Card: :card[https://example.com/Author/alice]\n\nFile: :file[https://example.com/docs/report.pdf]',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({ state, parent: element });

      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      let cardTarget = targets.find(
        (t) => t.cardId === 'https://example.com/Author/alice',
      );
      let fileTarget = targets.find(
        (t) => t.cardId === 'https://example.com/docs/report.pdf',
      );
      assert.strictEqual(
        cardTarget?.refType,
        'card',
        'card ref → refType card',
      );
      assert.strictEqual(
        fileTarget?.refType,
        'file',
        'file ref → refType file',
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
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
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
        content: 'Some text\n\n::card[https://example.com/cards/2 | 400x200]',
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

      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
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

  // ── BFM format/size threading (CS-12112) ──

  async function collectTargets(content: string): Promise<{
    targets: CardWidgetTarget[];
    element: HTMLElement;
    destroy: () => void;
  }> {
    let element = document.createElement('div');
    document.body.appendChild(element);
    let targets: CardWidgetTarget[] = [];
    let state = cmContext.createEditorState({
      content,
      onDocChange: () => {},
      onCardTargetsChange: (t: CardWidgetTarget[]) => {
        targets = t;
      },
      onOpenCardSearch: () => {},
    });
    let view = new cmContext.EditorView({ state, parent: element });
    // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await settled();
    return {
      targets,
      element,
      destroy: () => {
        view.destroy();
        element.remove();
      },
    };
  }

  test('block fitted embed with explicit size threads format + size style', async function (assert) {
    let { targets, element, destroy } = await collectTargets(
      '::card[https://example.com/cards/1 | fitted w:400 h:300]',
    );
    try {
      let target = targets.find((t) => t.kind === 'block');
      assert.strictEqual(target?.format, 'fitted', 'format is fitted');
      assert.ok(
        target?.style?.includes('width: 400px'),
        'style carries the width',
      );
      assert.ok(
        target?.style?.includes('height: 300px'),
        'style carries the height',
      );
      assert.ok(
        target?.style?.includes('overflow: hidden'),
        'fitted style carries overflow: hidden',
      );

      let widget = element.querySelector('.cm-card-widget--block');
      assert.strictEqual(
        widget?.getAttribute('data-boxel-bfm-format'),
        'fitted',
        'widget DOM carries the format attribute',
      );
      assert.strictEqual(
        widget?.getAttribute('data-boxel-bfm-width'),
        '400',
        'widget DOM carries the width attribute',
      );
      assert.strictEqual(
        widget?.getAttribute('data-boxel-bfm-height'),
        '300',
        'widget DOM carries the height attribute',
      );
    } finally {
      destroy();
    }
  });

  test('block isolated embed threads isolated format with a growable footprint', async function (assert) {
    let { targets, destroy } = await collectTargets(
      '::card[https://example.com/cards/1 | isolated]',
    );
    try {
      let target = targets.find((t) => t.kind === 'block');
      assert.strictEqual(target?.format, 'isolated', 'format is isolated');
      // CS-12320: block isolated gets a growable min-height so it does not
      // collapse (its default template lays out at height: 100%).
      assert.strictEqual(
        target?.style,
        'min-height: 18.75rem',
        'isolated embed carries a growable min-height footprint',
      );
    } finally {
      destroy();
    }
  });

  test('inline isolated / embedded embeds carry a definite footprint', async function (assert) {
    // CS-12320: inline isolated/embedded collapse without a definite width +
    // height (the default template lays out at 100% inside a shrink-wrapping
    // inline-block wrapper).
    let { targets, destroy } = await collectTargets(
      ':card[https://example.com/cards/1 | isolated] and :card[https://example.com/cards/2 | embedded]',
    );
    try {
      let isolated = targets.find((t) => t.format === 'isolated');
      assert.strictEqual(
        isolated?.style,
        'width: 24rem; height: 18.75rem; overflow: hidden',
        'inline isolated carries the shared footprint',
      );
      let embedded = targets.find((t) => t.format === 'embedded');
      assert.strictEqual(
        embedded?.style,
        'width: 16rem; height: 9.375rem; overflow: hidden',
        'inline embedded carries the shared footprint',
      );
    } finally {
      destroy();
    }
  });

  test('embeds without a size spec fall back to atom (inline) / embedded (block)', async function (assert) {
    let { targets, destroy } = await collectTargets(
      ':card[https://example.com/cards/1] and\n\n::card[https://example.com/cards/2]',
    );
    try {
      let inline = targets.find((t) => t.kind === 'inline');
      let block = targets.find((t) => t.kind === 'block');
      assert.strictEqual(inline?.format, 'atom', 'inline default is atom');
      assert.strictEqual(
        block?.format,
        'embedded',
        'block default is embedded',
      );
    } finally {
      destroy();
    }
  });

  test('file embeds thread format + size style like card embeds', async function (assert) {
    let { targets, destroy } = await collectTargets(
      '::file[https://example.com/files/a.pdf | fitted w:400 h:300]\n\n::file[https://example.com/files/b.pdf | isolated]',
    );
    try {
      let fitted = targets.find(
        (t) => t.refType === 'file' && t.format === 'fitted',
      );
      assert.ok(fitted, 'a fitted file target is present');
      assert.strictEqual(fitted?.refType, 'file', 'refType is file');
      assert.ok(
        fitted?.style?.includes('width: 400px'),
        'file fitted target carries the width',
      );
      assert.ok(
        fitted?.style?.includes('height: 300px'),
        'file fitted target carries the height',
      );
      assert.ok(
        fitted?.style?.includes('overflow: hidden'),
        'file fitted target carries overflow: hidden',
      );

      let isolated = targets.find(
        (t) => t.refType === 'file' && t.format === 'isolated',
      );
      assert.ok(isolated, 'isolated file target is present');
      // CS-12320: block isolated gets a growable min-height footprint.
      assert.strictEqual(
        isolated?.style,
        'min-height: 18.75rem',
        'isolated file target carries a growable min-height footprint',
      );
    } finally {
      destroy();
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
        changes: { from: 8, insert: '\n::card[./cards/1]\n' },
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

      // Execute the wrapWith('**') command that Mod-b is bound to
      cmContext.wrapWith('**')(view);

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

  // ── Complex document rendering (regression for line-break decoration error) ──

  test('complex document with mixed card refs, code blocks, and formatting renders without error', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      // This content matches the RichMarkdownPlayground instance and exercises
      // inline card refs, block card refs, fenced code blocks, inline code
      // containing :card[URL] syntax, and various markdown formatting.
      let content = [
        '# Welcome to Rich Markdown',
        '',
        'This is a **playground** for the `RichMarkdownField` with its CodeMirror editor.',
        '',
        '## Features',
        '',
        '- Markdown syntax highlighting',
        '- Card embedding via `:card[URL]` syntax',
        '- Slash commands for inserting cards',
        '- Keyboard shortcuts (Mod-B, Mod-I, Mod-`)',
        '',
        '## Card References',
        '',
        'Inline card reference: :card[./Author/alice]',
        '',
        'Block card reference:',
        '',
        '::card[./Author/jane-doe]',
        '',
        '## Code Block',
        '',
        '```typescript',
        "let greeting = 'Hello, world!';",
        'console.log(greeting);',
        '```',
        '',
        '> This is a blockquote with some *italic* text.',
        '',
        '---',
        '',
        '1. First ordered item',
        '2. Second ordered item',
        '3. Third ordered item',
      ].join('\n');

      let state = cmContext.createEditorState({
        content,
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
      });

      // This is the critical line — the old ViewPlugin approach threw
      // "RangeError: Decorations that replace line breaks may not be
      // specified via plugins" here.
      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      assert.ok(
        element.querySelector('.cm-editor'),
        'editor renders without throwing',
      );

      // Wait for target notification
      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      // Should have both inline and block targets
      let inlineTarget = targets.find((t) => t.kind === 'inline');
      let blockTarget = targets.find((t) => t.kind === 'block');
      assert.ok(inlineTarget, 'inline card ref produces a widget target');
      assert.ok(blockTarget, 'block card ref produces a widget target');
      assert.strictEqual(
        inlineTarget?.cardId,
        './Author/alice',
        'inline target has correct cardId',
      );
      assert.strictEqual(
        blockTarget?.cardId,
        './Author/jane-doe',
        'block target has correct cardId',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test(':card[URL] inside inline code backticks is not decorated', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content:
          'Use `:card[URL]` syntax to embed cards.\n\nReal ref: :card[./Author/alice]',
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

      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      // Only the real ref outside backticks should produce a target
      assert.strictEqual(
        targets.length,
        1,
        'only one widget target (the real card ref, not the one in backticks)',
      );
      assert.strictEqual(
        targets[0]?.cardId,
        './Author/alice',
        'target is from the real card ref',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Lazy loading ──

  // ── Source mode (livePreview=false) ──

  test('source mode: heading markers are visible, not replaced', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: '# Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        livePreview: false,
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // In source mode, onCursor is always true so heading markers get
      // Decoration.mark (visible) instead of Decoration.replace (hidden).
      let markers = element.querySelectorAll('.cm-md-marker');
      assert.ok(markers.length > 0, 'heading markers have cm-md-marker class');
      assert.ok(
        element.textContent?.includes('#'),
        'hash character is visible in source mode',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('source mode: bold markers are visible, not hidden', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Some **bold** text',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        livePreview: false,
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // In source mode, emphasis markers are never hidden
      let hiddenMarkers = element.querySelectorAll('.cm-md-marker--hidden');
      assert.strictEqual(
        hiddenMarkers.length,
        0,
        'no markers are hidden in source mode',
      );

      let markers = element.querySelectorAll('.cm-md-marker');
      assert.ok(markers.length > 0, 'bold markers are visible in source mode');

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('source mode: card widget targets are not produced', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let targets: CardWidgetTarget[] = [];
      let state = cmContext.createEditorState({
        content:
          'See :card[https://example.com/Author/alice] for details.\n\n::card[https://example.com/cards/1]',
        onDocChange: () => {},
        onCardTargetsChange: (t: CardWidgetTarget[]) => {
          targets = t;
        },
        onOpenCardSearch: () => {},
        livePreview: false,
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- waiting for rAF-based codemirror widget notification
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await settled();

      // In source mode, the card target notifier plugin is not included
      assert.strictEqual(targets.length, 0, 'no widget targets in source mode');

      // Card ref syntax is visible as text, not replaced by widgets
      let widgets = element.querySelectorAll('.cm-card-widget');
      assert.strictEqual(widgets.length, 0, 'no card widgets in source mode');
      assert.ok(
        element.textContent?.includes(':card['),
        'card ref syntax is visible in source mode',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('source mode: card refs are decorated with syntax highlighting', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content:
          'Text before\n\n::card[https://example.com/cards/1]\n\nText after',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        livePreview: false,
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // In source mode, card refs get syntax highlighting marks (onCursor=true always)
      let cardRefs = element.querySelectorAll('.cm-bfm-card-ref');
      assert.ok(
        cardRefs.length > 0,
        'card refs have syntax highlighting in source mode',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Focus-aware decorations ──

  test('unfocused editor hides heading markers in live preview mode', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: '# Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        livePreview: true,
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Editor starts unfocused — heading markers should be replaced (hidden)
      let cmContent = element.querySelector('.cm-content');
      assert.notOk(
        cmContent?.textContent?.includes('#'),
        'heading hash is hidden when editor is unfocused',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('focused editor shows heading markers on cursor line', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: '# Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        livePreview: true,
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // CM6 processes focus change effects asynchronously via DOM events,
      // so we dispatch the effect directly to simulate gaining focus.
      view.dispatch({
        effects: cmContext.focusChangeEffect.of(true),
      });

      // Heading markers on the cursor line (line 1, where cursor is at pos 0)
      // should now be visible instead of replaced.
      let cmContent = element.querySelector('.cm-content');
      assert.ok(
        cmContent?.textContent?.includes('#'),
        'heading hash is visible on cursor line when editor is focused',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Lazy loading ──

  // ── wrapWith formatting ──

  test('wrapWith wraps selection in bold markers', async function (assert) {
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
      view.dispatch({ selection: { anchor: 6, head: 11 } });
      cmContext.wrapWith('**')(view);

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

  test('wrapWith toggles off bold markers when already present', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Hello **World**',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select "**World**" (positions 6-15)
      view.dispatch({ selection: { anchor: 6, head: 15 } });
      cmContext.wrapWith('**')(view);

      assert.strictEqual(
        view.state.doc.toString(),
        'Hello World',
        'bold markers are removed when toggled off',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('wrapWith toggles off when markers are adjacent to selection (live preview)', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Hello **World** end',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select just "World" (positions 8-13), not the surrounding **
      // This simulates live preview where markers are hidden
      view.dispatch({ selection: { anchor: 8, head: 13 } });
      cmContext.wrapWith('**')(view);

      assert.strictEqual(
        view.state.doc.toString(),
        'Hello World end',
        'adjacent bold markers are removed when toggling off in live preview',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('wrapWith wraps selection in italic markers', async function (assert) {
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

      view.dispatch({ selection: { anchor: 6, head: 11 } });
      cmContext.wrapWith('*')(view);

      assert.strictEqual(
        view.state.doc.toString(),
        'Hello *World*',
        'text is wrapped in * for italic',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('wrapWith wraps selection in strikethrough markers', async function (assert) {
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

      view.dispatch({ selection: { anchor: 6, head: 11 } });
      cmContext.wrapWith('~~')(view);

      assert.strictEqual(
        view.state.doc.toString(),
        'Hello ~~World~~',
        'text is wrapped in ~~ for strikethrough',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('wrapWith wraps selection in code markers', async function (assert) {
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

      view.dispatch({ selection: { anchor: 6, head: 11 } });
      cmContext.wrapWith('`')(view);

      assert.strictEqual(
        view.state.doc.toString(),
        'Hello `World`',
        'text is wrapped in backticks for inline code',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('wrapWith inserts empty markers with cursor centered when no selection', async function (assert) {
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

      // Cursor at position 6, no selection
      view.dispatch({ selection: { anchor: 6, head: 6 } });
      let result = cmContext.wrapWith('**')(view);

      assert.true(result, 'returns true after inserting markers');
      assert.strictEqual(
        view.state.doc.toString(),
        'Hello ****World',
        'an empty pair of bold markers is inserted at the cursor',
      );
      let sel = view.state.selection.main;
      assert.true(sel.empty, 'cursor is collapsed (no selection)');
      assert.strictEqual(
        sel.from,
        8,
        'cursor sits between the two pairs of markers',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── onSelectionChange callback ──

  test('onSelectionChange fires when text is selected', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let selectionInfo: {
        hasSelection: boolean;
        from: number;
        to: number;
      } | null = null;
      let state = cmContext.createEditorState({
        content: 'Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        onSelectionChange: (info) => {
          selectionInfo = info;
        },
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      view.dispatch({ selection: { anchor: 6, head: 11 } });

      assert.ok(selectionInfo, 'onSelectionChange was called');
      assert.true(selectionInfo!.hasSelection, 'hasSelection is true');
      assert.strictEqual(selectionInfo!.from, 6, 'from is correct');
      assert.strictEqual(selectionInfo!.to, 11, 'to is correct');

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('onSelectionChange reports no selection for cursor', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let selectionInfo: { hasSelection: boolean } | null = null;
      let state = cmContext.createEditorState({
        content: 'Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        onSelectionChange: (info) => {
          selectionInfo = info;
        },
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Move cursor (not a selection)
      view.dispatch({ selection: { anchor: 3, head: 3 } });

      assert.ok(selectionInfo, 'onSelectionChange was called');
      assert.false(
        selectionInfo!.hasSelection,
        'hasSelection is false for cursor',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('onSelectionChange detects bold format in selection', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let formats: {
        bold: boolean;
        italic: boolean;
        code: boolean;
        strikethrough: boolean;
      } | null = null;
      let state = cmContext.createEditorState({
        content: 'Hello **World** end',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        onSelectionChange: (info) => {
          formats = info.formats;
        },
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select "**World**" (positions 6-15)
      view.dispatch({ selection: { anchor: 6, head: 15 } });

      assert.ok(formats, 'formats were provided');
      assert.true(formats!.bold, 'bold format is detected');

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Heading insertion (same logic as component's _insertHeading) ──

  test('heading prefix is added to line', async function (assert) {
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

      // Simulate _insertHeading(1): add "# " prefix
      let line = view.state.doc.lineAt(0);
      view.dispatch({
        changes: { from: line.from, to: line.from, insert: '# ' },
      });

      assert.strictEqual(
        view.state.doc.toString(),
        '# Hello World',
        'H1 prefix is added',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('heading prefix is removed when toggling same level', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: '# Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Simulate _insertHeading(1) on a line that already has "# "
      let line = view.state.doc.lineAt(0);
      let prefix = '# ';
      if (line.text.startsWith(prefix)) {
        view.dispatch({
          changes: {
            from: line.from,
            to: line.from + prefix.length,
            insert: '',
          },
        });
      }

      assert.strictEqual(
        view.state.doc.toString(),
        'Hello World',
        'H1 prefix is removed',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('heading level is switched when changing from one level to another', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: '# Hello World',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Simulate _insertHeading(2): replace "# " with "## "
      let line = view.state.doc.lineAt(0);
      let existingMatch = line.text.match(/^#{1,6}\s/);
      let removeLen = existingMatch ? existingMatch[0].length : 0;
      view.dispatch({
        changes: {
          from: line.from,
          to: line.from + removeLen,
          insert: '## ',
        },
      });

      assert.strictEqual(
        view.state.doc.toString(),
        '## Hello World',
        'heading level is changed from H1 to H2',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Line prefix toggling (same logic as component's _toggleLinePrefix) ──

  test('line prefix is added for bullet list', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Item one\nItem two\nItem three',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select all three lines
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

      // Simulate _toggleLinePrefix('- ')
      let prefix = '- ';
      let { from, to } = view.state.selection.main;
      let startLine = view.state.doc.lineAt(from);
      let endLine = view.state.doc.lineAt(to);
      let changes: { from: number; to: number; insert: string }[] = [];
      for (let i = startLine.number; i <= endLine.number; i++) {
        let line = view.state.doc.line(i);
        if (!line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      }
      view.dispatch({ changes });

      assert.strictEqual(
        view.state.doc.toString(),
        '- Item one\n- Item two\n- Item three',
        'bullet list prefix added to all lines',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('line prefix is removed when toggling off bullet list', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: '- Item one\n- Item two\n- Item three',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select all three lines
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

      // Simulate _toggleLinePrefix('- ') when all lines already have prefix
      let prefix = '- ';
      let { from, to } = view.state.selection.main;
      let startLine = view.state.doc.lineAt(from);
      let endLine = view.state.doc.lineAt(to);
      let allHavePrefix = true;
      for (let i = startLine.number; i <= endLine.number; i++) {
        let line = view.state.doc.line(i);
        if (!line.text.startsWith(prefix)) {
          allHavePrefix = false;
          break;
        }
      }
      assert.true(allHavePrefix, 'all lines have the prefix initially');

      let changes: { from: number; to: number; insert: string }[] = [];
      for (let i = startLine.number; i <= endLine.number; i++) {
        let line = view.state.doc.line(i);
        changes.push({
          from: line.from,
          to: line.from + prefix.length,
          insert: '',
        });
      }
      view.dispatch({ changes });

      assert.strictEqual(
        view.state.doc.toString(),
        'Item one\nItem two\nItem three',
        'bullet list prefix removed from all lines',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('numbered list prefix is added to lines', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'First\nSecond',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select both lines
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

      let prefix = '1. ';
      let { from, to } = view.state.selection.main;
      let startLine = view.state.doc.lineAt(from);
      let endLine = view.state.doc.lineAt(to);
      let changes: { from: number; to: number; insert: string }[] = [];
      for (let i = startLine.number; i <= endLine.number; i++) {
        let line = view.state.doc.line(i);
        if (!line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      }
      view.dispatch({ changes });

      assert.strictEqual(
        view.state.doc.toString(),
        '1. First\n1. Second',
        'numbered list prefix added to all lines',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('blockquote prefix is added to lines', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'A quote\nAnother line',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select both lines
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

      let prefix = '> ';
      let { from, to } = view.state.selection.main;
      let startLine = view.state.doc.lineAt(from);
      let endLine = view.state.doc.lineAt(to);
      let changes: { from: number; to: number; insert: string }[] = [];
      for (let i = startLine.number; i <= endLine.number; i++) {
        let line = view.state.doc.line(i);
        if (!line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      }
      view.dispatch({ changes });

      assert.strictEqual(
        view.state.doc.toString(),
        '> A quote\n> Another line',
        'blockquote prefix added to all lines',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('line prefix only adds to lines missing it (partial toggle)', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: '- Item one\nItem two\n- Item three',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select all lines
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

      let prefix = '- ';
      let { from, to } = view.state.selection.main;
      let startLine = view.state.doc.lineAt(from);
      let endLine = view.state.doc.lineAt(to);

      // Not all lines have prefix, so add to those missing
      let allHavePrefix = true;
      for (let i = startLine.number; i <= endLine.number; i++) {
        let line = view.state.doc.line(i);
        if (!line.text.startsWith(prefix)) {
          allHavePrefix = false;
          break;
        }
      }
      assert.false(allHavePrefix, 'not all lines have the prefix');

      let changes: { from: number; to: number; insert: string }[] = [];
      for (let i = startLine.number; i <= endLine.number; i++) {
        let line = view.state.doc.line(i);
        if (!line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from, insert: prefix });
        }
      }
      view.dispatch({ changes });

      assert.strictEqual(
        view.state.doc.toString(),
        '- Item one\n- Item two\n- Item three',
        'prefix added only to lines that were missing it',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  // ── Link toggling ──

  test('link wraps selection in markdown link syntax', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Click here for details',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select "here" (positions 6-10)
      view.dispatch({ selection: { anchor: 6, head: 10 } });

      let { from, to } = view.state.selection.main;
      let selected = view.state.sliceDoc(from, to);
      let insert = `[${selected}](url)`;
      view.dispatch({
        changes: { from, to, insert },
        selection: {
          anchor: from + selected.length + 3,
          head: from + selected.length + 6,
        },
      });

      assert.strictEqual(
        view.state.doc.toString(),
        'Click [here](url) for details',
        'text is wrapped in markdown link syntax',
      );

      // Cursor should select "url" placeholder
      let sel = view.state.selection.main;
      assert.strictEqual(
        view.state.sliceDoc(sel.from, sel.to),
        'url',
        'cursor selects the url placeholder',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('link is unwrapped when selecting just the link text', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);

    try {
      let state = cmContext.createEditorState({
        content: 'Click [here](https://example.com) for details',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
      });

      let view = new cmContext.EditorView({
        state,
        parent: element,
      });

      // Select just "here" (positions 7-11) — the text inside the brackets,
      // as a user would in live preview where [ and ](url) are hidden
      view.dispatch({ selection: { anchor: 7, head: 11 } });

      // Simulate _toggleLink: scan for enclosing [text](url)
      let doc = view.state.doc.toString();
      let { from, to } = view.state.selection.main;
      let bracketOpen = doc.lastIndexOf('[', from);
      let parenClose = doc.indexOf(')', to - 1);
      let between = doc.slice(bracketOpen, parenClose + 1);
      let linkMatch = between.match(/^\[(.+)\]\(.*\)$/);
      assert.ok(linkMatch, 'enclosing link pattern found');
      view.dispatch({
        changes: {
          from: bracketOpen,
          to: parenClose + 1,
          insert: linkMatch![1],
        },
      });

      assert.strictEqual(
        view.state.doc.toString(),
        'Click here for details',
        'link syntax is removed, leaving just the text',
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

  // ── currentRef tracking (BFM directive under cursor) ──

  test('onSelectionChange.currentRef reports the BFM directive under the cursor', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);
    try {
      let lastInfo: any = null;
      let content = 'Inline :card[./mango] then more text';
      let state = cmContext.createEditorState({
        content,
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        onSelectionChange: (info) => {
          lastInfo = info;
        },
      });
      let view = new cmContext.EditorView({ state, parent: element });

      let directiveStart = content.indexOf(':card');
      let directiveEnd = content.indexOf(']') + 1;

      // Inside the directive — currentRef populated.
      view.dispatch({
        selection: { anchor: directiveStart + 2, head: directiveStart + 2 },
      });
      assert.ok(lastInfo?.currentRef, 'currentRef is set inside the directive');
      assert.strictEqual(lastInfo.currentRef.refType, 'card');
      assert.strictEqual(lastInfo.currentRef.url, './mango');
      assert.strictEqual(lastInfo.currentRef.from, directiveStart);
      assert.strictEqual(lastInfo.currentRef.to, directiveEnd);

      // Outside the directive — currentRef cleared.
      view.dispatch({ selection: { anchor: 0, head: 0 } });
      assert.notOk(
        lastInfo?.currentRef,
        'currentRef is undefined outside any directive',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });

  test('currentRef refreshes after a doc edit shifts the range', async function (assert) {
    let element = document.createElement('div');
    document.body.appendChild(element);
    try {
      let lastInfo: any = null;
      let state = cmContext.createEditorState({
        content: ':card[./mango]',
        onDocChange: () => {},
        onCardTargetsChange: () => {},
        onOpenCardSearch: () => {},
        onSelectionChange: (info) => {
          lastInfo = info;
        },
      });
      let view = new cmContext.EditorView({ state, parent: element });

      // Prepend text — the directive shifts right by 5 chars.
      view.dispatch({ changes: { from: 0, to: 0, insert: 'pre: ' } });
      view.dispatch({ selection: { anchor: 7, head: 7 } });

      assert.ok(lastInfo?.currentRef, 'currentRef detected after the edit');
      assert.strictEqual(
        lastInfo.currentRef.from,
        5,
        'range start tracks the edit',
      );

      view.destroy();
    } finally {
      element.remove();
    }
  });
});
