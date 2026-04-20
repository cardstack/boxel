import { module, test } from 'qunit';

import { markdownEscape } from '@cardstack/boxel-ui/helpers';

// markdownEscape emits CommonMark backslash escapes. Per the CommonMark spec
// (https://spec.commonmark.org/0.30/#backslash-escapes), any ASCII punctuation
// character that is backslash-escaped renders as the literal character. These
// unit tests verify that the helper emits the correct `\X` sequence for each
// metacharacter the spec treats as escapable — which is equivalent to a
// round-trip guarantee that the escaped output, parsed as markdown, yields
// the literal input text.

module('Unit | markdown-escape', function () {
  test('escapes asterisks (emphasis / bold / list)', function (assert) {
    assert.strictEqual(markdownEscape('*bold*'), '\\*bold\\*');
    assert.strictEqual(markdownEscape('**strong**'), '\\*\\*strong\\*\\*');
  });

  test('escapes underscores (emphasis / bold)', function (assert) {
    assert.strictEqual(markdownEscape('_em_'), '\\_em\\_');
    assert.strictEqual(markdownEscape('__strong__'), '\\_\\_strong\\_\\_');
  });

  test('escapes backticks (inline code / fences)', function (assert) {
    assert.strictEqual(markdownEscape('`code`'), '\\`code\\`');
    assert.strictEqual(markdownEscape('```'), '\\`\\`\\`');
  });

  test('escapes `#` (ATX headings)', function (assert) {
    assert.strictEqual(markdownEscape('# Heading'), '\\# Heading');
    assert.strictEqual(markdownEscape('## Sub'), '\\#\\# Sub');
    // `#` inside text is also escaped — `\#` renders as `#` literal, which
    // is harmless and avoids false-positive headings when a line happens to
    // begin with `#` after trimming.
    assert.strictEqual(markdownEscape('room #4'), 'room \\#4');
  });

  test('escapes `-` (unordered list / setext h2 / thematic break)', function (assert) {
    assert.strictEqual(markdownEscape('- item'), '\\- item');
    assert.strictEqual(markdownEscape('---'), '\\-\\-\\-');
    // Mid-text hyphens are also escaped; `\-` renders as `-`.
    assert.strictEqual(markdownEscape('sign-in'), 'sign\\-in');
  });

  test('escapes `+` (unordered list marker)', function (assert) {
    assert.strictEqual(markdownEscape('+ item'), '\\+ item');
    assert.strictEqual(markdownEscape('a + b'), 'a \\+ b');
  });

  test('escapes `>` (blockquote / HTML bracket)', function (assert) {
    assert.strictEqual(markdownEscape('> quote'), '\\> quote');
    assert.strictEqual(markdownEscape('a > b'), 'a \\> b');
  });

  test('escapes `[` and `]` (link / image text)', function (assert) {
    assert.strictEqual(markdownEscape('[link](url)'), '\\[link\\]\\(url\\)');
  });

  test('escapes `(` and `)` (link / image URL)', function (assert) {
    assert.strictEqual(markdownEscape('(paren)'), '\\(paren\\)');
  });

  test('escapes `!` (image marker)', function (assert) {
    assert.strictEqual(markdownEscape('![alt](src)'), '\\!\\[alt\\]\\(src\\)');
    assert.strictEqual(markdownEscape('Wow!'), 'Wow\\!');
  });

  test('escapes `|` (GFM table separator)', function (assert) {
    assert.strictEqual(markdownEscape('a | b'), 'a \\| b');
    assert.strictEqual(markdownEscape('| h |'), '\\| h \\|');
  });

  test('escapes `\\` (backslash)', function (assert) {
    assert.strictEqual(markdownEscape('\\'), '\\\\');
    assert.strictEqual(markdownEscape('a\\b'), 'a\\\\b');
    // A literal `\*` in the source should become `\\\*` so the parser sees
    // an escaped backslash followed by an escaped asterisk — preserving the
    // original two characters as literals.
    assert.strictEqual(markdownEscape('\\*'), '\\\\\\*');
  });

  test('escapes `<` and `>` (HTML / autolink brackets)', function (assert) {
    assert.strictEqual(
      markdownEscape('<script>alert(1)</script>'),
      '\\<script\\>alert\\(1\\)\\</script\\>',
    );
    assert.strictEqual(
      markdownEscape('<https://example.com>'),
      '\\<https://example.com\\>',
    );
  });

  test('escapes numeric list prefixes at line start (e.g. `1.`)', function (assert) {
    assert.strictEqual(markdownEscape('1. first'), '1\\. first');
    assert.strictEqual(markdownEscape('42. answer'), '42\\. answer');
    // Multi-line: each line-start numeric prefix gets escaped.
    assert.strictEqual(markdownEscape('1. one\n2. two'), '1\\. one\n2\\. two');
    // Indented list is also escaped (leading whitespace preserved).
    assert.strictEqual(markdownEscape('  3. indented'), '  3\\. indented');
    // Periods mid-sentence are NOT escaped — they are only meaningful as list
    // markers when at line start after digits.
    assert.strictEqual(markdownEscape('v1.2.3'), 'v1.2.3');
    assert.strictEqual(markdownEscape('End of sentence.'), 'End of sentence.');
  });

  test('escapes numeric list prefixes with `)` via always-escape', function (assert) {
    // `)` is always escaped, so `1)` at any position becomes `1\)`.
    assert.strictEqual(markdownEscape('1) first'), '1\\) first');
  });

  test('escapes `~` (GFM strikethrough)', function (assert) {
    assert.strictEqual(markdownEscape('~~del~~'), '\\~\\~del\\~\\~');
  });

  test('handles null input by returning empty string', function (assert) {
    assert.strictEqual(markdownEscape(null), '');
  });

  test('handles undefined input by returning empty string', function (assert) {
    assert.strictEqual(markdownEscape(undefined), '');
  });

  test('coerces non-string inputs via String()', function (assert) {
    assert.strictEqual(markdownEscape(42), '42');
    assert.strictEqual(markdownEscape(true), 'true');
    assert.strictEqual(markdownEscape(false), 'false');
    // Numbers containing a `.` are coerced to string but the `.` is only
    // escaped at line start after digits — which applies here.
    assert.strictEqual(markdownEscape(1.5), '1\\.5');
  });

  test('returns empty string for empty string input', function (assert) {
    assert.strictEqual(markdownEscape(''), '');
  });

  test('leaves safe characters untouched', function (assert) {
    assert.strictEqual(
      markdownEscape('Hello world, how are you today?'),
      'Hello world, how are you today?',
    );
  });

  test('handles combined metacharacters without double-escaping', function (assert) {
    // Input with many metacharacters — verify each is escaped exactly once.
    let input = '# Title *bold* _em_ `code` [link](url) | ~strike~';
    let expected =
      '\\# Title \\*bold\\* \\_em\\_ \\`code\\` \\[link\\]\\(url\\) \\| \\~strike\\~';
    assert.strictEqual(markdownEscape(input), expected);
  });
});
