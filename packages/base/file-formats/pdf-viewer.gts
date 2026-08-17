// The PDF family's renderer, projected into the four format shells by
// `FilePreviewStage`. The browser is the reader: embedded and isolated mount the
// document in a native `<object>` viewer (scrolling, selection, and search come
// for free), while the budgeted fitted cell shows a lightweight page placeholder
// rather than a live PDF engine per tile.
//
// The fitted first-page poster is deliberately not drawn here — it needs the
// derived-artifact contract (CS-12231) to rasterize and store a page image. Once
// that lands and populates `thumbnailUrl`, the preview stage prefers the real
// poster over this placeholder automatically, with no change to this component.
import GlimmerComponent from '@glimmer/component';

import { eq } from '@cardstack/boxel-ui/helpers';

import { FileObject } from './file-resources';
import type { FilePreviewSignature } from './file-preview-stage';

export class PdfViewer extends GlimmerComponent<FilePreviewSignature> {
  // The served document URL. The auth service worker injects the realm token on
  // the native `<object>` request, the same path `<img>`/`<audio>` use.
  get resourceUrl(): string {
    return this.args.model?.resourceUrl ?? this.args.model?.url ?? '';
  }

  get pageCount(): number | undefined {
    return this.args.model?.documentInfo?.pageCount;
  }

  get title(): string {
    return (
      this.args.model?.documentInfo?.title ||
      this.args.model?.baseName ||
      this.args.model?.name ||
      'PDF document'
    );
  }

  <template>
    {{#if (eq @mode 'fitted')}}
      <div class='pdf-fitted' data-test-pdf-fitted>
        <div class='page-mock'>
          <span class='page-badge'>PDF</span>
          {{#if this.pageCount}}
            <span class='page-count'>{{this.pageCount}}
              {{if (eq this.pageCount 1) 'page' 'pages'}}</span>
          {{/if}}
        </div>
      </div>
    {{else}}
      <FileObject
        class='pdf-object'
        @url={{this.resourceUrl}}
        @type='application/pdf'
        @label={{this.title}}
        data-test-pdf-viewer
      />
    {{/if}}

    <style scoped>
      /* Embedded/isolated: the native viewer fills the space the shell hands it
         and owns its own scrolling. */
      .pdf-object {
        display: block;
        width: 100%;
        height: 100%;
        min-height: 0;
        border: 0;
        background: var(--fd-stage, var(--muted, #eceef1));
      }

      /* Fitted: a page-shaped placeholder, not a PDF engine. It reads as "a
         document, N pages" until the poster contract renders a real first page. */
      .pdf-fitted {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        padding: 10px;
        background: var(--fd-stage, var(--muted, #eceef1));
        container-type: inline-size;
      }
      .page-mock {
        position: relative;
        width: min(72%, 8rem);
        aspect-ratio: 3 / 4;
        background: var(--card, #fff);
        border: 1px solid var(--border);
        border-radius: 3px;
        box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      /* The ruled lines that read as "page of text" behind the label. */
      .page-mock::before {
        content: '';
        position: absolute;
        inset: 14% 16%;
        background-image: repeating-linear-gradient(
          var(--border) 0 1px,
          transparent 1px 9px
        );
        opacity: 0.5;
      }
      .page-badge {
        position: relative;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: var(--fd-paper, var(--card, #f7f7f5));
        background: var(--fd-slate, var(--foreground));
        padding: 2px 8px;
        border-radius: 3px;
      }
      .page-count {
        position: relative;
        font-family: var(--font-mono);
        font-size: 0.5625rem;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}
