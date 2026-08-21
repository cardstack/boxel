import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { htmlSafe } from '@ember/template';
import CsvIcon from '@cardstack/boxel-icons/csv';
import GlimmerComponent from '@glimmer/component';
import {
  type BaseDefComponent,
  Component,
  StringField,
  contains,
  containsMany,
  field,
} from './card-api';
import NumberField from './number';
import {
  FileContentMismatchError,
  FileDef,
  type ByteStream,
  type SerializedFile,
} from './file-api';
import type { FilePreviewSignature } from './file-formats/file-preview-stage';
import { fencedCodeBlock } from './markdown-helpers';

const EXCERPT_MAX_LENGTH = 500;
// An embedded cell shows the head of the table with a "… N more rows" note;
// the isolated view shows the whole thing.
const EMBEDDED_MAX_ROWS = 20;

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
  return name.replace(/\.[^/.]+$/, '');
}

function truncateExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_MAX_LENGTH - 3).trimEnd()}...`;
}

function parseCsv(text: string): string[][] {
  let rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    let ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i += 2;
        } else {
          i++;
        }
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

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

function csvToHtml(content: string, maxRows?: number): string {
  let rows = parseCsv(content);
  if (rows.length === 0) {
    return '';
  }

  let headers = rows[0];
  let bodyRows = rows.slice(1);
  let truncated = false;

  if (maxRows !== undefined && bodyRows.length > maxRows) {
    bodyRows = bodyRows.slice(0, maxRows);
    truncated = true;
  }

  let headerCells = headers.map((h) => tag('th', escapeHtml(h))).join('');
  let headRow = tag('tr', headerCells);
  let thead = tag('thead', headRow);

  let bodyHtml = bodyRows
    .map((row) => {
      let cells = headers
        .map((_, i) => {
          let cell = i < row.length ? row[i] : '';
          return tag('td', escapeHtml(cell));
        })
        .join('');
      return tag('tr', cells);
    })
    .join('');
  let tbody = tag('tbody', bodyHtml);

  let html = tag('table', thead + tbody);

  if (truncated) {
    let remaining = rows.length - 1 - (maxRows ?? 0);
    html += tag('p', `… ${remaining} more rows`, 'class="csv-truncated"');
  }

  return html;
}

// The family renderer the four shared shells mount into. A spreadsheet has a
// natural table view, so embedded/isolated render the parsed rows as a real
// table (embedded budgets to the head of the file; isolated shows all of it),
// while a fitted collection cell shows a glanceable row/column count summary
// rather than a table cropped to illegibility.
class CsvPreview extends GlimmerComponent<FilePreviewSignature> {
  get source(): any {
    return this.args.model?.source;
  }

  get content(): string {
    return String(this.source?.content ?? '');
  }

  get hasContent(): boolean {
    return Boolean(this.content.trim()) || this.rowCount > 0;
  }

  get isFitted(): boolean {
    return this.args.mode === 'fitted';
  }

  get rowCount(): number {
    return Number(this.source?.rowCount ?? 0);
  }

  get columnCount(): number {
    let declared = Number(this.source?.columnCount ?? 0);
    return declared || this.columns.length;
  }

  get columns(): string[] {
    return Array.from(this.source?.columns ?? []).map(String);
  }

  // Embedded shows the head of the table with a "… N more rows" note; isolated
  // shows every row. `csvToHtml` owns the whole pipeline: it escapes every cell
  // first and then assembles the markup, so no second sanitizer pass reparses
  // our own generated HTML during prerender/indexing.
  get tableHtml() {
    let maxRows =
      this.args.mode === 'embedded' ? EMBEDDED_MAX_ROWS : undefined;
    return htmlSafe(csvToHtml(this.content, maxRows));
  }

  <template>
    {{#if this.isFitted}}
      <div class='data-preview data-preview--fitted' data-test-csv-preview>
        {{#if this.hasContent}}
          <dl class='data-summary'>
            <div class='data-summary__metric'>
              <dt>rows</dt>
              <dd>{{this.rowCount}}</dd>
            </div>
            <div class='data-summary__metric'>
              <dt>cols</dt>
              <dd>{{this.columnCount}}</dd>
            </div>
          </dl>
        {{else}}
          <p class='data-preview__empty'>No rows</p>
        {{/if}}
      </div>
    {{else}}
      <div
        class='data-preview data-preview--table'
        data-mode={{@mode}}
        data-test-csv-preview
      >
        {{#if this.hasContent}}
          <div class='data-table'>{{this.tableHtml}}</div>
        {{else}}
          <p class='data-preview__empty'>No rows</p>
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      .data-preview {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: auto;
        background: var(--card);
        color: var(--foreground);
        text-align: left;
      }
      .data-preview--table {
        padding: var(--boxel-sp);
      }
      .data-table {
        width: 100%;
        overflow-x: auto;
      }
      .data-table :deep(table) {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--boxel-font-size-sm);
      }
      .data-table :deep(thead) {
        border-bottom: 2px solid var(--border);
      }
      .data-table :deep(th) {
        background: var(--muted);
        text-align: start;
        padding: var(--boxel-sp-2xs);
        font-weight: 600;
        white-space: nowrap;
      }
      .data-table :deep(th:not(:last-child)),
      .data-table :deep(td:not(:last-child)) {
        border-right: 1px solid var(--border);
      }
      .data-table :deep(td) {
        text-align: start;
        padding: var(--boxel-sp-2xs);
      }
      .data-table :deep(tr:not(:last-child) td) {
        border-bottom: 1px solid var(--border);
      }
      .data-table :deep(.csv-truncated) {
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
        margin: var(--boxel-sp-xs) 0 0;
      }

      /* Fitted: a pair of glanceable count tiles rather than a cropped table. */
      .data-preview--fitted {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }
      .data-summary {
        display: flex;
        gap: var(--boxel-sp);
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
        color: var(--foreground);
      }
      .data-summary__metric dt {
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted-foreground);
      }
      .data-preview__empty {
        margin: 0;
        padding: var(--boxel-sp);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

class Head extends Component<typeof CsvFileDef> {
  get title() {
    return this.args.model?.title ?? this.args.model?.name ?? 'Untitled CSV';
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

export class CsvFileDef extends FileDef {
  static displayName = 'CSV';
  static icon = CsvIcon;
  static acceptTypes = '.csv,text/csv';

  // A `.csv` served without (or with an uninformative) content type would route
  // to a generic profile by extension alone, so pin the data axes the four
  // shells present — the family, the labeled kind, and the data renderer — off
  // the class rather than depending on every instance carrying `text/csv`.
  static fileFamily = 'data';
  static fileKind = 'CSV data';
  static previewKind = 'csv';
  static previewAdapter = 'data';
  static previewSource = 'extracted';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);
  @field columns = containsMany(StringField);
  @field columnCount = contains(NumberField);
  @field rowCount = contains(NumberField);

  // The bespoke isolated/embedded/fitted/atom are gone: CsvFileDef now inherits
  // the four shared shells from FileDef and supplies only the renderer they
  // mount, so identity, facts, budgets, and state handling stay in one place
  // across every file family.
  static previewComponent = CsvPreview;
  static head: BaseDefComponent = Head;

  // CS-10787: emit the CSV source as a fenced `csv` code block. Empty
  // content produces an empty string.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof CsvFileDef
  > {
    get text() {
      let content = this.args.model?.content;
      if (!content) {
        return '';
      }
      return fencedCodeBlock(content, 'csv');
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
      columns: string[];
      columnCount: number;
      rowCount: number;
    }>
  > {
    let extension = getExtension(url);
    if (extension !== '.csv') {
      throw new FileContentMismatchError(
        `Expected .csv file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let csvText = new TextDecoder().decode(bytes);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');
    let rows = parseCsv(csvText);
    let columns = rows.length > 0 ? rows[0] : [];
    let columnCount = columns.length;
    let rowCount = rows.length > 0 ? rows.length - 1 : 0; // exclude header row

    return {
      ...base,
      title: fallbackTitle,
      excerpt: truncateExcerpt(csvText.trim()),
      content: csvText,
      columns,
      columnCount,
      rowCount,
    };
  }
}

export default CsvFileDef;
