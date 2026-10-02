// Pretui — CodeBlock usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { FreestyleUsage } from './freestyle-usage';
import { CodeBlock, grammarFor } from './code-block';

const LANGUAGES = [
  'ts',
  'json',
  'css',
  'html',
  'shell',
  'sql',
  'python',
  'rust',
];

/** Built by joining lines so no backtick-and-dollar template literal ever
 * appears in this module — one of those inside a `<template>` takes down the
 * parse for the whole realm. */
const TS_SAMPLE = [
  "// The word 'const' inside this comment is not a keyword.",
  "import { CodeBlock } from './code-block';",
  '',
  'export function render(source: string, language = "ts") {',
  '  /* A block comment',
  "     that spans lines and mentions a 'quote'. */",
  "  let url = 'https://example.com/not-a-comment';",
  '  return { source, language, url, size: 0x1f + 42.5 };',
  '}',
].join('\n');

const JSON_SAMPLE = [
  '{',
  '  "name": "@cardstack/pretui",',
  '  "version": "0.4.0",',
  '  "sideEffects": false,',
  '  "exports": { ".": "./index.js" },',
  '  "lines": 1234',
  '}',
].join('\n');

const CSS_SAMPLE = [
  '/* One hue in, a complete treatment out. */',
  '.chip {',
  '  --hue: var(--chart-1);',
  '  background: color-mix(in oklch, var(--hue) 14%, var(--card));',
  '  color: color-mix(in oklch, var(--foreground) 16%, var(--hue));',
  '}',
  '@container (max-width: 320px) {',
  '  .chip { inline-size: 100%; }',
  '}',
].join('\n');

const HTML_SAMPLE = [
  '<!-- a comment -->',
  '<figure class="code" data-lang="ts">',
  '  <figcaption>router.ts</figcaption>',
  '  <pre tabindex="0"><code>let a = 1;</code></pre>',
  '</figure>',
].join('\n');

const SHELL_SAMPLE = [
  '# publish one file and lint it from the realm',
  'export REALM="https://example.invalid/realm"',
  'if [ -f reading-code.gts ]; then',
  '  boxel file write reading-code.gts --realm "$REALM"',
  '  boxel lint reading-code.gts --realm "$REALM"',
  'fi',
].join('\n');

const SQL_SAMPLE = [
  '-- case-insensitive keywords, doubled quotes in a literal',
  'SELECT id, name, created_at',
  '  FROM component',
  " WHERE territory = 'reading' AND name <> 'o''brien'",
  ' ORDER BY created_at DESC',
  ' LIMIT 10;',
].join('\n');

const PYTHON_SAMPLE = [
  '# a docstring is one token, not three lines of guesswork',
  'def expand(rule, start, limit=10):',
  '    """Return the dates a rule generates.',
  '',
  '    Nothing here reads the clock.',
  '    """',
  '    return [start + n for n in range(limit)]',
].join('\n');

const RUST_SAMPLE = [
  '// Rust has no grammar here, so this renders as plain text —',
  '// correctly, in full, with no guessing.',
  'fn main() {',
  '    println!("hello");',
  '}',
].join('\n');

const SAMPLES: Record<string, string> = {
  ts: TS_SAMPLE,
  json: JSON_SAMPLE,
  css: CSS_SAMPLE,
  html: HTML_SAMPLE,
  shell: SHELL_SAMPLE,
  sql: SQL_SAMPLE,
  python: PYTHON_SAMPLE,
  rust: RUST_SAMPLE,
};

const FILENAMES: Record<string, string> = {
  ts: 'reading-code.gts',
  json: 'package.json',
  css: 'chip.css',
  html: 'figure.html',
  shell: 'publish.sh',
  sql: 'components.sql',
  python: 'expand.py',
  rust: 'main.rs',
};

const LONG_SAMPLE = Array.from(
  { length: 60 },
  (_value, index) =>
    'export const step' + index + " = { at: " + index + ", ok: true };",
).join('\n');

class CodeBlockUsage extends Component {
  @tracked language = 'ts';
  @tracked lineNumbers = true;
  @tracked wrap = false;
  @tracked maxLines = 24;
  @tracked startLine = 1;
  @tracked highlight = '6-7';
  @tracked caption = '';
  @tracked noCopy = false;
  @tracked binary = false;

  languageOptions = LANGUAGES;

  setLanguage = (v: string) => (this.language = v);
  setLineNumbers = (v: boolean) => (this.lineNumbers = v);
  setWrap = (v: boolean) => (this.wrap = v);
  setMaxLines = (v: number) => (this.maxLines = v);
  setStartLine = (v: number) => (this.startLine = v);
  setHighlight = (v: string) => (this.highlight = v);
  setCaption = (v: string) => (this.caption = v);
  setNoCopy = (v: boolean) => (this.noCopy = v);
  setBinary = (v: boolean) => (this.binary = v);

  get sample(): string {
    return SAMPLES[this.language] ?? TS_SAMPLE;
  }
  get filename(): string {
    return FILENAMES[this.language] ?? 'sample.txt';
  }
  get long(): string {
    return LONG_SAMPLE;
  }
  get recognised(): boolean {
    return grammarFor(this.language) !== undefined;
  }
  get grammarNote(): string {
    return this.recognised
      ? 'Grammar: ' + (grammarFor(this.language) ?? '')
      : 'No grammar for this language — the text renders plain, in full, with no guessing.';
  }

  get usage(): string {
    return (
      '<CodeBlock' +
      " @code={{this.source}} @language='" +
      this.language +
      "'" +
      " @filename='" +
      this.filename +
      "' @lineNumbers={{true}} />"
    );
  }

  <template>
    <FreestyleUsage
      @name='CodeBlock'
      @description='A plain surface for code — docs, logs, API responses, agent output, config. Seven grammars ship and anything else renders as plain text. The syntax colours are not a theme: each kind is one hue token dressed through Law 2, so contrast holds in light and dark with zero dark branches and a season this component has never seen re-tints the code with everything else.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-codedemo'>
          <CodeBlock
            @code={{this.sample}}
            @language={{this.language}}
            @filename={{this.filename}}
            @caption={{this.caption}}
            @lineNumbers={{this.lineNumbers}}
            @startLine={{this.startLine}}
            @highlight={{this.highlight}}
            @wrap={{this.wrap}}
            @maxLines={{this.maxLines}}
            @noCopy={{this.noCopy}}
            @binary={{this.binary}}
          />
          <p class='pretui-codedemo-note'>{{this.grammarNote}}</p>

          <p class='pretui-codedemo-cap'>A block past its ceiling</p>
          <CodeBlock
            @code={{this.long}}
            @language='ts'
            @filename='steps.ts'
            @lineNumbers={{true}}
            @maxLines={{8}}
          />
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='language'
          @value={{this.language}}
          @options={{this.languageOptions}}
          @description='Language name or alias. Wins over an extension guessed from the filename. Aliases cover js, jsx, tsx, gjs, gts, jsonc, scss, less, xml, svg, hbs, bash, zsh, console, py. Rust is in this list on purpose — it has no grammar, and the plain fallback is part of the contract.'
          @onInput={{this.setLanguage}}
        />
        <Args.Bool
          @name='lineNumbers'
          @value={{this.lineNumbers}}
          @defaultValue={{false}}
          @description='Show the gutter. Numbers are user-select: none, so dragging across the code does not drag them into the clipboard.'
          @onInput={{this.setLineNumbers}}
        />
        <Args.String
          @name='highlight'
          @value={{this.highlight}}
          @description='Lines to mark, as 3, 7-9 or an array. The mark is a left bar as well as a tint, so it survives greyscale.'
          @onInput={{this.setHighlight}}
        />
        <Args.Number
          @name='maxLines'
          @value={{this.maxLines}}
          @defaultValue={{24}}
          @min={{1}}
          @max={{200}}
          @description='Scroll ceiling, in lines. Past it the block scrolls and offers a way to see the rest — every line is always in the DOM, so the clamp is a viewport rather than a truncation.'
          @onInput={{this.setMaxLines}}
        />
        <Args.Number
          @name='startLine'
          @value={{this.startLine}}
          @defaultValue={{1}}
          @min={{1}}
          @max={{9999}}
          @description='The number the first line carries, for an excerpt from the middle of a file. Highlight numbers are read against it.'
          @onInput={{this.setStartLine}}
        />
        <Args.Bool
          @name='wrap'
          @value={{this.wrap}}
          @defaultValue={{false}}
          @description='Soft-wrap long lines instead of scrolling sideways.'
          @onInput={{this.setWrap}}
        />
        <Args.String
          @name='caption'
          @value={{this.caption}}
          @description='A line of prose under the header.'
          @onInput={{this.setCaption}}
        />
        <Args.Bool
          @name='noCopy'
          @value={{this.noCopy}}
          @defaultValue={{false}}
          @description='Hide the copy button. The button copies the source text, not the rendered DOM, so line numbers never travel with it.'
          @onInput={{this.setNoCopy}}
        />
        <Args.Bool
          @name='binary'
          @value={{this.binary}}
          @defaultValue={{false}}
          @description='The content is not text. Renders an explanation instead of a screen of mojibake — the source this replaced modelled this flag and never consumed it.'
          @onInput={{this.setBinary}}
        />
        <Args.Base
          @name='code'
          @typeLabel='String'
          @description='The source text. Rendered as text nodes throughout — nothing here is ever marked safe, so a snippet containing a script tag is a snippet containing a script tag.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='maxHighlightBytes'
          @typeLabel='Number'
          @description='Above this size highlighting switches itself off rather than building a span per token. The text still renders in full. Defaults to 80000.'
          @hideControls={{true}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-code-string'
          @type='color'
          @defaultValue='var(--chart-1)'
          @description='The hue for string literals. Ink is derived from it, so any hue keeps its contrast.'
        />
        <Css.Basic
          @name='pretui-code-keyword'
          @type='color'
          @defaultValue='var(--chart-4)'
          @description='The hue for keywords.'
        />
        <Css.Basic
          @name='pretui-code-name'
          @type='color'
          @defaultValue='var(--chart-2)'
          @description='The hue for names — call sites, types, JSON keys, tags.'
        />
        <Css.Basic
          @name='pretui-code-number'
          @type='color'
          @defaultValue='var(--chart-3)'
          @description='The hue for numeric and colour literals.'
        />
        <Css.Basic
          @name='pretui-code-comment'
          @type='color'
          @defaultValue='var(--muted-foreground)'
          @description='The hue for comments.'
        />
        <Css.Basic
          @name='pretui-code-size'
          @type='length'
          @defaultValue='12px'
          @description='Monospace size. The scroll ceiling is computed from it and the leading, so a caller who changes either gets the right number of lines.'
        />
        <Css.Basic
          @name='pretui-code-leading'
          @type='number'
          @defaultValue='1.6'
          @description='Line height.'
        />
        <Css.Basic
          @name='pretui-code-gutter'
          @type='length'
          @defaultValue='2.75em'
          @description='Gutter width. Widen it for a file with five-digit line numbers.'
        />
        <Css.Basic
          @name='pretui-code-tab'
          @type='number'
          @defaultValue='2'
          @description='Tab size.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-codedemo {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 620px;
      }
      .pretui-codedemo-note {
        margin: 0;
        min-height: 1.4em;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .pretui-codedemo-cap {
        margin: var(--space-3, 8px) 0 0;
        font-size: var(--text-ui-xs, 10.5px);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_CODE_BLOCK: Record<string, unknown> = {
  CodeBlock: CodeBlockUsage,
};
