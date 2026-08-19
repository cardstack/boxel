import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { htmlSafe } from '@ember/template';
import JsonIcon from '@cardstack/boxel-icons/json';
import GlimmerComponent from '@glimmer/component';
import {
  type BaseDefComponent,
  Component,
  NumberField,
  StringField,
  contains,
  field,
} from './card-api';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import type { FilePreviewSignature } from './file-formats/file-preview-stage';
import { fencedCodeBlock } from './markdown-helpers';

const EXCERPT_MAX_LENGTH = 500;
// A very large document would otherwise render into megabytes of tree markup;
// stop after this many nodes and show a truncation note. The embedded shell is
// a fixed-height pane inside a collection, so it gets a much smaller budget —
// the isolated view is where the whole document belongs.
const TREE_MAX_NODES = 2000;
const EMBEDDED_MAX_NODES = 200;
// Root and its direct children render expanded; deeper levels start collapsed.
const TREE_AUTO_OPEN_DEPTH = 1;

// content-tag misparses angle brackets inside regex literals in .gts files,
// so we use RegExp constructor instead.
const AMP_RE = new RegExp('&', 'g');
const LT_RE = new RegExp('<', 'g');
const GT_RE = new RegExp('>', 'g');
const QUOT_RE = new RegExp('"', 'g');
const APOS_RE = new RegExp("'", 'g');

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(AMP_RE, '&amp;')
    .replace(LT_RE, '&lt;')
    .replace(GT_RE, '&gt;')
    .replace(QUOT_RE, '&quot;')
    .replace(APOS_RE, '&#039;');
}

// content-tag misparses HTML tag literals in .gts files, so we build tags via
// helpers instead of writing them out.
function tag(name: string, content: string, attrs?: string): string {
  return attrs
    ? `<${name} ${attrs}>${content}</${name}>`
    : `<${name}>${content}</${name}>`;
}

function spanWrap(cls: string, content: string): string {
  return tag('span', content, `class="${cls}"`);
}

function getExtension(url: string): string {
  try {
    let parsed = new URL(url);
    let name = parsed.pathname.split('/').pop() ?? '';
    let dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot).toLowerCase();
  } catch {
    let dot = url.lastIndexOf('.');
    return dot === -1 ? '' : url.slice(dot).toLowerCase();
  }
}

function fileNameWithoutExtension(name: string): string {
  let dot = name.lastIndexOf('.');
  if (dot === -1) {
    return name;
  }
  let slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (dot < slash) {
    return name;
  }
  return name.slice(0, dot);
}

function truncateExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_MAX_LENGTH - 3).trimEnd()}...`;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
function kindOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

// The top-level entry count: object keys, array items, or 0 for a scalar root.
function entryCount(value: unknown): number {
  let kind = kindOf(value);
  if (kind === 'array') {
    return (value as unknown[]).length;
  }
  if (kind === 'object') {
    return Object.keys(value as object).length;
  }
  return 0;
}

function leafValueHtml(value: unknown, kind: string): string {
  if (kind === 'string') {
    return spanWrap('jt-string', escapeHtml(`"${value}"`));
  }
  if (kind === 'null') {
    return spanWrap('jt-null', 'null');
  }
  // number, boolean
  return spanWrap(`jt-${kind}`, escapeHtml(String(value)));
}

function keyLabelHtml(key: string | undefined): string {
  if (key === undefined) {
    return '';
  }
  return spanWrap('jt-key', escapeHtml(key)) + spanWrap('jt-colon', ': ');
}

interface TreeCtx {
  nodes: number;
  maxNodes: number;
  truncated: boolean;
}

function renderTreeNode(
  value: unknown,
  key: string | undefined,
  depth: number,
  ctx: TreeCtx,
): string {
  if (ctx.nodes >= ctx.maxNodes) {
    ctx.truncated = true;
    return '';
  }
  ctx.nodes++;

  let kind = kindOf(value);
  if (kind !== 'object' && kind !== 'array') {
    return tag('div', keyLabelHtml(key) + leafValueHtml(value, kind), 'class="jt-row"');
  }

  let entries: Array<[string, unknown]> =
    kind === 'array'
      ? (value as unknown[]).map((v, i) => [String(i), v])
      : Object.entries(value as Record<string, unknown>);
  let count = entries.length;
  let meta = kind === 'array' ? `[${count}]` : `{${count}}`;
  let summary = tag(
    'summary',
    keyLabelHtml(key) + spanWrap('jt-meta', meta),
    'class="jt-summary"',
  );

  let childrenHtml = '';
  for (let [childKey, childValue] of entries) {
    childrenHtml += renderTreeNode(childValue, childKey, depth + 1, ctx);
    if (ctx.truncated) {
      break;
    }
  }
  let children = tag('div', childrenHtml, 'class="jt-children"');

  let attrs =
    depth <= TREE_AUTO_OPEN_DEPTH ? 'class="jt-node" open' : 'class="jt-node"';
  return tag('details', summary + children, attrs);
}

function jsonToTreeHtml(parsed: JsonValue, maxNodes: number): string {
  let ctx: TreeCtx = { nodes: 0, maxNodes, truncated: false };
  let html = renderTreeNode(parsed, undefined, 0, ctx);
  if (ctx.truncated) {
    html += tag(
      'p',
      `… tree truncated at ${maxNodes} nodes`,
      'class="jt-truncated"',
    );
  }
  return html;
}

// The family renderer the four shared shells mount into. JSON has a natural
// hierarchy, so embedded/isolated render it as a collapsible key/value tree
// (native <details>, so it stays interactive even in prerendered HTML), while a
// fitted collection cell shows a glanceable type + entry-count summary. Invalid
// JSON still shows its raw text rather than an empty pane.
class JsonPreview extends GlimmerComponent<FilePreviewSignature> {
  get source(): any {
    return this.args.model?.source;
  }

  get content(): string {
    return String(this.source?.content ?? '');
  }

  get hasContent(): boolean {
    return Boolean(this.content.trim());
  }

  get isFitted(): boolean {
    return this.args.mode === 'fitted';
  }

  get parsed(): { ok: boolean; value?: JsonValue } {
    if (!this.hasContent) {
      return { ok: false };
    }
    try {
      return { ok: true, value: JSON.parse(this.content) as JsonValue };
    } catch {
      return { ok: false };
    }
  }

  // The tree markup is produced here: every key and value is escaped before it
  // is wrapped, so the resulting HTML is our own and needs no second sanitizer
  // pass during prerender/indexing.
  get treeHtml() {
    let { ok, value } = this.parsed;
    if (!ok) {
      return htmlSafe('');
    }
    let maxNodes =
      this.args.mode === 'embedded' ? EMBEDDED_MAX_NODES : TREE_MAX_NODES;
    return htmlSafe(jsonToTreeHtml(value as JsonValue, maxNodes));
  }

  get isValid(): boolean {
    return this.parsed.ok;
  }

  // A scalar/invalid document has no tree; show its raw text instead.
  get rawText(): string {
    return this.content;
  }

  // Fitted summary, read from the index-time facts so a cell never parses the
  // whole document.
  get rootType(): string {
    return String(this.source?.rootType ?? '');
  }

  get keyCount(): number {
    return Number(this.source?.keyCount ?? 0);
  }

  // `extractAttributes` stores an empty root type when the document didn't
  // parse, so an empty string here means "couldn't parse", not "no type".
  get isUnparsed(): boolean {
    return this.rootType === '';
  }

  get hasEntryCount(): boolean {
    return this.rootType === 'object' || this.rootType === 'array';
  }

  get countLabel(): string {
    if (this.rootType === 'array') {
      return this.keyCount === 1 ? 'item' : 'items';
    }
    if (this.rootType === 'object') {
      return this.keyCount === 1 ? 'key' : 'keys';
    }
    // A scalar root (top-level string/number/boolean/null) has no entries to
    // count; the summary shows its type as the fact instead.
    return 'value';
  }

  get countValue(): string {
    return this.hasEntryCount ? this.keyCount.toLocaleString() : this.rootType;
  }

  <template>
    {{#if this.isFitted}}
      <div class='data-preview data-preview--fitted' data-test-json-preview>
        {{#if this.hasContent}}
          {{#if this.isUnparsed}}
            <p class='data-preview__empty'>Invalid JSON</p>
          {{else}}
            <dl class='data-summary'>
              <div class='data-summary__metric'>
                <dt>{{this.countLabel}}</dt>
                <dd>{{this.countValue}}</dd>
              </div>
              {{#if this.hasEntryCount}}
                <div class='data-summary__type'>{{this.rootType}}</div>
              {{/if}}
            </dl>
          {{/if}}
        {{else}}
          <p class='data-preview__empty'>No content</p>
        {{/if}}
      </div>
    {{else}}
      <div
        class='data-preview data-preview--tree'
        data-mode={{@mode}}
        data-test-json-preview
      >
        {{#if this.hasContent}}
          {{#if this.isValid}}
            <div class='jt-tree'>{{this.treeHtml}}</div>
          {{else}}
            <pre class='jt-raw'>{{this.rawText}}</pre>
          {{/if}}
        {{else}}
          <p class='data-preview__empty'>No content</p>
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      /* A data inspector stays a dark panel in either theme: the type palette
         is tuned for a dark background and reads as "this is structured data". */
      .data-preview {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: auto;
        background: var(--boxel-dark, #1e1e1e);
        color: var(--boxel-light, #d4d4d4);
        text-align: left;
      }
      .data-preview--tree {
        padding: var(--boxel-sp);
      }
      .jt-tree {
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
      }
      .jt-tree :deep(.jt-node) {
        margin: 0;
      }
      .jt-tree :deep(.jt-summary) {
        cursor: pointer;
        list-style: revert;
      }
      .jt-tree :deep(.jt-children) {
        padding-left: 1.1em;
        border-left: 1px solid rgba(255, 255, 255, 0.12);
        margin-left: 0.3em;
      }
      .jt-tree :deep(.jt-row) {
        padding-left: 1.1em;
      }
      .jt-tree :deep(.jt-key) {
        color: #9cdcfe;
      }
      .jt-tree :deep(.jt-colon) {
        color: var(--boxel-light, #d4d4d4);
      }
      .jt-tree :deep(.jt-string) {
        color: #ce9178;
      }
      .jt-tree :deep(.jt-number) {
        color: #b5cea8;
      }
      .jt-tree :deep(.jt-boolean),
      .jt-tree :deep(.jt-null) {
        color: #569cd6;
      }
      .jt-tree :deep(.jt-meta) {
        color: #808080;
      }
      .jt-tree :deep(.jt-truncated) {
        color: #808080;
        font-size: var(--boxel-font-size-xs);
        margin: var(--boxel-sp-xs) 0 0;
      }
      .jt-raw {
        margin: 0;
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: var(--boxel-font-size-sm);
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }

      /* Fitted: a glanceable count + type rather than a cropped tree. */
      .data-preview--fitted {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .data-summary {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        margin: 0;
      }
      .data-summary__metric {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-5xs);
      }
      .data-summary__metric dd {
        margin: 0;
        font-weight: 700;
        font-size: var(--boxel-font-size-lg);
        line-height: 1;
      }
      .data-summary__metric dt {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #9d9d9d;
      }
      .data-summary__type {
        font-size: var(--boxel-font-size-xs);
        color: #9d9d9d;
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
      }
      .data-preview__empty {
        margin: 0;
        padding: var(--boxel-sp);
        color: #9d9d9d;
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

class Head extends Component<typeof JsonFileDef> {
  get title() {
    return this.args.model?.title ?? this.args.model?.name ?? 'Untitled JSON';
  }

  get description() {
    return this.args.model?.excerpt;
  }

  <template>
    {{! template-lint-disable no-forbidden-elements }}
    <title data-test-card-head-title>{{this.title}}</title>

    <meta property='og:title' content={{this.title}} />
    <meta name='twitter:title' content={{this.title}} />
    <meta property='og:url' content={{@model.id}} />

    {{#if this.description}}
      <meta name='description' content={{this.description}} />
      <meta property='og:description' content={{this.description}} />
      <meta name='twitter:description' content={{this.description}} />
    {{/if}}

    <meta name='twitter:card' content='summary' />
    <meta property='og:type' content='article' />
  </template>
}

export class JsonFileDef extends FileDef {
  static displayName = 'JSON';
  static icon = JsonIcon;
  static acceptTypes = '.json,application/json';

  // A `.json` served without (or with an uninformative) content type would
  // route to a generic profile by extension alone, so pin the data axes the
  // four shells present — the family, the labeled kind, and the data renderer —
  // off the class rather than depending on every instance carrying
  // `application/json`.
  static fileFamily = 'data';
  static fileKind = 'JSON';
  static previewKind = 'json';
  static previewAdapter = 'data';
  static previewSource = 'extracted';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);
  // Structural facts computed once at index time so a fitted cell never parses
  // the document. `rootType` and `keyCount` drive the fitted preview's summary;
  // `lineCount` is what the shells present as the hero fact.
  @field rootType = contains(StringField);
  @field keyCount = contains(NumberField);
  @field lineCount = contains(NumberField);

  // The bespoke isolated/embedded/fitted/atom are gone: JsonFileDef now inherits
  // the four shared shells from FileDef and supplies only the renderer they
  // mount, so identity, facts, budgets, and state handling stay in one place
  // across every file family.
  static previewComponent = JsonPreview;
  static head: BaseDefComponent = Head;

  // CS-10787: emit the JSON source as a fenced `json` code block. Empty
  // content produces an empty string.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof JsonFileDef
  > {
    get text() {
      let content = this.args.model?.content;
      if (!content) {
        return '';
      }
      return fencedCodeBlock(content, 'json');
    }
    <template>{{this.text}}</template>
  };

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{
      title: string;
      excerpt: string;
      content: string;
      rootType: string;
      keyCount: number;
      lineCount: number;
    }>
  > {
    let extension = getExtension(url);
    if (extension !== '.json') {
      throw new FileContentMismatchError(
        `Expected .json file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let text = new TextDecoder().decode(bytes);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');

    // Parse once for the structural facts; invalid JSON keeps its content and
    // reports an empty root rather than failing the whole file.
    let rootType = '';
    let keyCount = 0;
    try {
      let parsed = JSON.parse(text) as JsonValue;
      rootType = kindOf(parsed);
      keyCount = entryCount(parsed);
    } catch {
      rootType = '';
      keyCount = 0;
    }

    return {
      ...base,
      title: fallbackTitle || 'Untitled JSON',
      excerpt: truncateExcerpt(text.trim()),
      content: text,
      rootType,
      keyCount,
      // Normalize CRLF/CR to LF first so the count is the same across newline
      // styles; a trailing newline shouldn't inflate the count, and empty
      // content is zero lines.
      lineCount: text
        ? text
            .replace(/\r\n?/g, '\n')
            .replace(/\n$/, '')
            .split('\n').length
        : 0,
    };
  }
}

export default JsonFileDef;
