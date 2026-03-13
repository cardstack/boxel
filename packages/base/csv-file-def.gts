import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { htmlSafe } from '@ember/template';
import CsvIcon from '@cardstack/boxel-icons/csv';
import {
  BaseDefComponent,
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

const EXCERPT_MAX_LENGTH = 500;

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

// content-tag misparses HTML tag literals in .gts files,
// so we build tags via helpers.
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
    html += tag('p', `\u2026 ${remaining} more rows`, 'class="csv-truncated"');
  }

  return html;
}

function csvTitle(
  model: { title?: string | null; name?: string | null } | null | undefined,
): string {
  return model?.title ?? model?.name ?? 'Untitled CSV';
}

class Isolated extends Component<typeof CsvFileDef> {
  get title() {
    return csvTitle(this.args.model);
  }

  get tableHtml() {
    // `csvToHtml()` owns the whole rendering pipeline here: it escapes every
    // cell value first and then assembles the table markup we control. A second
    // sanitizer pass only reparses our own generated HTML during
    // prerender/indexing and was showing up as avoidable DOMParser churn.
    return htmlSafe(csvToHtml(this.args.model?.content ?? ''));
  }

  get hasContent() {
    return Boolean(this.args.model?.content?.trim());
  }

  <template>
    <article class='csv-isolated' data-test-csv-isolated>
      <header class='csv-isolated__title'>{{this.title}}</header>
      {{#if this.hasContent}}
        <div class='csv-isolated__table'>{{this.tableHtml}}</div>
      {{/if}}
    </article>
    <style scoped>
      .csv-isolated {
        padding: var(--boxel-sp-lg);
        max-width: 100%;
      }

      .csv-isolated__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-size-lg);
        margin-bottom: var(--boxel-sp);
      }

      .csv-isolated__table {
        width: 100%;
        overflow-x: auto;
      }

      .csv-isolated__table :deep(table) {
        width: 100%;
        border-collapse: collapse;
      }

      .csv-isolated__table :deep(thead) {
        border-bottom: 2px solid var(--boxel-border-color);
      }

      .csv-isolated__table :deep(th) {
        background: var(--boxel-100);
        text-align: start;
        padding: var(--boxel-sp-2xs);
        font-weight: 600;
      }

      .csv-isolated__table :deep(th:not(:last-child)),
      .csv-isolated__table :deep(td:not(:last-child)) {
        border-right: 1px solid var(--boxel-border-color);
      }

      .csv-isolated__table :deep(td) {
        text-align: start;
        padding: var(--boxel-sp-2xs);
      }

      .csv-isolated__table :deep(tr:not(:last-child) td) {
        border-bottom: 1px solid var(--boxel-border-color);
      }
    </style>
  </template>
}

class Embedded extends Component<typeof CsvFileDef> {
  get title() {
    return csvTitle(this.args.model);
  }

  get tableHtml() {
    // `csvToHtml()` owns the whole rendering pipeline here: it escapes every
    // cell value first and then assembles the table markup we control. A second
    // sanitizer pass only reparses our own generated HTML during
    // prerender/indexing and was showing up as avoidable DOMParser churn.
    return htmlSafe(csvToHtml(this.args.model?.content ?? '', 20));
  }

  get hasContent() {
    return Boolean(this.args.model?.content?.trim());
  }

  <template>
    <article class='csv-embedded' data-test-csv-embedded>
      <header class='csv-embedded__title'>{{this.title}}</header>
      {{#if this.hasContent}}
        <div class='csv-embedded__content'>{{this.tableHtml}}</div>
      {{/if}}
    </article>
    <style scoped>
      .csv-embedded {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
      }

      .csv-embedded__title {
        color: var(--boxel-900);
        font-weight: 600;
      }

      .csv-embedded__content {
        max-height: 200px;
        overflow: hidden;
        mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
        -webkit-mask-image: linear-gradient(
          to bottom,
          black 60%,
          transparent 100%
        );
      }

      .csv-embedded__content :deep(table) {
        width: 100%;
        border-collapse: collapse;
      }

      .csv-embedded__content :deep(thead) {
        border-bottom: 2px solid var(--boxel-border-color);
      }

      .csv-embedded__content :deep(th) {
        background: var(--boxel-100);
        text-align: start;
        padding: var(--boxel-sp-2xs);
        font-weight: 600;
      }

      .csv-embedded__content :deep(th:not(:last-child)),
      .csv-embedded__content :deep(td:not(:last-child)) {
        border-right: 1px solid var(--boxel-border-color);
      }

      .csv-embedded__content :deep(td) {
        text-align: start;
        padding: var(--boxel-sp-2xs);
      }

      .csv-embedded__content :deep(tr:not(:last-child) td) {
        border-bottom: 1px solid var(--boxel-border-color);
      }

      .csv-embedded__content :deep(.csv-truncated) {
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
        margin: var(--boxel-sp-xs) 0 0;
      }
    </style>
  </template>
}

class Fitted extends Component<typeof CsvFileDef> {
  get title() {
    return csvTitle(this.args.model);
  }

  get excerpt() {
    return this.args.model?.excerpt ?? '';
  }

  get hasExcerpt() {
    return Boolean(this.excerpt);
  }

  <template>
    <article class='csv-fitted' data-test-csv-fitted>
      <div class='csv-fitted__icon'>
        <CsvIcon width='100%' height='100%' />
      </div>
      <div class='csv-fitted__text'>
        <header class='csv-fitted__title'>{{this.title}}</header>
        {{#if this.hasExcerpt}}
          <p class='csv-fitted__excerpt'>{{this.excerpt}}</p>
        {{/if}}
      </div>
    </article>
    <style scoped>
      .csv-fitted {
        container-name: fitted-card;
        container-type: size;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: flex-start;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        overflow: hidden;
      }

      .csv-fitted__icon {
        flex-shrink: 0;
        width: 20px;
        height: 20px;
        color: var(--boxel-600);
      }

      .csv-fitted__text {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-4xs);
      }

      .csv-fitted__title {
        color: var(--boxel-900);
        font-weight: 600;
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .csv-fitted__excerpt {
        color: var(--boxel-600);
        font-size: var(--boxel-font-xs);
        margin: 0;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 3;
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height >= 120px) {
        .csv-fitted {
          flex-direction: column;
          align-items: center;
          text-align: center;
        }

        .csv-fitted__icon {
          width: 28px;
          height: 28px;
        }

        .csv-fitted__title {
          -webkit-line-clamp: 3;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height < 120px) {
        .csv-fitted__excerpt {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and (height < 80px) {
        .csv-fitted__icon {
          display: none;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) {
        .csv-fitted {
          align-items: flex-start;
        }
      }

      @container fitted-card (1.0 < aspect-ratio) and (height < 80px) {
        .csv-fitted__excerpt {
          display: none;
        }
      }

      @container fitted-card (height <= 57px) {
        .csv-fitted__icon {
          display: none;
        }

        .csv-fitted__excerpt {
          display: none;
        }

        .csv-fitted__title {
          font-size: var(--boxel-font-xs);
          -webkit-line-clamp: 1;
        }
      }
    </style>
  </template>
}

class Atom extends Component<typeof CsvFileDef> {
  get title() {
    return csvTitle(this.args.model);
  }

  <template>
    <span class='csv-atom' data-test-csv-atom>
      <CsvIcon class='csv-atom__icon' width='16' height='16' />
      <span class='csv-atom__title'>{{this.title}}</span>
    </span>
    <style scoped>
      .csv-atom {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        min-width: 0;
      }

      .csv-atom__icon {
        flex-shrink: 0;
        color: var(--boxel-600);
      }

      .csv-atom__title {
        color: var(--boxel-900);
        font-size: var(--boxel-font-sm);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
  </template>
}

class Head extends Component<typeof CsvFileDef> {
  get title() {
    return csvTitle(this.args.model);
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

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);
  @field columns = containsMany(StringField);
  @field columnCount = contains(NumberField);
  @field rowCount = contains(NumberField);

  static isolated: BaseDefComponent = Isolated;
  static embedded: BaseDefComponent = Embedded;
  static fitted: BaseDefComponent = Fitted;
  static atom: BaseDefComponent = Atom;
  static head: BaseDefComponent = Head;

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
