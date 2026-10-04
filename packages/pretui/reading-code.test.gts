// Pretui — proof for CodeBlock and its lexer.
//
// The invariant that matters most for a lexer is the boring one: **it must
// never lose or invent a character**. Every grammar is checked against it with
// a realistic sample, because a highlighter that silently drops a byte is
// worse than no highlighter at all — the reader copies code that does not run.
//
// After that, the cases that separate a lexer from a find-and-replace: a
// keyword inside a string, a comment inside a string, a string inside a
// comment, and a token that spans lines.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CodeBlock, codeLines, grammarFor, languageForFilename, parseLineSet, tokenizeCode } from './components/code-block';
import type { CodeTokenKind } from './components/code-block';
import { DEMOS_CODE_BLOCK } from './components/code-block.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_CODE_BLOCK };
const DEMOS_READING_CODE_NAMES = ['CodeBlock'];

const TS_SAMPLE = [
  '// a comment with the word const in it',
  "const greeting = 'hello, if you are reading this';",
  'export function greet(name: string): number {',
  '  /* a block comment',
  '     that runs across lines */',
  '  return 0x1f + 42.5;',
  '}',
].join('\n');

const SAMPLES: Array<[string, string]> = [
  ['ts', TS_SAMPLE],
  ['json', '{\n  "name": "pretui",\n  "count": 42,\n  "ok": true\n}'],
  ['css', '.a {\n  --hue: #10b981; /* c */\n  color: var(--hue);\n}'],
  ['html', '<!-- c -->\n<a href="/x" class=\'y\'>text &amp; more</a>'],
  ['shell', '# comment\nexport PATH="$HOME/bin:$PATH"\nif [ -f x ]; then echo 1; fi'],
  ['sql', "-- c\nSELECT id, name FROM t WHERE name = 'o''brien' LIMIT 10;"],
  ['python', '# c\ndef f(x):\n    """doc\n    string"""\n    return x + 1'],
  ['nothing-at-all', 'just some text\nwith two lines'],
];

function kindsOf(code: string, language: string): CodeTokenKind[] {
  return tokenizeCode(code, language).map((t) => t.kind);
}
function textOfKind(
  code: string,
  language: string,
  kind: CodeTokenKind,
): string[] {
  return tokenizeCode(code, language)
    .filter((t) => t.kind === kind)
    .map((t) => t.text);
}

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function bodyText(): string {
  let el = root().querySelector('[data-test-pretui-code-body]');
  return el?.textContent ?? '';
}
function renderedLines(): HTMLElement[] {
  return Array.from(root().querySelectorAll('.pretui-code-line'));
}

module('Pretui | reading-code | the lexer never loses a character', function () {
  test('every grammar reconstructs its input exactly', function (assert) {
    for (let [language, sample] of SAMPLES) {
      let joined = tokenizeCode(sample, language)
        .map((t) => t.text)
        .join('');
      assert.strictEqual(
        joined,
        sample,
        language + ' round-trips its sample byte for byte',
      );
    }
  });

  test('splitting into lines also loses nothing', function (assert) {
    for (let [language, sample] of SAMPLES) {
      let joined = codeLines(sample, { language })
        .map((line) => line.tokens.map((t) => t.text).join(''))
        .join('\n');
      assert.strictEqual(joined, sample, language + ' survives the line split');
    }
  });

  test('no grammar at all is one plain token, and costs nothing', function (assert) {
    let tokens = tokenizeCode('const x = 1', 'brainfuck');
    assert.strictEqual(tokens.length, 1);
    assert.strictEqual(tokens[0]?.kind, 'plain');
    assert.deepEqual(tokenizeCode('', 'ts'), [], 'and empty is empty');
  });
});

module('Pretui | reading-code | what separates a lexer from a regex', function () {
  test('a keyword inside a string is not a keyword', function (assert) {
    let strings = textOfKind("let a = 'return if else'", 'ts', 'string');
    assert.deepEqual(strings, ["'return if else'"]);
    let keywords = textOfKind("let a = 'return if else'", 'ts', 'keyword');
    assert.deepEqual(keywords, ['let'], 'only the real one');
  });

  test('a comment marker inside a string does not open a comment', function (assert) {
    let tokens = tokenizeCode("let url = 'https://example.com/x'; let b = 2", 'ts');
    assert.deepEqual(
      tokens.filter((t) => t.kind === 'comment'),
      [],
      'the // inside the URL is part of the string, not a comment',
    );
    assert.deepEqual(textOfKind("let url = 'https://example.com/x'; let b = 2", 'ts', 'number'), ['2']);
  });

  test('a quote inside a comment does not open a string', function (assert) {
    let tokens = tokenizeCode("// don't do this\nlet a = 1", 'ts');
    assert.strictEqual(tokens[0]?.kind, 'comment');
    assert.deepEqual(textOfKind("// don't do this\nlet a = 1", 'ts', 'string'), []);
  });

  test('a token that spans lines keeps its kind on every line', function (assert) {
    let lines = codeLines('/* one\n   two\n   three */\nlet a = 1', {
      language: 'ts',
    });
    for (let index = 0; index < 3; index++) {
      let line = lines[index];
      assert.strictEqual(
        line?.tokens[0]?.kind,
        'comment',
        'line ' + (index + 1) + ' of the block comment is still a comment',
      );
    }
    assert.strictEqual(lines[3]?.tokens[0]?.kind, 'keyword');
  });

  test('template literals span lines too', function (assert) {
    let lines = codeLines('let a = `one\ntwo`;', { language: 'ts' });
    assert.strictEqual(lines.length, 2);
    assert.strictEqual(lines[1]?.tokens[0]?.kind, 'string');
  });
});

module('Pretui | reading-code | the grammars', function () {
  test('typescript', function (assert) {
    assert.true(kindsOf(TS_SAMPLE, 'ts').indexOf('comment') !== -1);
    assert.deepEqual(textOfKind('let a = 0x1f + 42.5;', 'ts', 'number'), [
      '0x1f',
      '42.5',
    ]);
    assert.deepEqual(
      textOfKind('greet(name)', 'ts', 'name'),
      ['greet'],
      'a call site is a name',
    );
    assert.deepEqual(
      textOfKind('new Widget()', 'ts', 'name'),
      ['Widget'],
      'so is a capitalised identifier',
    );
  });

  test('json tells a key from a string value', function (assert) {
    let source = '{"a": "b"}';
    assert.deepEqual(textOfKind(source, 'json', 'name'), ['"a"']);
    assert.deepEqual(textOfKind(source, 'json', 'string'), ['"b"']);
  });

  test('css picks out custom properties and at-rules', function (assert) {
    let source = '@media (x) { --hue: #10b981; }';
    assert.deepEqual(textOfKind(source, 'css', 'keyword'), ['@media']);
    assert.true(textOfKind(source, 'css', 'name').indexOf('--hue') !== -1);
  });

  test('sql keywords are case-insensitive', function (assert) {
    assert.deepEqual(textOfKind('select 1', 'sql', 'keyword'), ['select']);
    assert.deepEqual(textOfKind('SELECT 1', 'sql', 'keyword'), ['SELECT']);
  });

  test('python docstrings are one string', function (assert) {
    assert.deepEqual(textOfKind('"""a\nb"""', 'python', 'string'), ['"""a\nb"""']);
  });

  test('html separates the tag, the attribute and its value', function (assert) {
    let source = '<a href="/x">t</a>';
    assert.true(textOfKind(source, 'html', 'keyword').indexOf('<a') !== -1);
    assert.deepEqual(textOfKind(source, 'html', 'name'), ['href']);
    assert.deepEqual(textOfKind(source, 'html', 'string'), ['"/x"']);
  });
});

module('Pretui | reading-code | language resolution', function () {
  test('aliases resolve, and anything else is plain', function (assert) {
    assert.strictEqual(grammarFor('tsx'), 'ts');
    assert.strictEqual(grammarFor('GTS'), 'ts');
    assert.strictEqual(grammarFor('bash'), 'shell');
    assert.strictEqual(grammarFor('rust'), undefined, 'no guessing');
    assert.strictEqual(grammarFor(undefined), undefined);
  });

  test('a filename supplies a language when none was named', function (assert) {
    assert.strictEqual(languageForFilename('app/router.ts'), 'ts');
    assert.strictEqual(languageForFilename('styles.SCSS'), 'scss');
    assert.strictEqual(languageForFilename('LICENSE'), undefined);
    assert.strictEqual(languageForFilename('data.parquet'), undefined);
  });
});

module('Pretui | reading-code | line sets', function () {
  test('ranges, singles and arrays', function (assert) {
    assert.deepEqual(Array.from(parseLineSet('3, 7-9')).sort(), [3, 7, 8, 9]);
    assert.deepEqual(Array.from(parseLineSet('2-999999999', 4)).sort(), [2, 3, 4], 'a huge range stops at the last line');
    let lines = codeLines('a\nb\nc', { highlight: '1-999999999' });
    assert.deepEqual(lines.map((l) => l.marked), [true, true, true], 'and codeLines clamps to its own length');
    assert.deepEqual(
      Array.from(parseLineSet('9-7')).sort(),
      [7, 8, 9],
      'a backwards range is read forwards rather than refused',
    );
    assert.deepEqual(Array.from(parseLineSet([2, 4])).sort(), [2, 4]);
    assert.deepEqual(Array.from(parseLineSet(undefined)), []);
    assert.deepEqual(Array.from(parseLineSet('nonsense')), []);
  });

  test('line numbering starts where the caller says', function (assert) {
    let lines = codeLines('a\nb', { startLine: 40 });
    assert.deepEqual(
      lines.map((l) => l.number),
      [40, 41],
    );
  });

  test('a trailing newline does not produce a phantom last line', function (assert) {
    assert.strictEqual(codeLines('a\nb\n').length, 2);
    assert.strictEqual(
      codeLines('a\n\nb').length,
      3,
      'but a real blank line in the middle is kept',
    );
  });
});

module('Pretui | reading-code | CodeBlock', function (hooks) {
  setupCardTest(hooks);

  test('the code renders as text, in lines, with a gutter', async function (assert) {
    const CODE = "const a = 1;\nconst b = 'two';";
    await render(
      <template>
        <CodeBlock
          @code={{CODE}}
          @language='ts'
          @filename='sample.ts'
          @lineNumbers={{true}}
        />
      </template>,
    );
    assert.strictEqual(renderedLines().length, 2);
    assert.true(bodyText().indexOf("const b = 'two';") !== -1);
    assert.true(
      (root().querySelector('[data-test-pretui-code-title]')?.textContent ?? '')
        .trim() === 'sample.ts',
      'the header names the file rather than the word CODE',
    );
    assert.ok(
      root().querySelector('[data-test-pretui-code-copy]'),
      'and carries a copy button',
    );
  });

  test('markup in the source is TEXT, never markup', async function (assert) {
    const CODE = '<script>alert(1)</script>';
    await render(<template><CodeBlock @code={{CODE}} @language='ts' /></template>);
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-code-body] script').length,
      0,
      'no element was created',
    );
    assert.true(bodyText().indexOf('<script>') !== -1, 'and it reads correctly');
  });

  test('marked lines carry a data flag as well as a tint', async function (assert) {
    const CODE = 'a\nb\nc\nd';
    await render(
      <template><CodeBlock @code={{CODE}} @highlight='2-3' /></template>,
    );
    assert.deepEqual(
      renderedLines().map((el) => el.getAttribute('data-marked')),
      ['false', 'true', 'true', 'false'],
    );
  });

  test('a long block clamps and offers a way to see the rest', async function (assert) {
    const CODE = Array.from({ length: 40 }, (_v, i) => 'line ' + i).join('\n');
    await render(
      <template><CodeBlock @code={{CODE}} @maxLines={{5}} /></template>,
    );
    let body = root().querySelector('[data-test-pretui-code-body]');
    assert.strictEqual(body?.getAttribute('data-clamped'), 'true');
    let more = root().querySelector(
      '[data-test-pretui-code-expand]',
    ) as HTMLButtonElement;
    assert.ok(more, 'the source this replaced clamped with no way out');
    assert.strictEqual(more.getAttribute('aria-expanded'), 'false');
    assert.true(more.textContent?.indexOf('40') !== -1, 'and says how much more');
    await click(more);
    assert.strictEqual(more.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-code-body]')
        ?.getAttribute('data-clamped'),
      'false',
    );
    assert.strictEqual(
      renderedLines().length,
      40,
      'every line was always in the DOM — the clamp is a viewport, not a truncation',
    );
  });

  test('a short block does not offer an expander it does not need', async function (assert) {
    const SHORT = 'a\nb';
    await render(
      <template><CodeBlock @code={{SHORT}} @maxLines={{20}} /></template>,
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-code-expand]').length,
      0,
    );
  });

  test('binary content says so instead of rendering mojibake', async function (assert) {
    // Deliberately NOT a NUL byte in the source: a NUL in a realm file 500s
    // the lint endpoint. Any non-text stand-in proves the same branch.
    const BINARY_BLOB = 'PK\u0003\u0004';
    await render(
      <template><CodeBlock @code={{BINARY_BLOB}} @binary={{true}} /></template>,
    );
    assert.ok(root().querySelector('[data-test-pretui-code-binary]'));
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-code-body]').length,
      0,
    );
  });

  test('the scroll container is reachable and named', async function (assert) {
    await render(<template><CodeBlock @code='a' @filename='x.ts' /></template>);
    let body = root().querySelector(
      '[data-test-pretui-code-body]',
    ) as HTMLElement;
    assert.strictEqual(body.getAttribute('tabindex'), '0');
    assert.strictEqual(body.getAttribute('role'), 'region');
    assert.true((body.getAttribute('aria-label') ?? '').indexOf('x.ts') !== -1);
  });

  test('the language is guessed from the filename only when none was named', async function (assert) {
    const CODE = 'const a = 1;';
    await render(
      <template><CodeBlock @code={{CODE}} @filename='a.ts' /></template>,
    );
    assert.true(
      root().querySelectorAll('.pretui-code-keyword').length > 0,
      'the extension supplied a grammar',
    );
    await render(
      <template>
        <CodeBlock @code={{CODE}} @filename='a.ts' @language='rust' />
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('.pretui-code-keyword').length,
      0,
      'and an explicit unknown language wins over the extension',
    );
  });
});

module('Pretui | reading-code | usage page', function (hooks) {
  setupCardTest(hooks);

  test('the demo renders', async function (assert) {
    for (let name of DEMOS_READING_CODE_NAMES) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
         DEMOS registries are Record<string, unknown> by contract. */
      let Page = PAGES[name] as any;
      await render(<template><Page /></template>);
      assert.true(
        (root().textContent ?? '').indexOf(name) !== -1,
        name + ' renders and names itself',
      );
    }
  });
});

// Three defects found by an independent read, fixed and pinned here.
module('Pretui | reading-code | the review fixes', function (hooks) {
  setupCardTest(hooks);

  test('the gutter widens for the widest line number it will hold', async function (assert) {
    const SHORT = 'a\nb\nc';
    await render(
      <template>
        <CodeBlock @code={{SHORT}} @lineNumbers={{true}} />
      </template>,
    );
    let figure = root().querySelector(
      '[data-test-pretui-code]',
    ) as HTMLElement;
    assert.strictEqual(
      figure.style.getPropertyValue('--pretui-code-digits').trim(),
      '2',
      'a three-line block needs two digits',
    );
    await render(
      <template>
        <CodeBlock @code={{SHORT}} @lineNumbers={{true}} @startLine={{1200}} />
      </template>,
    );
    assert.strictEqual(
      (root().querySelector('[data-test-pretui-code]') as HTMLElement).style
        .getPropertyValue('--pretui-code-digits')
        .trim(),
      '4',
      'and startLine can push it to four, which a fixed width would overflow',
    );
  });

  test('the disclosure names what it expands', async function (assert) {
    const LONG = Array.from({ length: 30 }, (_v, i) => 'line ' + i).join('\n');
    await render(
      <template><CodeBlock @code={{LONG}} @maxLines={{4}} /></template>,
    );
    let button = root().querySelector(
      '[data-test-pretui-code-expand]',
    ) as HTMLElement;
    let controls = button.getAttribute('aria-controls') ?? '';
    assert.true(controls.length > 0, 'aria-controls is present');
    assert.strictEqual(
      root().querySelector('[data-test-pretui-code-body]')?.id,
      controls,
      'and it points at the region that actually expands',
    );
  });
});
