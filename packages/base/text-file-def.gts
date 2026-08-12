import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import TextFileIcon from '@cardstack/boxel-icons/file-text';
import GlimmerComponent from '@glimmer/component';
import {
  BaseDefComponent,
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

const TEXT_EXTENSIONS = new Set(['.txt', '.text']);
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

// The family renderer the four shared shells mount into. Plain text has no
// structure to render, so every format shows the bytes verbatim in a monospace
// column — full content for embedded/isolated, the projection's already-budgeted
// head snippet for a fitted collection cell.
class TextPreview extends GlimmerComponent<FilePreviewSignature> {
  get content(): string {
    let model = this.args.model;
    if (this.args.mode === 'fitted') {
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
    return this.args.mode === 'fitted' && Boolean(this.args.model?.previewTruncated);
  }

  <template>
    <div class='text-preview' data-mode={{@mode}} data-test-text-preview>
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
        font-family: var(--font-mono, var(--boxel-monospace-font-family, monospace));
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

export class TextFileDef extends FileDef {
  static displayName = 'Text File';
  static icon = TextFileIcon;
  static acceptTypes = '.txt,.text,text/plain';

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
    options: { contentHash?: string } = {},
  ): Promise<
    SerializedFile<{
      title: string;
      excerpt: string;
      content: string;
      lineCount: number;
    }>
  > {
    let extension = getExtension(url);
    if (!TEXT_EXTENSIONS.has(extension)) {
      throw new FileContentMismatchError(
        `Expected text file extension, got "${extension || 'none'}"`,
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

    return {
      ...base,
      title: fallbackTitle || 'Untitled text file',
      excerpt: truncateExcerpt(text.trim()),
      content: text,
      // A trailing newline shouldn't inflate the count, and empty content is
      // zero lines rather than one.
      lineCount: text ? text.replace(/\n$/, '').split('\n').length : 0,
    };
  }
}
