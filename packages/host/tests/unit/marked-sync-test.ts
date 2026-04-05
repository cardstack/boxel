import { module, test } from 'qunit';

import {
  markedSync,
  markdownToHtml,
} from '@cardstack/runtime-common/marked-sync';

module('Unit | marked-sync', function () {
  test('markedSync converts markdown to HTML', function (assert) {
    const markdown = '# Hello\n**Bold text**';
    const result = markedSync(markdown);

    assert.true(
      result.includes('<h1 id="hello">Hello</h1>'),
      'converts heading correctly (with auto-generated id)',
    );
    assert.true(
      result.includes('<strong>Bold text</strong>'),
      'converts bold text correctly',
    );
  });

  test('markedSync renders code blocks with custom renderer', function (assert) {
    const markdown = '```javascript\nconst x = 1;\n```';
    const result = markedSync(markdown);

    assert.true(
      result.includes(
        '<pre data-code-language="javascript">const x = 1;</pre>',
      ),
      'adds language attribute to code blocks',
    );
  });

  test('markedSync renders code blocks without language specified', function (assert) {
    const markdown = '```\nconst x = 1;\n```';
    const result = markedSync(markdown);

    assert.true(
      result.includes('<pre data-code-language="">const x = 1;</pre>'),
      'adds empty language attribute when no language specified',
    );
  });

  test('markdownToHtml with normal input and default sanitize', function (assert) {
    const markdown = '# Hello <script>alert("XSS")</script>';
    const result = markdownToHtml(markdown);

    assert.true(result.includes('id="hello-'), 'heading has auto-generated id');
    assert.true(
      result.includes('>Hello </h1>'),
      'heading content was preserved',
    );
  });

  test('markdownToHtml with sanitize=false', function (assert) {
    const markdown = '# Hello <script>alert("XSS")</script>';
    const result = markdownToHtml(markdown, { sanitize: false });

    assert.true(
      result.includes('<script>alert("XSS")</script></h1>'),
      'returns unsanitized HTML',
    );
  });

  test('markdownToHtml with null input', function (assert) {
    const result = markdownToHtml(null);

    assert.strictEqual(result, '', 'returns empty string for null input');
  });

  test('markdownToHtml with undefined input', function (assert) {
    const result = markdownToHtml(undefined);

    assert.strictEqual(result, '', 'returns empty string for undefined input');
  });

  test('markdownToHtml with empty string input', function (assert) {
    const result = markdownToHtml('');

    assert.strictEqual(result, '', 'returns empty string for empty input');
  });

  test('markdownToHtml sanitizes potentially harmful HTML', function (assert) {
    const markdown = '[Click me](javascript:alert("XSS"))';
    const result = markdownToHtml(markdown);

    assert.false(
      result.includes('javascript:alert'),
      'javascript URLs are sanitized',
    );
  });

  test('markedSync handles inline code', function (assert) {
    const markdown = 'This is `inline code`';
    const result = markedSync(markdown);

    assert.true(
      result.includes('<code>inline code</code>'),
      'converts inline code correctly',
    );
  });

  test('markedSync handles blockquotes', function (assert) {
    const markdown = '> This is a blockquote';
    const result = markedSync(markdown);

    assert.true(
      result.includes('<blockquote>'),
      'converts blockquotes correctly',
    );
  });

  test('markedSync handles lists', function (assert) {
    const markdown = '- Item 1\n- Item 2\n- Item 3';
    const result = markedSync(markdown);

    assert.true(result.includes('<ul>'), 'converts unordered lists correctly');
    assert.true(
      result.includes('<li>Item 1</li>'),
      'converts unordered lists correctly',
    );
    assert.true(
      result.includes('<li>Item 2</li>'),
      'converts unordered lists correctly',
    );
    assert.true(
      result.includes('<li>Item 3</li>'),
      'converts unordered lists correctly',
    );
  });

  test('markedSync handles links', function (assert) {
    const markdown = '[Cardstack](https://cardstack.com)';
    const result = markedSync(markdown);

    assert.true(
      result.includes('<a href="https://cardstack.com">Cardstack</a>'),
      'converts links correctly',
    );
  });

  test('markedSync handles tables', function (assert) {
    const markdown = `
| Header 1 | Header 2 |
| -------- | -------- |
| Cell 1   | Cell 2   |
    `;
    const result = markedSync(markdown);

    assert.true(result.includes('<table>'), 'converts tables correctly');
    assert.true(
      result.includes('<th>Header 1</th>'),
      'converts tables correctly',
    );
    assert.true(
      result.includes('<td>Cell 1</td>'),
      'converts tables correctly',
    );
  });

  test('markedSync escapes HTML tags that appear within code fences with default options', function (assert) {
    const markdown = '```\n<code>\n```';
    const result = markedSync(markdown);

    assert.true(
      result.includes('&lt;code&gt;'),
      'escapes HTML tags within code fences tags',
    );
  });

  test('markedSync does not escape HTML tags that appear within code fences when escapeHtmlInCodeBlocks option is false', function (assert) {
    const markdown = '```\n<code>\n```';
    const result = markedSync(markdown, { escapeHtmlInCodeBlocks: false });

    assert.true(
      result.includes('<code>'),
      'escapes HTML tags within code fences tags',
    );
  });

  // ── BFM Layer 3: GFM Alerts (marked-alert) ──

  test('markedSync renders GFM note alert', function (assert) {
    const markdown = '> [!NOTE]\n> This is a note.';
    const result = markedSync(markdown);

    assert.true(
      result.includes('markdown-alert'),
      'output contains alert class',
    );
    assert.true(
      result.includes('markdown-alert-note'),
      'output contains note variant class',
    );
    assert.true(
      result.includes('This is a note.'),
      'alert content is rendered',
    );
  });

  test('markedSync renders GFM warning alert', function (assert) {
    const markdown = '> [!WARNING]\n> Be careful!';
    const result = markedSync(markdown);

    assert.true(
      result.includes('markdown-alert-warning'),
      'output contains warning variant class',
    );
  });

  // ── BFM Layer 3: Math / LaTeX (placeholder for lazy KaTeX) ──

  test('markedSync renders inline math as placeholder', function (assert) {
    const markdown = 'The formula $E = mc^2$ is famous.';
    const result = markedSync(markdown);

    assert.true(
      result.includes('class="math-placeholder"'),
      'output contains math placeholder class',
    );
    assert.true(
      result.includes('data-math="E = mc^2"'),
      'placeholder carries math expression in data attribute',
    );
    assert.true(
      result.includes('data-display="false"'),
      'inline math has display=false',
    );
  });

  test('markedSync renders block math as placeholder', function (assert) {
    const markdown = '$$\nx^2 + y^2 = z^2\n$$';
    const result = markedSync(markdown);

    assert.true(
      result.includes('<div class="math-placeholder"'),
      'block math uses a div placeholder',
    );
    assert.true(
      result.includes('data-display="true"'),
      'block math has display=true',
    );
  });

  // ── BFM Layer 3: Mermaid diagram placeholder ──

  test('markedSync renders mermaid code block as placeholder', function (assert) {
    const markdown = '```mermaid\nflowchart TD\n    A --> B\n```';
    const result = markedSync(markdown);

    assert.true(
      result.includes('<pre class="mermaid">'),
      'mermaid block uses mermaid class instead of data-code-language',
    );
    assert.true(
      result.includes('flowchart TD'),
      'mermaid source is preserved in placeholder',
    );
    assert.false(
      result.includes('data-code-language'),
      'mermaid block does not use code language attribute',
    );
  });

  // ── BFM Layer 3: Footnotes (marked-footnote) ──

  test('markedSync renders footnotes', function (assert) {
    const markdown =
      'Statement with a footnote[^1].\n\n[^1]: This is the footnote.';
    const result = markedSync(markdown);

    assert.true(
      result.includes('data-footnote-ref'),
      'output contains footnote reference',
    );
    assert.true(
      result.includes('This is the footnote.'),
      'footnote content is rendered',
    );
  });

  // ── BFM Layer 3: Extended Tables (marked-extended-tables) ──

  test('markedSync renders tables with colspan', function (assert) {
    const markdown = `
| H1      | H2      | H3      |
| ------- | ------- | ------- |
| This spans three ||          |
| A       | B       | C       |
`;
    const result = markedSync(markdown);

    assert.true(result.includes('<table>'), 'table is rendered');
    assert.true(result.includes('colspan'), 'colspan attribute is present');
  });

  // ── BFM Layer 3: Heading IDs (marked-gfm-heading-id) ──

  test('markedSync adds id attributes to headings', function (assert) {
    const markdown = '## My Section Title';
    const result = markedSync(markdown);

    assert.true(
      result.includes('id="my-section-title"'),
      'heading has a slug-based id attribute',
    );
  });

  test('markdownToHtml preserves GFM alert markup through sanitization', function (assert) {
    const markdown = '> [!NOTE]\n> Important info.';
    const result = markdownToHtml(markdown);

    assert.true(
      result.includes('markdown-alert'),
      'alert markup survives DOMPurify sanitization',
    );
  });

  test('markdownToHtml preserves math placeholder through sanitization', function (assert) {
    const markdown = 'Inline: $x^2$';
    const result = markdownToHtml(markdown);

    assert.true(
      result.includes('math-placeholder'),
      'math placeholder survives DOMPurify sanitization',
    );
    assert.true(
      result.includes('data-math'),
      'data-math attribute survives DOMPurify sanitization',
    );
  });

  test('markdownToHtml preserves footnote markup through sanitization', function (assert) {
    const markdown = 'Text[^1].\n\n[^1]: Footnote content.';
    const result = markdownToHtml(markdown);

    assert.true(
      result.includes('Footnote content.'),
      'footnote content survives DOMPurify sanitization',
    );
  });

  test('markdownToHtml preserves heading IDs through sanitization', function (assert) {
    const markdown = '## Test Heading';
    const result = markdownToHtml(markdown);

    assert.true(
      result.includes('id="test-heading"'),
      'heading ID survives DOMPurify sanitization',
    );
  });
});
