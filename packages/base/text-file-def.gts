import {
  byteStreamToUint8Array,
  extensionOfIdentifier,
  nameWithoutExtension,
} from '@cardstack/runtime-common';
import TextFileIcon from '@cardstack/boxel-icons/file-text';
import GlimmerComponent from '@glimmer/component';
import type { BaseDefComponent } from './card-api';
import {
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
import { FILE_CONTENT_MAX_BYTES, headOfText } from './file-content-cap';

const EXCERPT_MAX_LENGTH = 500;

function truncateExcerpt(text: string): string {
  if (text.length <= EXCERPT_MAX_LENGTH) {
    return text;
  }
  return `${text.slice(0, EXCERPT_MAX_LENGTH - 3).trimEnd()}...`;
}

// The family renderer the four shared shells mount into. Plain text has no
// structure to render, so every format shows the bytes verbatim in a monospace
// column — full content for embedded/isolated, the projection's already-budgeted
// head snippet for a fitted collection cell.
class TextPreview extends GlimmerComponent<FilePreviewSignature> {
  get content(): string {
    let model = this.args.model;
    if (this.args.format === 'fitted') {
      // `contentPreview` is truncated to the fitted character/line budget in
      // `fileViewModel`, so a cell can never be handed the whole file.
      return model?.contentPreview ?? '';
    }
    return String(model?.source?.content ?? model?.contentPreview ?? '');
  }

  get hasContent(): boolean {
    return Boolean(this.content.trim());
  }

  get truncated(): boolean {
    return (
      this.args.format === 'fitted' &&
      Boolean(this.args.model?.previewTruncated)
    );
  }

  <template>
    <div class='text-preview' data-mode={{@format}} data-test-text-preview>
      {{#if this.hasContent}}
        <pre class='text-preview__body'>{{this.content}}</pre>
        {{#if this.truncated}}
          <div class='text-preview__more' aria-hidden='true'>…</div>
        {{/if}}
      {{else}}
        <p class='text-preview__empty'>No text content</p>
      {{/if}}
    </div>
    <style scoped>
      .text-preview {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: auto;
        background: var(--card);
        color: var(--foreground);
        text-align: left;
      }
      .text-preview__body {
        margin: 0;
        padding: var(--boxel-sp);
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: 0.8125rem;
        line-height: 1.55;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      /* Fitted cells get a smaller, denser head snippet capped by a fade so the
         clip reads as "there is more" rather than an abrupt cut. */
      .text-preview[data-mode='fitted'] {
        overflow: hidden;
        position: relative;
        -webkit-mask-image: linear-gradient(to bottom, black 72%, transparent);
        mask-image: linear-gradient(to bottom, black 72%, transparent);
      }
      .text-preview[data-mode='fitted'] .text-preview__body {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: 0.6875rem;
        line-height: 1.5;
      }
      .text-preview__more {
        position: absolute;
        bottom: 2px;
        right: 8px;
        color: var(--muted-foreground);
        font-size: 0.75rem;
      }
      .text-preview__empty {
        margin: 0;
        padding: var(--boxel-sp);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-sm);
      }
    </style>
  </template>
}

class Head extends Component<typeof TextFileDef> {
  get title() {
    return (
      this.args.model?.title ?? this.args.model?.name ?? 'Untitled text file'
    );
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

// The last whole lines of `text` that fit in `maxBytes` (UTF-16 code units,
// a close enough bound here), or all of it when it fits or there is no cap.
function tailLines(text: string, maxBytes: number | undefined): string {
  if (maxBytes === undefined || text.length <= maxBytes) {
    return text;
  }
  let tail = text.slice(text.length - maxBytes);
  let firstBreak = tail.indexOf('\n');
  return firstBreak === -1 ? '' : tail.slice(firstBreak + 1);
}

export class TextFileDef extends FileDef {
  static displayName = 'Text File';
  static icon = TextFileIcon;
  static acceptTypes = '.txt,.text,text/plain';
  // The extensions `extractAttributes` reads as this class's text. A subclass
  // bound to its own extension in the platform's extension table names it
  // here, since a file whose extension is not listed is refused as a content
  // mismatch rather than read.
  static textExtensions: readonly string[] = ['.txt', '.text'];
  // At most this many bytes of the text are kept as `content`: the last whole
  // lines that fit. Undefined keeps it all. An append-only log sets it, since
  // its file meta is re-read on every appended line and the whole log would
  // travel each time; its lines are read from the file itself, by range.
  static contentTailBytes: number | undefined = undefined;
  // Otherwise at most this many bytes are kept: the first whole lines that
  // fit (`file-content-cap.ts`). The file is always served whole.
  static contentMaxBytes: number | undefined = FILE_CONTENT_MAX_BYTES;

  // A `.txt` served without (or with an uninformative) content type would route
  // to a generic profile by extension alone, so pin the document axes the four
  // shells present — the family, the labeled kind, and the text renderer — off
  // the class rather than depending on every instance carrying `text/plain`.
  static fileFamily = 'document';
  static fileKind = 'Plain text';
  static previewKind = 'doc';
  static previewAdapter = 'text';
  static previewSource = 'extracted';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);
  // Surfaced by the shells as the hero fact ("N lines") and an isolated
  // inspector row, and cheap enough to read from the same decode.
  @field lineCount = contains(NumberField);

  // The bespoke isolated/embedded/fitted/atom are gone: TextFileDef now
  // inherits the four shared shells from FileDef and supplies only the renderer
  // they mount, so identity, facts, budgets, and state handling stay in one
  // place across every file family.
  static previewComponent = TextPreview;
  static head: BaseDefComponent = Head;

  // CS-10787: plain-text files emit as an unlabeled fenced code block so
  // arbitrary content (including markdown-looking text) doesn't get re-
  // interpreted as formatting by downstream consumers.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof TextFileDef
  > {
    get text() {
      let content = this.args.model?.content;
      if (!content) {
        return '';
      }
      return fencedCodeBlock(content);
    }
    <template>{{this.text}}</template>
  };

  static async extractAttributes(
    url: string,
    getStream: () => Promise<ByteStream>,
    options: {
      contentHash?: string;
      contentSize?: number;
      // Bytes `[start, end)` of the file, where the extractor can read a
      // range. A class that keeps only a tail (`contentTailBytes`, a log)
      // then reads its head for the excerpt and its tail for the content,
      // never the whole file, and leaves `lineCount` to the realm, which
      // counts a log's lines as it indexes them (`log-line-index.ts`).
      readRange?: (start: number, end: number) => Promise<Uint8Array>;
    } = {},
  ): Promise<
    SerializedFile<{
      title: string;
      excerpt: string;
      content: string;
      lineCount: number | null;
    }>
  > {
    let extension = extensionOfIdentifier(url);
    if (!this.textExtensions.includes(extension)) {
      throw new FileContentMismatchError(
        `Expected text file extension, got "${extension || 'none'}"`,
      );
    }
    let tailBytes = this.contentTailBytes;
    let size = options.contentSize;
    if (
      tailBytes !== undefined &&
      options.readRange &&
      options.contentHash &&
      size !== undefined
    ) {
      let base = await super.extractAttributes(url, getStream, options);
      // A head long enough for the excerpt in any encoding of it.
      let head = new TextDecoder().decode(
        await options.readRange(0, Math.min(size, EXCERPT_MAX_LENGTH * 4)),
      );
      let tailStart = Math.max(0, size - tailBytes);
      let tail = new TextDecoder().decode(
        await options.readRange(tailStart, size),
      );
      // Whole lines only: a tail that starts mid-line drops that line.
      if (tailStart > 0) {
        let firstBreak = tail.indexOf('\n');
        tail = firstBreak === -1 ? '' : tail.slice(firstBreak + 1);
      }
      let fallbackTitle = nameWithoutExtension(base.name ?? '');
      return {
        ...base,
        title: fallbackTitle || 'Untitled text file',
        excerpt: truncateExcerpt(head.trim()),
        content: tail,
        lineCount: null,
      };
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await super.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let text = new TextDecoder().decode(bytes);
    let fallbackTitle = nameWithoutExtension(base.name ?? '');

    return {
      ...base,
      title: fallbackTitle || 'Untitled text file',
      excerpt: truncateExcerpt(text.trim()),
      content:
        this.contentTailBytes === undefined
          ? headOfText(bytes, this.contentMaxBytes).text
          : tailLines(text, this.contentTailBytes),
      // A trailing newline shouldn't inflate the count, and empty content is
      // zero lines rather than one.
      lineCount: text ? text.replace(/\n$/, '').split('\n').length : 0,
    };
  }
}

export default TextFileDef;
