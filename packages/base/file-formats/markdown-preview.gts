// The markdown family's renderer, projected into the four format shells by
// `FilePreviewStage` — and the content-only component an embedding author
// imports from the `file-formats/index` barrel to render a markdown file's
// content without any shell chrome.
//
// Embedded and isolated get the full Boxel-flavored-markdown render — rendered
// markdown with the linked-card and linked-file slots resolved — while a fitted
// collection cell gets a lighter, non-interactive rendition of the projection's
// already-budgeted head snippet, so a grid tile never mounts the
// slot-collection machinery over a truncated body.
import GlimmerComponent from '@glimmer/component';
import { cached } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';

import { isValidFormat } from '@cardstack/runtime-common';
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';

import MarkdownTemplate from '../default-templates/markdown';
import type { ContentPreviewSignature } from './file-preview-stage';
import {
  ensureFileViewModel,
  type FileFormat,
  type FileViewModel,
} from './file-view-model';

interface Signature extends ContentPreviewSignature {
  Args: ContentPreviewSignature['Args'] & {
    // `false` opts out of the container styles — the pane's sizing, scrolling,
    // surface colors, and reading-format padding — for an embedder that owns
    // its own geometry. The markdown content renders the same either way, and
    // a fitted rendition keeps its clipped-snippet treatment.
    displayContainer?: boolean;
  };
}

export class MarkdownPreview extends GlimmerComponent<Signature> {
  get format(): FileFormat {
    return this.args.format ?? 'embedded';
  }

  get displayContainer(): boolean {
    return this.args.displayContainer ?? true;
  }

  // A per-format styling hook (`md-preview--embedded`, `md-preview--isolated`,
  // …). `@format` arrives from dynamic card code, so gate the interpolation on
  // the known format names rather than trusting the string.
  get formatClass(): string | undefined {
    return isValidFormat(this.format)
      ? `md-preview--${this.format}`
      : undefined;
  }

  // `@model` is the FileDef instance in the content-only case and a prebuilt
  // view model when a shell is rendering; either way the reads below see the
  // shared projection.
  @cached
  get model(): FileViewModel {
    return ensureFileViewModel(this.args.model, this.format);
  }

  // The FileDef instance behind the shared projection, reached for the fields
  // the generic view model doesn't carry: the linked cards/files and the id the
  // BFM renderer resolves relative references against.
  get source(): any {
    return this.model.source;
  }

  get content(): string {
    if (this.isFitted) {
      // Budgeted in `fileViewModel`; a fitted cell never touches the whole
      // file — and the presence guard below judges the same bounded snippet
      // the cell draws, so the two can't disagree.
      return this.model.contentPreview ?? '';
    }
    return String(this.source?.content ?? '');
  }

  get hasContent(): boolean {
    return Boolean(this.content.trim());
  }

  get isFitted(): boolean {
    return this.format === 'fitted';
  }

  // `contentPreview` is truncated to the fitted character/line budget in
  // `fileViewModel`, so the snippet parse stays bounded no matter the file size.
  get snippetHtml() {
    return htmlSafe(markdownToHtml(this.model.contentPreview ?? ''));
  }

  <template>
    {{#if this.isFitted}}
      <div
        class='md-preview--fitted {{if this.displayContainer "md-preview"}}'
        data-mode={{this.format}}
        data-test-markdown-preview
      >
        {{#if this.hasContent}}
          <div class='md-snippet'>{{this.snippetHtml}}</div>
        {{else}}
          <p class='md-preview__empty'>No content</p>
        {{/if}}
      </div>
    {{else}}
      <div
        class='{{if this.displayContainer "md-preview md-preview--full"}}
          {{this.formatClass}}'
        data-mode={{this.format}}
        data-test-markdown-preview
      >
        {{#if this.hasContent}}
          <MarkdownTemplate
            @content={{this.content}}
            @linkedCards={{this.source.linkedCards}}
            @linkedFiles={{this.source.linkedFiles}}
            @cardReferenceBaseUrl={{this.source.id}}
          />
        {{else}}
          <p class='md-preview__empty'>No content</p>
        {{/if}}
      </div>
    {{/if}}
    <style scoped>
      @layer baseComponent {
        .md-preview {
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: auto;
          background: var(--md-preview-background, var(--card));
          color: var(--md-preview-foreground, var(--card-foreground));
          text-align: left;
        }
        .md-preview--full {
          padding: var(--md-preview-padding, var(--boxel-sp-lg));
        }
        .md-preview__empty {
          margin: 0;
          padding: var(--boxel-sp);
          color: var(--muted-foreground);
          font-size: var(--boxel-font-size-sm);
        }

        /* Fitted: a glanceable mini-page. Rendered, but with its own compact type
         scale and a fade so the clip reads as "more below". */
        .md-preview--fitted {
          overflow: hidden;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          -webkit-mask-image: linear-gradient(
            to bottom,
            black 74%,
            transparent
          );
          mask-image: linear-gradient(to bottom, black 74%, transparent);
        }
        .md-snippet {
          font-size: 0.6875rem;
          line-height: 1.5;
        }
        .md-snippet :deep(h1),
        .md-snippet :deep(h2),
        .md-snippet :deep(h3),
        .md-snippet :deep(h4) {
          font-weight: 700;
          font-size: 0.8125rem;
          margin: 0 0 0.25em;
          line-height: 1.25;
        }
        .md-snippet :deep(p),
        .md-snippet :deep(ul),
        .md-snippet :deep(ol) {
          margin: 0 0 0.5em;
        }
        .md-snippet :deep(ul),
        .md-snippet :deep(ol) {
          padding-left: 1.2em;
        }
        .md-snippet :deep(pre),
        .md-snippet :deep(code) {
          font-family: var(--font-mono, monospace);
          font-size: 0.625rem;
        }
        .md-snippet :deep(pre) {
          white-space: pre-wrap;
          overflow: hidden;
        }
        .md-snippet :deep(img) {
          max-width: 100%;
        }
      }
    </style>
  </template>
}
