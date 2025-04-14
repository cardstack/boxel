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
      result.includes('<h1>Hello</h1>'),
      'converts heading correctly',
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

    assert.true(result.includes('<h1>Hello </h1>'), 'heading was preserved');
  });

  test('markdownToHtml with sanitize=false', function (assert) {
    const markdown = '# Hello <script>alert("XSS")</script>';
    const result = markdownToHtml(markdown, { sanitize: false });

    assert.true(
      result.includes('<h1>Hello <script>alert("XSS")</script></h1>'),
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
});
