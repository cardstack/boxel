// Pretui — CodeBlock: a plain, theme-coloured surface for code with a built-in tokenizer.
//
// A plain surface for code, which a kit whose differentiator is its agentic
// territory had no business lacking: `DiffBlock` renders a change and `Token`
// renders one machine value, but docs, logs, API responses, agent output and
// config snippets are none of those. Two independent sourcing passes named it.
//
// ── The syntax colours are theme tokens, and that is the whole trick ────
//
// Every highlighter ships a theme — a fixed list of hexes that looks wrong in
// any surrounding palette and needs a light fork and a dark fork. This one has
// no theme. Each token kind is ONE HUE token, dressed through Law 2:
//
//     color: color-mix(in oklch, var(--foreground) 18%, var(--hue));
//
// so the ink is derived from the same hue the season supplies, contrast holds
// in light and dark without a single dark branch, and a card recompiled into a
// season this component has never seen re-tints its code along with everything
// else. There are six hues, all `--pretui-code-*` knobs.
//
// ── Better than the inspiration ─────────────────────────────────────────
//
// The source (`code-snippet.gts`, plus the preview half of a `file-content`
// field) was the cleanest file in its corpus — zero hardcoded colours, zero
// timers — and still:
//
//  1. **Had no `<code>` element inside its `<pre>`**, and no `@language`: its
//     header read the literal, unlocalisable string `CODE`.
//  2. **Had no maximum height**, so a five-hundred-line snippet rendered five
//     hundred lines tall and pushed the page below it out of reach.
//  3. **Clamped the field variant with `-webkit-line-clamp: 6` and no way to
//     see the rest** — `overflow: hidden`, so long lines simply vanished.
//  4. **Had no accessible name on the region** and no line numbers.
//  5. Modelled `isBinary` and never consumed it, so a base64 blob rendered as
//     garbage. Here `@binary` is a real branch with a real message.
//
// ── Scope, named rather than hidden (Law 7) ─────────────────────────────
//
// The tokenizer is a LEXER, not a parser: it recognises comments, strings,
// numbers, keywords, names and punctuation, and it does not know scope, types
// or JSX. That is a deliberate trade — a real grammar means vendoring an
// engine, which Law 9 keeps out of the light packages, and a lexer is right
// far more often than it is wrong on the shapes people paste. Seven grammars
// ship (`ts`, `json`, `css`, `html`, `shell`, `sql`, `python`) with aliases;
// anything else renders as plain text, correctly, with no guessing. Above
// `@maxHighlightBytes` highlighting switches itself off rather than building
// a hundred thousand spans.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { CopyButton } from './copy-button';
import { cssStyle } from '../pretui-css';

// ═══════════════════════════════════════════════════════════════════════
// The lexer. Pure, deterministic, no DOM.
// Unit-tested in reading-code.test.gts
// ═══════════════════════════════════════════════════════════════════════

export type CodeTokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'name'
  | 'punct';

/** One run of same-kind characters. `cls` is precomputed so the template does
 * no work per token — a thousand-token block would otherwise call a helper a
 * thousand times per render. */
export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
  cls: string;
}

/** One rendered line. `marked` drives the highlight bar. */
export interface CodeLine {
  number: number;
  key: string;
  tokens: CodeToken[];
  marked: boolean;
}

type Rule = [CodeTokenKind, RegExp];

/** Sticky (`y`) so each rule is tried at exactly the current position — the
 * difference between a lexer and a global find-and-replace, and the reason a
 * keyword inside a string is not coloured as a keyword. */
function sticky(source: string, flags = ''): RegExp {
  return new RegExp(source, 'y' + flags);
}

const TS_KEYWORDS =
  'const|let|var|function|class|extends|implements|interface|type|enum|import|export|from|as|default|return|if|else|for|while|do|switch|case|break|continue|new|delete|typeof|instanceof|in|of|this|super|null|undefined|true|false|async|await|yield|try|catch|finally|throw|void|static|public|private|protected|readonly|abstract|declare|namespace|satisfies|keyof|infer|is|any|unknown|never|string|number|boolean|object|symbol|bigint';

const SQL_KEYWORDS =
  'select|from|where|group|by|order|having|join|inner|left|right|full|outer|on|as|and|or|not|null|is|in|like|between|insert|into|values|update|set|delete|create|table|alter|drop|index|view|union|all|distinct|limit|offset|with|case|when|then|else|end|asc|desc|primary|key|foreign|references|default|cast';

const PY_KEYWORDS =
  'def|class|return|if|elif|else|for|while|break|continue|pass|import|from|as|with|try|except|finally|raise|lambda|yield|global|nonlocal|assert|del|and|or|not|in|is|None|True|False|async|await|self';

const SHELL_KEYWORDS =
  'if|then|elif|else|fi|for|in|do|done|while|until|case|esac|function|return|export|local|readonly|source|set|unset|echo|cd|exit';

/**
 * The grammars, in priority order per language. First match at a position
 * wins, so comments and strings must come before everything they can contain.
 */
const GRAMMARS: Record<string, Rule[]> = {
  ts: [
    ['comment', sticky('//[^\\n]*')],
    ['comment', sticky('/\\*[\\s\\S]*?\\*/')],
    ['string', sticky('`(?:\\\\[\\s\\S]|[^`\\\\])*`')],
    ['string', sticky("'(?:\\\\.|[^'\\\\\\n])*'")],
    ['string', sticky('"(?:\\\\.|[^"\\\\\\n])*"')],
    ['number', sticky('0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?')],
    ['keyword', sticky('(?:' + TS_KEYWORDS + ')\\b')],
    ['name', sticky('[A-Za-z_$][\\w$]*(?=\\s*\\()')],
    ['name', sticky('[A-Z][\\w$]*')],
    ['plain', sticky('[A-Za-z_$][\\w$]*')],
    ['punct', sticky('[{}()\\[\\].,;:?!<>+\\-*/%=&|^~@]+')],
  ],
  json: [
    ['name', sticky('"(?:\\\\.|[^"\\\\])*"(?=\\s*:)')],
    ['string', sticky('"(?:\\\\.|[^"\\\\])*"')],
    ['number', sticky('-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?')],
    ['keyword', sticky('(?:true|false|null)\\b')],
    ['punct', sticky('[{}\\[\\],:]+')],
  ],
  css: [
    ['comment', sticky('/\\*[\\s\\S]*?\\*/')],
    ['string', sticky("'(?:\\\\.|[^'\\\\\\n])*'|\"(?:\\\\.|[^\"\\\\\\n])*\"")],
    ['keyword', sticky('@[\\w-]+')],
    ['name', sticky('--[\\w-]+')],
    ['number', sticky('#[0-9a-fA-F]{3,8}\\b|-?\\d*\\.?\\d+(?:%|[a-z]{1,4})?')],
    ['name', sticky('[-\\w]+(?=\\s*:)')],
    ['plain', sticky('[A-Za-z_-][\\w-]*')],
    ['punct', sticky('[{}()\\[\\].,;:>+~*=&|]+')],
  ],
  html: [
    ['comment', sticky('<!--[\\s\\S]*?-->')],
    ['keyword', sticky('</?[\\w:.-]+')],
    ['string', sticky('"(?:[^"]*)"|\'(?:[^\']*)\'')],
    ['name', sticky('[\\w:.-]+(?=\\s*=)')],
    ['punct', sticky('[<>/=]+')],
    // Three narrow fallbacks rather than one greedy one: a single catch-all
    // over `[^<>/="']+` swallows the whitespace AND the attribute name that
    // follows it, so the name rule above never gets a turn.
    ['plain', sticky('\\s+')],
    ['plain', sticky('[\\w:.-]+')],
    ['plain', sticky('[^<>/="\'\\s\\w:.-]+')],
  ],
  shell: [
    ['comment', sticky('#[^\\n]*')],
    ['string', sticky("'[^'\\n]*'|\"(?:\\\\.|[^\"\\\\\\n])*\"")],
    ['name', sticky('\\$\\{?[\\w]+\\}?')],
    ['number', sticky('\\b\\d+\\b')],
    ['keyword', sticky('(?:' + SHELL_KEYWORDS + ')\\b')],
    ['plain', sticky('[A-Za-z_][\\w.-]*')],
    ['punct', sticky('[|&;<>()$`\\\\"\'\\[\\]{}*?!=+~-]+')],
  ],
  sql: [
    ['comment', sticky('--[^\\n]*')],
    ['comment', sticky('/\\*[\\s\\S]*?\\*/')],
    ['string', sticky("'(?:''|[^'])*'")],
    ['number', sticky('\\b\\d+(?:\\.\\d+)?\\b')],
    ['keyword', sticky('(?:' + SQL_KEYWORDS + ')\\b', 'i')],
    ['plain', sticky('[A-Za-z_][\\w$]*')],
    ['punct', sticky('[(),.;*=<>+\\-/|]+')],
  ],
  python: [
    ['comment', sticky('#[^\\n]*')],
    ['string', sticky('"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'')],
    ['string', sticky("[rbfu]{0,2}'(?:\\\\.|[^'\\\\\\n])*'|[rbfu]{0,2}\"(?:\\\\.|[^\"\\\\\\n])*\"")],
    ['number', sticky('0[xXbBoO][0-9a-fA-F_]+|\\d[\\d_]*(?:\\.\\d[\\d_]*)?(?:[eE][+-]?\\d+)?')],
    ['keyword', sticky('(?:' + PY_KEYWORDS + ')\\b')],
    ['name', sticky('[A-Za-z_][\\w]*(?=\\s*\\()')],
    ['plain', sticky('[A-Za-z_][\\w]*')],
    ['punct', sticky('[{}()\\[\\].,;:=+\\-*/%<>!&|^~@]+')],
  ],
};

/** Language aliases, so `@language` takes whatever a fence or an extension
 * calls it. Anything not listed renders as plain text — correctly, and
 * without guessing. */
const ALIASES: Record<string, string> = {
  js: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  ts: 'ts',
  tsx: 'ts',
  gts: 'ts',
  gjs: 'ts',
  typescript: 'ts',
  javascript: 'ts',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  xml: 'html',
  svg: 'html',
  hbs: 'html',
  vue: 'html',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  console: 'shell',
  sql: 'sql',
  py: 'python',
  python: 'python',
};

/** The grammar key for a caller's language name, or `undefined` for plain. */
export function grammarFor(language: string | undefined): string | undefined {
  let key = (language ?? '').trim().toLowerCase();
  let resolved = ALIASES[key];
  return resolved && GRAMMARS[resolved] ? resolved : undefined;
}

/** A language guessed from a filename. Used only when `@language` is absent —
 * an explicit language always wins over an extension. */
export function languageForFilename(name: string | undefined): string | undefined {
  let match = /\.([a-z0-9]+)$/i.exec((name ?? '').trim());
  if (!match) {
    return undefined;
  }
  let ext = (match[1] ?? '').toLowerCase();
  return ALIASES[ext] ? ext : undefined;
}

const CLASS_FOR: Record<CodeTokenKind, string> = {
  plain: 'pretui-code-t',
  comment: 'pretui-code-t pretui-code-comment',
  string: 'pretui-code-t pretui-code-string',
  number: 'pretui-code-t pretui-code-number',
  keyword: 'pretui-code-t pretui-code-keyword',
  name: 'pretui-code-t pretui-code-name',
  punct: 'pretui-code-t pretui-code-punct',
};

/**
 * Code into typed runs.
 *
 * Adjacent runs of the same kind are merged, so a line of ordinary identifiers
 * and spaces is one span rather than thirty. With no grammar the whole input is
 * a single `plain` token, which is exactly what "no highlighting" should cost.
 */
export function tokenizeCode(
  code: string,
  language?: string,
): CodeToken[] {
  let text = code ?? '';
  let key = grammarFor(language);
  if (!key) {
    return text.length > 0
      ? [{ kind: 'plain', text, cls: CLASS_FOR.plain }]
      : [];
  }
  let rules = GRAMMARS[key] as Rule[];
  let out: CodeToken[] = [];
  const push = (kind: CodeTokenKind, chunk: string) => {
    let last = out[out.length - 1];
    if (last && last.kind === kind) {
      last.text = last.text + chunk;
      return;
    }
    out.push({ kind, text: chunk, cls: CLASS_FOR[kind] });
  };

  let at = 0;
  while (at < text.length) {
    let hit = false;
    for (let rule of rules) {
      let expression = rule[1];
      expression.lastIndex = at;
      let match = expression.exec(text);
      if (match && match[0].length > 0) {
        push(rule[0], match[0]);
        at = at + match[0].length;
        hit = true;
        break;
      }
    }
    if (!hit) {
      push('plain', text.charAt(at));
      at = at + 1;
    }
  }
  return out;
}

/**
 * `"3, 7-9"` or `[3, 7, 8, 9]` into a set of line numbers.
 *
 * A range whose ends are the wrong way round is read forwards rather than
 * refused — `9-7` means the same three lines and telling a caller off for it
 * buys nothing.
 */
export function parseLineSet(
  spec: string | number[] | undefined,
): Set<number> {
  let out = new Set<number>();
  if (Array.isArray(spec)) {
    for (let value of spec) {
      if (Number.isFinite(value)) {
        out.add(Math.floor(value));
      }
    }
    return out;
  }
  for (let chunk of String(spec ?? '').split(',')) {
    let range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(chunk);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      let lo = Math.min(a, b);
      let hi = Math.max(a, b);
      for (let n = lo; n <= hi; n++) {
        out.add(n);
      }
      continue;
    }
    let single = /^\s*(\d+)\s*$/.exec(chunk);
    if (single) {
      out.add(Number(single[1]));
    }
  }
  return out;
}

/**
 * Tokens split into lines.
 *
 * A single token can span newlines — a block comment, a template string, a
 * Python docstring — so the split happens AFTER tokenizing rather than before,
 * which is the difference between highlighting a multi-line string correctly
 * and highlighting only its first line.
 */
export function codeLines(
  code: string,
  options: {
    language?: string;
    startLine?: number;
    highlight?: string | number[];
  } = {},
): CodeLine[] {
  let marked = parseLineSet(options.highlight);
  let first = Math.max(1, Math.floor(options.startLine ?? 1));
  let tokens = tokenizeCode(code ?? '', options.language);
  let lines: CodeLine[] = [];
  let current: CodeToken[] = [];
  const close = () => {
    let number = first + lines.length;
    lines.push({
      number,
      key: String(number),
      tokens: current,
      marked: marked.has(number),
    });
    current = [];
  };
  for (let token of tokens) {
    let pieces = token.text.split('\n');
    for (let index = 0; index < pieces.length; index++) {
      if (index > 0) {
        close();
      }
      let piece = pieces[index] ?? '';
      if (piece.length > 0) {
        current.push({ kind: token.kind, text: piece, cls: token.cls });
      }
    }
  }
  close();
  // A trailing newline produces a final empty line that nobody wants to see.
  if (lines.length > 1) {
    let last = lines[lines.length - 1];
    if (last && last.tokens.length === 0) {
      lines.pop();
    }
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════════════════
// The component
// ═══════════════════════════════════════════════════════════════════════

export interface CodeBlockSignature {
  Args: {
    /** the source text, rendered as text nodes — never as markup */
    code?: string;
    /** language name or alias. Wins over an extension guessed from
     * `@filename`; anything unrecognised renders as plain text. */
    language?: string;
    /** shown in the header and used to guess the language when `@language` is
     * absent */
    filename?: string;
    /** a line of prose under the header */
    caption?: string;
    /** show the gutter. Numbers are `user-select: none` so a drag-select of
     * the code does not drag them along. */
    lineNumbers?: boolean;
    /** the number the first line carries — for an excerpt from the middle of
     * a file */
    startLine?: number;
    /** lines to mark, as `'3, 7-9'` or `[3, 7, 8, 9]`. The mark is a left bar
     * as well as a tint, so it survives greyscale. */
    highlight?: string | number[];
    /** soft-wrap long lines instead of scrolling sideways */
    wrap?: boolean;
    /** scroll ceiling, in lines. The source this replaced had none, so a
     * five-hundred-line snippet rendered five hundred lines tall. */
    maxLines?: number;
    /** hide the copy button */
    noCopy?: boolean;
    /** the region's accessible name; defaults to the filename or language */
    label?: string;
    /** the content is not text. Renders an explanation instead of a screen of
     * mojibake — the source modelled this flag and never consumed it. */
    binary?: boolean;
    /** above this many bytes, highlighting switches itself off rather than
     * building a span per token. The text still renders in full. */
    maxHighlightBytes?: number;
  };
  Element: HTMLElement;
}

const DEFAULT_MAX_HIGHLIGHT_BYTES = 80000;

export class CodeBlock extends Component<CodeBlockSignature> {
  private guid = guidFor(this);

  /** Expanded past the scroll ceiling. Reader-owned, so it survives arg
   * changes and never re-derives from render. */
  @tracked private expanded = false;

  get code(): string {
    return this.args.code ?? '';
  }

  /** An explicit language wins; otherwise the extension; otherwise plain. */
  get language(): string | undefined {
    if (this.args.language && this.args.language.trim().length > 0) {
      return this.args.language;
    }
    return languageForFilename(this.args.filename);
  }

  get grammar(): string | undefined {
    return grammarFor(this.language);
  }

  get tooBigToHighlight(): boolean {
    let ceiling = this.args.maxHighlightBytes ?? DEFAULT_MAX_HIGHLIGHT_BYTES;
    return this.code.length > ceiling;
  }

  get lines(): CodeLine[] {
    if (this.args.binary) {
      return [];
    }
    return codeLines(this.code, {
      language: this.tooBigToHighlight ? undefined : this.language,
      startLine: this.args.startLine,
      highlight: this.args.highlight,
    });
  }

  get lineCount(): number {
    return this.lines.length;
  }

  /** The line-count badge. A non-colour channel for "this is large", and the
   * one number the source's header should have carried instead of `CODE`. */
  get countText(): string {
    let total = this.lineCount;
    return total === 1 ? '1 line' : total + ' lines';
  }

  get headerTitle(): string {
    if (this.args.filename) {
      return this.args.filename;
    }
    if (this.language) {
      return this.language;
    }
    return 'Code';
  }

  get regionLabel(): string {
    if (this.args.label) {
      return this.args.label;
    }
    if (this.args.filename) {
      return 'Code from ' + this.args.filename;
    }
    return this.language ? this.language + ' code' : 'Code';
  }

  get maxLines(): number {
    return Math.max(1, Math.floor(this.args.maxLines ?? 24));
  }

  get clampable(): boolean {
    return !this.args.binary && this.lineCount > this.maxLines;
  }

  get clamped(): boolean {
    return this.clampable && !this.expanded;
  }

  /**
   * The ceiling, as a NUMBER in a custom property.
   *
   * The caller means a number of LINES, so the arithmetic belongs to CSS where
   * the line height already lives. Sending a number rather than a length also
   * means the only thing that ever reaches the style attribute is a digit
   * string — `cssStyle` validates it, and there is no caller text to guard.
   */
  get clampStyle() {
    return cssStyle('--pretui-code-max', String(this.maxLines));
  }

  get expandLabel(): string {
    if (this.expanded) {
      return 'Collapse';
    }
    return 'Show all ' + this.lineCount + ' lines';
  }

  get showCopy(): boolean {
    return this.args.noCopy !== true && this.code.length > 0;
  }

  /** Digits in the widest line number this block will draw. Emitted as a
   * custom property so the gutter sizes itself; only a digit string ever
   * reaches the style attribute, and `cssStyle` validates that. */
  get gutterDigits(): number {
    let last = Math.max(1, Math.floor(this.args.startLine ?? 1)) +
      Math.max(0, this.lineCount - 1);
    return Math.max(2, String(last).length);
  }

  get gutterStyle() {
    return cssStyle('--pretui-code-digits', String(this.gutterDigits));
  }

  /** The disclosure needs something to point `aria-controls` at, or nothing
   * tells assistive technology WHAT expanded. */
  get bodyId(): string {
    return this.guid + '-code';
  }

  get showGutter(): boolean {
    return this.args.lineNumbers === true && !this.args.binary;
  }

  get empty(): boolean {
    return !this.args.binary && this.code.length === 0;
  }

  toggleExpanded = () => {
    this.expanded = !this.expanded;
  };

  <template>
    <figure
      class='pretui-code'
      data-wrap={{if @wrap 'true' 'false'}}
      data-gutter={{if this.showGutter 'true' 'false'}}
      style={{this.gutterStyle}}
      data-test-pretui-code
      ...attributes
    >
      <figcaption class='pretui-code-head'>
        <span class='pretui-code-title' data-test-pretui-code-title>
          {{this.headerTitle}}
        </span>
        {{#unless @binary}}
          <span class='pretui-code-count'>{{this.countText}}</span>
        {{/unless}}
        {{#if this.showCopy}}
          <span class='pretui-code-actions'>
            <CopyButton
              @text={{this.code}}
              @label='Copy the code'
              @variant='ghost'
              data-test-pretui-code-copy
            />
          </span>
        {{/if}}
      </figcaption>

      {{#if @caption}}
        <p class='pretui-code-caption'>{{@caption}}</p>
      {{/if}}

      {{#if @binary}}
        <p class='pretui-code-binary' data-test-pretui-code-binary>
          This file is not text, so there is nothing to read here. Download it
          to open it in something that understands its format.
        </p>
      {{else if this.empty}}
        <p class='pretui-code-binary'>Nothing to show.</p>
      {{else}}
        {{! A scroll container must be reachable, so it takes focus and a name. }}
        <pre
          class='pretui-code-body'
          id={{this.bodyId}}
          tabindex='0'
          role='region'
          aria-label={{this.regionLabel}}
          data-clamped={{if this.clamped 'true' 'false'}}
          style={{if this.clamped this.clampStyle}}
          data-test-pretui-code-body
        ><code class='pretui-code-code'>{{#each this.lines key='key' as |line|}}<span
                class='pretui-code-line'
                data-marked={{if line.marked 'true' 'false'}}
              >{{#if this.showGutter}}<span
                    class='pretui-code-ln'
                    aria-hidden='true'
                  >{{line.number}}</span>{{/if}}<span
                  class='pretui-code-text'
                >{{#each line.tokens key='@index' as |part|}}<span
                      class={{part.cls}}
                    >{{part.text}}</span>{{/each}}</span></span>{{/each}}</code></pre>

        {{#if this.clampable}}
          <button
            type='button'
            class='pretui-code-more'
            aria-expanded={{if this.expanded 'true' 'false'}}
            aria-controls={{this.bodyId}}
            data-test-pretui-code-expand
            {{on 'click' this.toggleExpanded}}
          >{{this.expandLabel}}</button>
        {{/if}}
      {{/if}}
    </figure>
    <style scoped>
      @layer PretComponent {
        /* Law 1 — the surface's depth is one token, and nothing sets a border
           for separation. */
        .pretui-code {
          margin: 0;
          display: grid;
          border-radius: var(--radius);
          background: var(--card);
          box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
          overflow: hidden;
          container-type: inline-size;
        }
        .pretui-code-head {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          padding: var(--space-2, 6px) var(--space-3, 8px);
          background: color-mix(
            in oklch,
            var(--foreground) 4%,
            var(--card)
          );
          box-shadow: inset 0 -1px 0 var(--border);
        }
        .pretui-code-title {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--foreground);
        }
        .pretui-code-count {
          flex: 0 0 auto;
          font-size: var(--text-ui-xs, 10.5px);
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground);
        }
        .pretui-code-actions {
          flex: 0 0 auto;
          display: flex;
        }
        .pretui-code-caption {
          margin: 0;
          padding: var(--space-2, 6px) var(--space-3, 8px) 0;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-code-binary {
          margin: 0;
          padding: var(--space-4, 12px) var(--space-3, 8px);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
        }
        .pretui-code-body {
          margin: 0;
          padding: var(--space-3, 8px) 0;
          overflow: auto;
          font-family: var(--font-mono);
          font-size: var(--pretui-code-size, 12px);
          line-height: var(--pretui-code-leading, 1.6);
          /* Law 8 — code is numerals as often as it is words. */
          font-variant-numeric: tabular-nums;
          color: var(--foreground);
          tab-size: var(--pretui-code-tab, 2);
        }
        /* The scroll ceiling. `--pretui-code-max` is a line COUNT set from the
           component; the line height and font size are already tokens, so the
           arithmetic stays in CSS and no length is ever interpolated. */
        .pretui-code-body[data-clamped='true'] {
          max-height: calc(
            var(--pretui-code-max, 24) * var(--pretui-code-leading, 1.6) *
              var(--pretui-code-size, 12px) + var(--space-3, 8px) * 2
          );
        }
        .pretui-code-body:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        .pretui-code-code {
          display: block;
          font: inherit;
          min-width: max-content;
        }
        .pretui-code-line {
          display: block;
          padding-inline: var(--space-3, 8px);
          /* A blank line is still a line. Without this an empty block collapses
             to nothing and the code silently loses its paragraphing. */
          min-height: calc(var(--pretui-code-leading, 1.6) * 1em);
        }
        /* The mark carries a SHAPE as well as a tint (Appendix O.14), so it
           survives greyscale and a colour-blind reader. */
        .pretui-code-line[data-marked='true'] {
          background: color-mix(
            in oklch,
            var(--primary) 10%,
            transparent
          );
          box-shadow: inset 2px 0 0 var(--primary);
        }
        /* The gutter is as wide as the widest number it will hold. A fixed
           width overflows into the code the moment @startLine pushes the count
           to four digits, which is exactly what @startLine exists to allow. */
        .pretui-code-ln {
          display: inline-block;
          width: var(
            --pretui-code-gutter,
            calc(var(--pretui-code-digits, 2) * 1ch + 0.5ch)
          );
          margin-inline-end: var(--space-3, 8px);
          text-align: end;
          /* Not selectable, so dragging across the code does not drag the
             numbers into the clipboard with it. The prefix is not optional:
             without it iOS Safari selects them anyway, which is the platform
             where a drag-select is most likely. */
          -webkit-user-select: none;
          user-select: none;
          color: color-mix(
            in oklch,
            var(--muted-foreground) 65%,
            transparent
          );
        }
        .pretui-code-text {
          white-space: pre;
        }
        .pretui-code[data-wrap='true'] .pretui-code-body {
          overflow-x: hidden;
        }
        .pretui-code[data-wrap='true'] .pretui-code-code {
          min-width: 0;
        }
        .pretui-code[data-wrap='true'] .pretui-code-text {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        /* Law 2 applied to syntax: one hue in, ink derived from it, so contrast
           holds in light and dark with zero dark branches and a season this
           component has never seen re-tints the code with everything else. */
        .pretui-code-t {
          color: inherit;
        }
        .pretui-code-comment {
          color: color-mix(
            in oklch,
            var(--foreground) 8%,
            var(--pretui-code-comment, var(--muted-foreground))
          );
          font-style: italic;
        }
        .pretui-code-string {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-string, var(--chart-1))
          );
        }
        .pretui-code-number {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-number, var(--chart-3))
          );
        }
        .pretui-code-keyword {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-keyword, var(--chart-4))
          );
          font-weight: var(--weight-medium, 500);
        }
        .pretui-code-name {
          color: color-mix(
            in oklch,
            var(--foreground) 18%,
            var(--pretui-code-name, var(--chart-2))
          );
        }
        .pretui-code-punct {
          color: color-mix(
            in oklch,
            var(--muted-foreground) 70%,
            var(--foreground)
          );
        }
        .pretui-code-more {
          appearance: none;
          border: 0;
          width: 100%;
          padding: var(--space-2, 6px);
          background: color-mix(
            in oklch,
            var(--foreground) 4%,
            var(--card)
          );
          box-shadow: inset 0 1px 0 var(--border);
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--muted-foreground);
          cursor: pointer;
          transition: background-color 160ms
            var(--pretui-ease-snap, cubic-bezier(0.23, 1, 0.32, 1));
        }
        .pretui-code-more:hover {
          background: var(--hover, color-mix(in oklch, var(--foreground) 7%, var(--card)));
          color: var(--foreground);
        }
        .pretui-code-more:active {
          transform: scale(0.99);
        }
        .pretui-code-more:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: -2px;
        }
        @media (pointer: coarse) {
          .pretui-code-more {
            min-height: 44px;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .pretui-code-more {
            transition: none;
          }
          .pretui-code-more:active {
            transform: none;
          }
        }
      }
    </style>
  </template>
}
