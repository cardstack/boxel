import { render, waitFor, settled } from '@ember/test-helpers';
import { tracked } from '@glimmer/tracking';
import { module, test } from 'qunit';

import { setupRenderingTest } from '../../helpers/setup';

// Import the prosemirror-context module directly from host — this is
// the module that gets lazy-loaded in production via globalThis.__loadProseMirror.
import pmContext from '@cardstack/host/lib/prosemirror-context';

// We can't import ProseMirrorEditor from @cardstack/base (it's served
// through the realm, not npm). Instead we render a thin wrapper that
// exercises the same lazy-load path the real component uses.

module('Integration | prosemirror-context', function (hooks) {
  setupRenderingTest(hooks);

  // ── Schema tests ──

  test('schema has expected node types', function (assert) {
    let { schema } = pmContext;
    let nodeNames = Object.keys(schema.nodes);

    assert.true(nodeNames.includes('doc'), 'has doc');
    assert.true(nodeNames.includes('paragraph'), 'has paragraph');
    assert.true(nodeNames.includes('heading'), 'has heading');
    assert.true(nodeNames.includes('blockquote'), 'has blockquote');
    assert.true(nodeNames.includes('code_block'), 'has code_block');
    assert.true(nodeNames.includes('bullet_list'), 'has bullet_list');
    assert.true(nodeNames.includes('ordered_list'), 'has ordered_list');
    assert.true(nodeNames.includes('list_item'), 'has list_item');
    assert.true(nodeNames.includes('horizontal_rule'), 'has horizontal_rule');
    assert.true(nodeNames.includes('hard_break'), 'has hard_break');
    assert.true(nodeNames.includes('text'), 'has text');
    assert.true(nodeNames.includes('boxel_card_atom'), 'has boxel_card_atom');
    assert.true(nodeNames.includes('boxel_card_block'), 'has boxel_card_block');
  });

  test('schema has expected mark types', function (assert) {
    let { schema } = pmContext;
    let markNames = Object.keys(schema.marks);

    assert.true(markNames.includes('strong'), 'has strong');
    assert.true(markNames.includes('em'), 'has em');
    assert.true(markNames.includes('code'), 'has code');
    assert.true(markNames.includes('link'), 'has link');
  });

  // ── Parse tests ──

  test('parseMarkdown: heading', function (assert) {
    let doc = pmContext.parseMarkdown('# Hello World');
    let firstChild = doc.firstChild;
    assert.strictEqual(firstChild?.type.name, 'heading', 'parses as heading');
    assert.strictEqual(firstChild?.attrs.level, 1, 'heading level is 1');
    assert.strictEqual(
      firstChild?.textContent,
      'Hello World',
      'heading text content',
    );
  });

  test('parseMarkdown: paragraph with inline formatting', function (assert) {
    let doc = pmContext.parseMarkdown('Some **bold** and *italic* text.');
    let para = doc.firstChild;
    assert.strictEqual(para?.type.name, 'paragraph', 'parses as paragraph');

    let hasStrong = false;
    let hasEm = false;
    para?.descendants((node) => {
      if (node.isText) {
        node.marks.forEach((mark) => {
          if (mark.type.name === 'strong') hasStrong = true;
          if (mark.type.name === 'em') hasEm = true;
        });
      }
      return true;
    });
    assert.true(hasStrong, 'has strong mark');
    assert.true(hasEm, 'has em mark');
  });

  test('parseMarkdown: bullet list', function (assert) {
    let doc = pmContext.parseMarkdown('- Item one\n- Item two\n- Item three');
    let list = doc.firstChild;
    assert.strictEqual(
      list?.type.name,
      'bullet_list',
      'parses as bullet_list',
    );
    assert.strictEqual(list?.childCount, 3, 'has 3 list items');
  });

  test('parseMarkdown: ordered list', function (assert) {
    let doc = pmContext.parseMarkdown('1. First\n2. Second\n3. Third');
    let list = doc.firstChild;
    assert.strictEqual(
      list?.type.name,
      'ordered_list',
      'parses as ordered_list',
    );
    assert.strictEqual(list?.childCount, 3, 'has 3 list items');
  });

  test('parseMarkdown: code block', function (assert) {
    let doc = pmContext.parseMarkdown('```typescript\nconst x = 1;\n```');
    let block = doc.firstChild;
    assert.strictEqual(
      block?.type.name,
      'code_block',
      'parses as code_block',
    );
    assert.strictEqual(
      block?.textContent,
      'const x = 1;',
      'code block content',
    );
  });

  test('parseMarkdown: blockquote', function (assert) {
    let doc = pmContext.parseMarkdown('> This is a quote');
    let bq = doc.firstChild;
    assert.strictEqual(bq?.type.name, 'blockquote', 'parses as blockquote');
    assert.strictEqual(
      bq?.firstChild?.textContent,
      'This is a quote',
      'blockquote text content',
    );
  });

  test('parseMarkdown: card atom inline', function (assert) {
    let doc = pmContext.parseMarkdown(
      'See :card[./Author/alice] for details.',
    );
    let para = doc.firstChild;
    assert.strictEqual(para?.type.name, 'paragraph', 'wraps in paragraph');

    let hasAtom = false;
    para?.descendants((node) => {
      if (node.type.name === 'boxel_card_atom') {
        hasAtom = true;
        assert.strictEqual(
          node.attrs.cardId,
          './Author/alice',
          'card atom has correct cardId',
        );
      }
      return true;
    });
    assert.true(hasAtom, 'contains card atom node');
  });

  test('parseMarkdown: card block', function (assert) {
    let doc = pmContext.parseMarkdown('::card[./Author/alice]');
    let block = doc.firstChild;
    assert.strictEqual(
      block?.type.name,
      'boxel_card_block',
      'parses as boxel_card_block',
    );
    assert.strictEqual(
      block?.attrs.cardId,
      './Author/alice',
      'card block has correct cardId',
    );
  });

  test('parseMarkdown: horizontal rule', function (assert) {
    let doc = pmContext.parseMarkdown('Before\n\n---\n\nAfter');
    let hasHr = false;
    doc.descendants((node) => {
      if (node.type.name === 'horizontal_rule') hasHr = true;
      return true;
    });
    assert.true(hasHr, 'contains horizontal_rule node');
  });

  test('parseMarkdown: empty content', function (assert) {
    let doc = pmContext.parseMarkdown('');
    assert.strictEqual(doc.type.name, 'doc', 'returns a doc node');
    assert.strictEqual(
      doc.firstChild?.type.name,
      'paragraph',
      'has an empty paragraph',
    );
  });

  // ── Serialize tests ──

  test('serializeMarkdown: heading', function (assert) {
    let doc = pmContext.parseMarkdown('# Hello World');
    let result = pmContext.serializeMarkdown(doc);
    assert.strictEqual(result.trim(), '# Hello World');
  });

  test('serializeMarkdown: paragraph with formatting', function (assert) {
    let doc = pmContext.parseMarkdown('Some **bold** and *italic* text.');
    let result = pmContext.serializeMarkdown(doc);
    assert.true(result.includes('**bold**'), 'preserves bold');
    assert.true(result.includes('*italic*'), 'preserves italic');
  });

  test('serializeMarkdown: bullet list', function (assert) {
    let doc = pmContext.parseMarkdown('- Item one\n- Item two');
    let result = pmContext.serializeMarkdown(doc);
    assert.true(result.includes('- Item one'), 'preserves first item');
    assert.true(result.includes('- Item two'), 'preserves second item');
  });

  test('serializeMarkdown: code block', function (assert) {
    let doc = pmContext.parseMarkdown('```\nconst x = 1;\n```');
    let result = pmContext.serializeMarkdown(doc);
    assert.true(result.includes('const x = 1;'), 'preserves code content');
    assert.true(result.includes('```'), 'preserves code fences');
  });

  test('serializeMarkdown: blockquote', function (assert) {
    let doc = pmContext.parseMarkdown('> This is a quote');
    let result = pmContext.serializeMarkdown(doc);
    assert.true(result.includes('> This is a quote'), 'preserves blockquote');
  });

  test('serializeMarkdown: card atom', function (assert) {
    let doc = pmContext.parseMarkdown(
      'See :card[./Author/alice] for details.',
    );
    let result = pmContext.serializeMarkdown(doc);
    assert.true(
      result.includes(':card[./Author/alice]'),
      'preserves card atom syntax',
    );
  });

  test('serializeMarkdown: card block', function (assert) {
    let doc = pmContext.parseMarkdown('::card[./Author/alice]');
    let result = pmContext.serializeMarkdown(doc);
    assert.true(
      result.includes('::card[./Author/alice]'),
      'preserves card block syntax',
    );
  });

  test('round-trip: complex document', function (assert) {
    let input = [
      '# Title',
      '',
      'A paragraph with **bold** and *italic*.',
      '',
      '- Item one',
      '- Item two',
      '',
      '> A quote',
      '',
      '```',
      'code here',
      '```',
      '',
      '::card[./SomeCard/1]',
    ].join('\n');

    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);

    assert.true(output.includes('# Title'), 'preserves heading');
    assert.true(output.includes('**bold**'), 'preserves bold');
    assert.true(output.includes('*italic*'), 'preserves italic');
    assert.true(output.includes('- Item one'), 'preserves list');
    assert.true(output.includes('> A quote'), 'preserves blockquote');
    assert.true(output.includes('code here'), 'preserves code');
    assert.true(
      output.includes('::card[./SomeCard/1]'),
      'preserves card block',
    );
  });

  // ── Round-trip: standard markdown elements ──

  test('round-trip: heading levels 1-6', function (assert) {
    for (let level = 1; level <= 6; level++) {
      let prefix = '#'.repeat(level);
      let input = `${prefix} Heading Level ${level}`;
      let doc = pmContext.parseMarkdown(input);
      let output = pmContext.serializeMarkdown(doc);
      assert.strictEqual(output, input, `h${level} round-trips`);
    }
  });

  test('round-trip: plain paragraph', function (assert) {
    let input = 'Just a plain paragraph.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: bold text', function (assert) {
    let input = 'Some **bold** text.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: italic text', function (assert) {
    let input = 'Some *italic* text.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: bold italic text', function (assert) {
    let input = 'Some ***bold italic*** text.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: inline code', function (assert) {
    let input = 'Use the `console.log` function.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: link', function (assert) {
    let input = 'Visit [Example](https://example.com) for more.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: bullet list', function (assert) {
    let input = '- First item\n- Second item\n- Third item';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: ordered list', function (assert) {
    let input = '1. First item\n2. Second item\n3. Third item';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: ordered list with custom start', function (assert) {
    let input = '5. Fifth item\n6. Sixth item';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: blockquote', function (assert) {
    let input = '> This is a quoted paragraph.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: code block without language', function (assert) {
    let input = '```\nconst x = 1;\n```';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: code block with language', function (assert) {
    let input = '```typescript\nconst x: number = 1;\n```';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: horizontal rule', function (assert) {
    let input = 'Before\n\n---\n\nAfter';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: multiple paragraphs', function (assert) {
    let input = 'First paragraph.\n\nSecond paragraph.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: empty code block', function (assert) {
    let input = '```\n```';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  // ── Round-trip: card references ──

  test('round-trip: inline card with relative URL', function (assert) {
    let input = 'See :card[./Author/alice] for details.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: inline card with absolute URL', function (assert) {
    let input =
      'See :card[https://example.com/Author/alice] for details.';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: block card with relative URL', function (assert) {
    let input = '::card[./Author/alice]';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: block card with absolute URL', function (assert) {
    let input = '::card[https://example.com/Author/alice]';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  // ── Round-trip: edge cases ──

  test('round-trip: adjacent inline cards', function (assert) {
    let input = ':card[./Author/alice]:card[./Author/bob]';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: card atom inside list item', function (assert) {
    let input =
      '- See :card[./Author/alice] here\n- And :card[./Author/bob] there';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: card block after heading', function (assert) {
    let input = '# Authors\n\n::card[./Author/alice]';
    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  test('round-trip: mixed content document', function (assert) {
    let input = [
      '# Document Title',
      '',
      'A paragraph with **bold**, *italic*, and `code`.',
      '',
      '- List item with :card[./Card/1]',
      '- Another item',
      '',
      '> A blockquote',
      '',
      '```javascript',
      'console.log("hello");',
      '```',
      '',
      '::card[./SomeCard/1]',
    ].join('\n');

    let doc = pmContext.parseMarkdown(input);
    let output = pmContext.serializeMarkdown(doc);
    assert.strictEqual(output, input);
  });

  // ── Parse: label auto-derivation ──

  test('parseMarkdown: card atom label derived from URL path', function (assert) {
    let doc = pmContext.parseMarkdown('See :card[./Author/alice] here.');
    let atom: any = null;
    doc.descendants((node) => {
      if (node.type.name === 'boxel_card_atom') atom = node;
      return true;
    });
    assert.strictEqual(atom?.attrs.cardId, './Author/alice');
    assert.strictEqual(
      atom?.attrs.label,
      'alice',
      'label derived from last path segment',
    );
  });

  test('parseMarkdown: card atom label from absolute URL', function (assert) {
    let doc = pmContext.parseMarkdown(
      ':card[https://example.com/Author/alice]',
    );
    let atom: any = null;
    doc.descendants((node) => {
      if (node.type.name === 'boxel_card_atom') atom = node;
      return true;
    });
    assert.strictEqual(
      atom?.attrs.label,
      'alice',
      'label derived from last URL segment',
    );
  });

  // ── EditorState / EditorView integration ──

  test('EditorState can be created from parsed document', function (assert) {
    let doc = pmContext.parseMarkdown('Hello world');
    let state = pmContext.EditorState.create({ doc });

    assert.ok(state, 'state is created');
    assert.strictEqual(
      state.doc.firstChild?.textContent,
      'Hello world',
      'state contains the parsed document',
    );
  });

  test('EditorView mounts into a DOM element', async function (assert) {
    let doc = pmContext.parseMarkdown('# Test Heading');
    let state = pmContext.EditorState.create({
      doc,
      plugins: [
        pmContext.keymap(pmContext.baseKeymap),
        pmContext.history(),
      ],
    });

    await render(<template><div id='pm-mount'></div></template>);

    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    assert.ok(mountEl, 'mount element exists');

    let view = new pmContext.EditorView(mountEl, { state });

    assert.ok(
      mountEl.querySelector('.ProseMirror'),
      'ProseMirror view mounts into element',
    );
    assert.ok(
      mountEl.querySelector('.ProseMirror h1'),
      'heading renders in the view',
    );
    assert.strictEqual(
      mountEl.querySelector('.ProseMirror h1')?.textContent,
      'Test Heading',
      'heading text content is correct',
    );

    view.destroy();
  });

  test('EditorView renders card atom placeholder DOM', async function (assert) {
    let doc = pmContext.parseMarkdown(
      'See :card[./Author/alice] for details.',
    );
    let state = pmContext.EditorState.create({ doc });

    await render(<template><div id='pm-mount'></div></template>);

    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let view = new pmContext.EditorView(mountEl, { state });

    assert.ok(
      mountEl.querySelector('.boxel-card-atom'),
      'card atom placeholder renders',
    );

    view.destroy();
  });

  test('EditorView renders card block placeholder DOM', async function (assert) {
    let doc = pmContext.parseMarkdown('::card[./Author/alice]');
    let state = pmContext.EditorState.create({ doc });

    await render(<template><div id='pm-mount'></div></template>);

    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let view = new pmContext.EditorView(mountEl, { state });

    assert.ok(
      mountEl.querySelector('.boxel-card-block'),
      'card block placeholder renders',
    );

    view.destroy();
  });

  // ── Card nodeView tests ──

  test('createCardNodeViews registers atom targets', function (assert) {
    let receivedTargets: any[] = [];
    let nodeViews = pmContext.createCardNodeViews((targets: any[]) => {
      receivedTargets = targets;
    });

    assert.ok(nodeViews.boxel_card_atom, 'has boxel_card_atom nodeView');
    assert.ok(nodeViews.boxel_card_block, 'has boxel_card_block nodeView');

    let atomNode = pmContext.schema.nodes.boxel_card_atom.create({
      cardId: './Author/alice',
      label: 'alice',
    });
    let nv = nodeViews.boxel_card_atom(atomNode);

    assert.ok(nv.dom, 'nodeView has dom element');
    assert.strictEqual(
      nv.dom.tagName,
      'SPAN',
      'atom nodeView uses span element',
    );
    assert.strictEqual(
      nv.dom.getAttribute('data-card-id'),
      './Author/alice',
      'dom has data-card-id attribute',
    );
    assert.strictEqual(
      nv.dom.classList.contains('boxel-card-atom-view'),
      true,
      'dom has boxel-card-atom-view class',
    );
    assert.strictEqual(receivedTargets.length, 1, 'one target registered');
    assert.strictEqual(
      receivedTargets[0].cardId,
      './Author/alice',
      'target has correct cardId',
    );
    assert.strictEqual(
      receivedTargets[0].format,
      'atom',
      'target has atom format',
    );
    assert.strictEqual(
      receivedTargets[0].kind,
      'inline',
      'target has inline kind',
    );

    nv.destroy();
    assert.strictEqual(
      receivedTargets.length,
      0,
      'target unregistered on destroy',
    );
  });

  test('createCardNodeViews registers block targets', function (assert) {
    let receivedTargets: any[] = [];
    let nodeViews = pmContext.createCardNodeViews((targets: any[]) => {
      receivedTargets = targets;
    });

    let blockNode = pmContext.schema.nodes.boxel_card_block.create({
      cardId: './Author/alice',
    });
    let nv = nodeViews.boxel_card_block(blockNode);

    assert.ok(nv.dom, 'nodeView has dom element');
    assert.strictEqual(
      nv.dom.tagName,
      'DIV',
      'block nodeView uses div element',
    );
    assert.strictEqual(
      nv.dom.getAttribute('data-card-id'),
      './Author/alice',
      'dom has data-card-id attribute',
    );
    assert.strictEqual(
      receivedTargets.length,
      1,
      'one target registered',
    );
    assert.strictEqual(
      receivedTargets[0].format,
      'embedded',
      'target has embedded format',
    );
    assert.strictEqual(
      receivedTargets[0].kind,
      'block',
      'target has block kind',
    );

    nv.destroy();
    assert.strictEqual(
      receivedTargets.length,
      0,
      'target unregistered on destroy',
    );
  });

  test('createCardNodeViews tracks multiple targets', function (assert) {
    let receivedTargets: any[] = [];
    let nodeViews = pmContext.createCardNodeViews((targets: any[]) => {
      receivedTargets = targets;
    });

    let atom1 = pmContext.schema.nodes.boxel_card_atom.create({
      cardId: './Card/1',
      label: '1',
    });
    let atom2 = pmContext.schema.nodes.boxel_card_atom.create({
      cardId: './Card/2',
      label: '2',
    });
    let block1 = pmContext.schema.nodes.boxel_card_block.create({
      cardId: './Card/3',
    });

    let nv1 = nodeViews.boxel_card_atom(atom1);
    let nv2 = nodeViews.boxel_card_atom(atom2);
    let nv3 = nodeViews.boxel_card_block(block1);

    assert.strictEqual(receivedTargets.length, 3, 'three targets registered');

    nv2.destroy();
    assert.strictEqual(
      receivedTargets.length,
      2,
      'two targets after destroying middle',
    );
    assert.strictEqual(
      receivedTargets[0].cardId,
      './Card/1',
      'first target preserved',
    );
    assert.strictEqual(
      receivedTargets[1].cardId,
      './Card/3',
      'third target preserved',
    );

    nv1.destroy();
    nv3.destroy();
    assert.strictEqual(receivedTargets.length, 0, 'all targets cleared');
  });

  test('EditorView with nodeViews renders card containers', async function (assert) {
    let doc = pmContext.parseMarkdown(
      'Text with :card[./Author/alice] and\n\n::card[./Post/1]',
    );
    let state = pmContext.EditorState.create({ doc });

    await render(<template><div id='pm-mount'></div></template>);

    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let targets: any[] = [];
    let nodeViews = pmContext.createCardNodeViews((t: any[]) => {
      targets = t;
    });

    let view = new pmContext.EditorView(mountEl, { state, nodeViews });

    assert.ok(
      mountEl.querySelector('.boxel-card-atom-view'),
      'card atom nodeView container renders',
    );
    assert.ok(
      mountEl.querySelector('.boxel-card-block-view'),
      'card block nodeView container renders',
    );
    assert.strictEqual(targets.length, 2, 'two targets registered');
    assert.strictEqual(
      targets[0].cardId,
      './Author/alice',
      'atom target has correct cardId',
    );
    assert.strictEqual(
      targets[1].cardId,
      './Post/1',
      'block target has correct cardId',
    );

    view.destroy();
    assert.strictEqual(
      targets.length,
      0,
      'targets cleared after view destroy',
    );
  });

  test('nodeView ignoreMutation returns true', function (assert) {
    let nodeViews = pmContext.createCardNodeViews(() => {});
    let atomNode = pmContext.schema.nodes.boxel_card_atom.create({
      cardId: './Card/1',
      label: '1',
    });
    let nv = nodeViews.boxel_card_atom(atomNode);

    assert.true(
      nv.ignoreMutation(),
      'ignoreMutation returns true to prevent ProseMirror from handling DOM mutations in card content',
    );

    nv.destroy();
  });

  // ── Slash command plugin tests ──

  test('createSlashCommandPlugin activates on "/" via setMeta', async function (assert) {
    let doc = pmContext.parseMarkdown('');
    let stateChanges: any[] = [];
    let slashPlugin = pmContext.createSlashCommandPlugin(
      (state: any) => { stateChanges.push(state); },
      () => {},
      () => {},
    );
    let state = pmContext.EditorState.create({
      doc,
      plugins: [slashPlugin],
    });

    await render(<template><div id='pm-mount'></div></template>);
    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let view = new pmContext.EditorView(mountEl, { state });

    // Activate via setMeta (simulates what handleTextInput does internally)
    let from = view.state.selection.from;
    let tr = view.state.tr
      .insertText('/', from, from)
      .setMeta(pmContext.slashCommandPluginKey, {
        active: true,
        query: '',
        from,
      });
    view.dispatch(tr);

    let pluginState = pmContext.slashCommandPluginKey.getState(view.state);
    assert.ok(
      pluginState?.active,
      'slash command plugin activates via setMeta',
    );
    assert.strictEqual(
      pluginState?.query,
      '',
      'query is empty after just "/"',
    );

    // The view callback should have been called
    assert.ok(
      stateChanges.length > 0,
      'onStateChange callback was called',
    );

    view.destroy();
  });

  test('createSlashCommandPlugin tracks query as user types', async function (assert) {
    let doc = pmContext.parseMarkdown('');
    let slashPlugin = pmContext.createSlashCommandPlugin(
      () => {},
      () => {},
      () => {},
    );
    let state = pmContext.EditorState.create({
      doc,
      plugins: [slashPlugin],
    });

    await render(<template><div id='pm-mount'></div></template>);
    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let view = new pmContext.EditorView(mountEl, { state });

    // Insert "/" and activate via setMeta
    let from = view.state.selection.from;
    let tr = view.state.tr
      .insertText('/', from, from)
      .setMeta(pmContext.slashCommandPluginKey, {
        active: true,
        query: '',
        from,
      });
    view.dispatch(tr);

    // Type "car" after the "/"
    let pos = view.state.selection.from;
    tr = view.state.tr.insertText('car', pos, pos);
    view.dispatch(tr);

    let pluginState = pmContext.slashCommandPluginKey.getState(view.state);
    assert.strictEqual(
      pluginState?.query,
      'car',
      'query tracks typed text after "/"',
    );

    view.destroy();
  });

  test('createSlashCommandPlugin deactivates on Escape', async function (assert) {
    let doc = pmContext.parseMarkdown('');
    let slashPlugin = pmContext.createSlashCommandPlugin(
      () => {},
      () => {},
      () => {},
    );
    let state = pmContext.EditorState.create({
      doc,
      plugins: [slashPlugin],
    });

    await render(<template><div id='pm-mount'></div></template>);
    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let view = new pmContext.EditorView(mountEl, { state });

    // Insert "/" and activate
    let from = view.state.selection.from;
    let tr = view.state.tr
      .insertText('/', from, from)
      .setMeta(pmContext.slashCommandPluginKey, {
        active: true,
        query: '',
        from,
      });
    view.dispatch(tr);

    assert.ok(
      pmContext.slashCommandPluginKey.getState(view.state)?.active,
      'plugin is active before Escape',
    );

    // Simulate Escape key — ProseMirror's handleKeyDown fires on focus+dispatch
    view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));

    let pluginState = pmContext.slashCommandPluginKey.getState(view.state);
    assert.notOk(
      pluginState?.active,
      'plugin deactivates after Escape',
    );

    view.destroy();
  });

  test('createSlashCommandPlugin calls onNavigate on ArrowUp/Down', async function (assert) {
    let doc = pmContext.parseMarkdown('');
    let navigations: string[] = [];
    let slashPlugin = pmContext.createSlashCommandPlugin(
      () => {},
      () => {},
      (direction: string) => { navigations.push(direction); },
    );
    let state = pmContext.EditorState.create({
      doc,
      plugins: [slashPlugin],
    });

    await render(<template><div id='pm-mount'></div></template>);
    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let view = new pmContext.EditorView(mountEl, { state });

    // Activate slash command
    let from = view.state.selection.from;
    let tr = view.state.tr
      .insertText('/', from, from)
      .setMeta(pmContext.slashCommandPluginKey, {
        active: true,
        query: '',
        from,
      });
    view.dispatch(tr);

    // Simulate ArrowDown and ArrowUp
    view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }));
    view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    }));

    assert.deepEqual(
      navigations,
      ['down', 'up'],
      'onNavigate called with correct directions',
    );

    view.destroy();
  });

  test('createSlashCommandPlugin calls onSelectItem on Enter', async function (assert) {
    let doc = pmContext.parseMarkdown('');
    let selections: number[] = [];
    let slashPlugin = pmContext.createSlashCommandPlugin(
      () => {},
      (index: number) => { selections.push(index); },
      () => {},
    );
    let state = pmContext.EditorState.create({
      doc,
      plugins: [slashPlugin],
    });

    await render(<template><div id='pm-mount'></div></template>);
    let mountEl = document.querySelector('#pm-mount') as HTMLElement;
    let view = new pmContext.EditorView(mountEl, { state });

    // Activate slash command
    let from = view.state.selection.from;
    let tr = view.state.tr
      .insertText('/', from, from)
      .setMeta(pmContext.slashCommandPluginKey, {
        active: true,
        query: '',
        from,
      });
    view.dispatch(tr);

    // Simulate Enter
    view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    assert.deepEqual(
      selections,
      [-1],
      'onSelectItem called with -1 (select current item)',
    );

    view.destroy();
  });

  test('card node insertion creates correct inline node', function (assert) {
    let doc = pmContext.parseMarkdown('Hello world');
    let state = pmContext.EditorState.create({ doc });

    // Insert an inline card atom at position 6 (after "Hello ")
    let node = pmContext.schema.nodes.boxel_card_atom.create({
      cardId: './Author/alice',
      label: 'alice',
    });
    let tr = state.tr.insert(6, node);
    let newState = state.apply(tr);
    let markdown = pmContext.serializeMarkdown(newState.doc);

    assert.ok(
      markdown.includes(':card[./Author/alice]'),
      'inline card reference serialized correctly',
    );
  });

  test('card node insertion creates correct block node', function (assert) {
    let doc = pmContext.parseMarkdown('Hello world');
    let state = pmContext.EditorState.create({ doc });

    // Insert a block card after the paragraph
    let node = pmContext.schema.nodes.boxel_card_block.create({
      cardId: './Post/1',
    });
    // Position after the paragraph end
    let insertPos = state.doc.content.size;
    let tr = state.tr.insert(insertPos, node);
    let newState = state.apply(tr);
    let markdown = pmContext.serializeMarkdown(newState.doc);

    assert.ok(
      markdown.includes('::card[./Post/1]'),
      'block card reference serialized correctly',
    );
    assert.ok(
      markdown.includes('Hello world'),
      'original content preserved',
    );
  });

  // ── Lazy-loading via globalThis (component pattern) ──

  test('globalThis.__loadProseMirror loader works', async function (assert) {
    let originalLoader = (globalThis as any).__loadProseMirror;

    (globalThis as any).__loadProseMirror = async () => {
      let mod = await import('@cardstack/host/lib/prosemirror-context');
      return mod.default;
    };

    try {
      let loadProseMirror = (globalThis as any).__loadProseMirror;
      let pm = await loadProseMirror();

      assert.ok(pm.schema, 'loaded context has schema');
      assert.ok(pm.EditorState, 'loaded context has EditorState');
      assert.ok(pm.EditorView, 'loaded context has EditorView');
      assert.ok(pm.parseMarkdown, 'loaded context has parseMarkdown');
      assert.ok(pm.serializeMarkdown, 'loaded context has serializeMarkdown');
    } finally {
      (globalThis as any).__loadProseMirror = originalLoader;
    }
  });
});
