import { byteStreamToUint8Array } from '@cardstack/runtime-common';
import { htmlSafe } from '@ember/template';
import FileCodeIcon from '@cardstack/boxel-icons/file-code';
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
import { highlightTs } from './ts-highlight';
export { highlightTs } from './ts-highlight';

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

// The family renderer the four shared shells mount into. Source code has no
// prose structure to render, so every format shows the bytes in a syntax-
// highlighted monospace column — the full source for embedded/isolated, the
// projection's already-budgeted head snippet for a fitted collection cell. The
// same renderer serves TypeScript and GTS: `highlightTs` marks up `<template>`
// tags too, so a `.gts` component reads correctly without a second pass.
class CodePreview extends GlimmerComponent<FilePreviewSignature> {
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

  // `highlightTs()` owns the whole rendering pipeline for this preview: it
  // escapes the source first and only adds the syntax-highlight wrappers we
  // control, so no second sanitizer pass reparses our own HTML during
  // prerender/indexing.
  get highlighted() {
    if (!this.hasContent) {
      return htmlSafe('');
    }
    return htmlSafe(highlightTs(this.content));
  }

  get truncated(): boolean {
    return (
      this.args.mode === 'fitted' && Boolean(this.args.model?.previewTruncated)
    );
  }

  <template>
    <div class='code-preview' data-mode={{@mode}} data-test-ts-preview>
      {{#if this.hasContent}}
        <pre class='code-preview__body'><code>{{this.highlighted}}</code></pre>
        {{#if this.truncated}}
          <div class='code-preview__more' aria-hidden='true'>…</div>
        {{/if}}
      {{else}}
        <p class='code-preview__empty'>No source content</p>
      {{/if}}
    </div>
    <style scoped>
      /* A code surface stays a dark editor panel in either theme: the syntax
         palette is tuned for a dark background and reads as "this is code". */
      .code-preview {
        width: 100%;
        height: 100%;
        min-height: 0;
        overflow: auto;
        background: var(--boxel-dark, #1e1e1e);
        color: var(--boxel-light, #d4d4d4);
        text-align: left;
      }
      .code-preview__body {
        margin: 0;
        padding: var(--boxel-sp-lg);
        font-family: var(
          --font-mono,
          var(--boxel-monospace-font-family, monospace)
        );
        font-size: 0.8125rem;
        line-height: 1.55;
        white-space: pre;
        overflow-wrap: normal;
      }
      /* Fitted cells get a smaller, denser head snippet capped by a fade so the
         clip reads as "there is more" rather than an abrupt cut. */
      .code-preview[data-mode='fitted'] {
        overflow: hidden;
        position: relative;
        -webkit-mask-image: linear-gradient(to bottom, black 72%, transparent);
        mask-image: linear-gradient(to bottom, black 72%, transparent);
      }
      .code-preview[data-mode='fitted'] .code-preview__body {
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-size: 0.6875rem;
        line-height: 1.5;
      }
      .code-preview__more {
        position: absolute;
        bottom: 2px;
        right: 8px;
        color: var(--boxel-400, #808080);
        font-size: 0.75rem;
      }
      .code-preview__empty {
        margin: 0;
        padding: var(--boxel-sp);
        color: var(--boxel-400, #808080);
        font-size: var(--boxel-font-sm);
      }

      /* VS Code Dark+ palette, shared by every code format. */
      .code-preview :deep(.ts-keyword) {
        color: #569cd6;
      }
      .code-preview :deep(.ts-string) {
        color: #ce9178;
      }
      .code-preview :deep(.ts-comment) {
        color: #6a9955;
        font-style: italic;
      }
      .code-preview :deep(.ts-decorator) {
        color: #dcdcaa;
      }
      .code-preview :deep(.ts-number) {
        color: #b5cea8;
      }
      .code-preview :deep(.ts-type) {
        color: #4ec9b0;
      }
    </style>
  </template>
}

class Head extends Component<typeof TsFileDef> {
  get title() {
    return (
      this.args.model?.title ??
      this.args.model?.name ??
      'Untitled TypeScript module'
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

export class TsFileDef extends FileDef {
  static displayName = 'TypeScript Module';
  static icon = FileCodeIcon;
  static acceptTypes = '.ts';
  static validExtensions = new Set(['.ts']);
  // CS-10787: language tag written into fenced code blocks in the markdown
  // representation. Subclasses (e.g. GtsFileDef) override this to identify
  // themselves to markdown renderers.
  static markdownLanguage = 'ts';

  // A `.ts`/`.gts` served without (or with an uninformative) content type would
  // route to a generic profile by extension alone, so pin the code axes the
  // four shells present — the family, the labeled kind, and the text renderer —
  // off the class rather than depending on every instance carrying
  // `text/typescript`.
  static fileFamily = 'code';
  static fileKind = 'TypeScript';
  static previewKind = 'code';
  static previewAdapter = 'text';
  static previewSource = 'extracted';

  @field title = contains(StringField);
  @field excerpt = contains(StringField);
  @field content = contains(StringField);
  // Surfaced by the shells as the hero fact ("N lines") and an isolated
  // inspector row, and cheap enough to read from the same decode.
  @field lineCount = contains(NumberField);

  // The bespoke isolated/embedded/fitted/atom are gone: TsFileDef (and every
  // subclass, e.g. GtsFileDef) now inherits the four shared shells from FileDef
  // and supplies only the renderer they mount, so identity, facts, budgets, and
  // state handling stay in one place across every file family.
  static previewComponent = CodePreview;
  static head: BaseDefComponent = Head;

  // CS-10787: emit the source as a fenced code block labeled with the
  // subclass's `markdownLanguage` (overridden by GtsFileDef). Empty content
  // produces an empty string.
  static markdown: BaseDefComponent = class Markdown extends Component<
    typeof TsFileDef
  > {
    get text() {
      let content = this.args.model?.content;
      if (!content) {
        return '';
      }
      let ctor = this.args.model?.constructor as typeof TsFileDef | undefined;
      let lang = ctor?.markdownLanguage ?? TsFileDef.markdownLanguage;
      return fencedCodeBlock(content, lang);
    }
    <template>{{this.text}}</template>
  };

  static async extractAttributes(
    this: typeof TsFileDef,
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
    if (!this.validExtensions.has(extension)) {
      throw new FileContentMismatchError(
        `Expected ${[...this.validExtensions].join(' or ')} file extension, got "${extension || 'none'}"`,
      );
    }

    let bytesPromise: Promise<Uint8Array> | undefined;
    let memoizedStream = async () => {
      bytesPromise ??= byteStreamToUint8Array(await getStream());
      return bytesPromise;
    };

    let base = await FileDef.extractAttributes(url, memoizedStream, options);
    let bytes = await memoizedStream();
    let source = new TextDecoder().decode(bytes);
    let fallbackTitle = fileNameWithoutExtension(base.name ?? '');

    return {
      ...base,
      title: fallbackTitle,
      excerpt: truncateExcerpt(source.replace(/\s+/g, ' ').trim()),
      content: source,
      // A trailing newline shouldn't inflate the count, and empty content is
      // zero lines rather than one.
      lineCount: source ? source.replace(/\n$/, '').split('\n').length : 0,
    };
  }
}
