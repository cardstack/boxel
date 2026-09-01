// The web family's renderer, projected into the format shells by
// `FilePreviewStage`. A detailed view shows the document the way a browser
// would — inside a sandboxed iframe in an opaque origin — with a source view
// beside it, because an HTML file is both a rendered page and inspectable
// markup. A fitted cell never mounts a frame: a collection of documents must
// not each fetch and execute a page, so it gets a static prose summary built
// from the extracted metadata.
//
// Sandbox posture: the source is fetched with the caller's session and handed
// to the frame as `srcdoc`, so the document renders from an opaque origin with
// no cookies, storage, or realm session. `allow-scripts` (without
// `allow-same-origin`) lets authored behavior run inside that isolation;
// powerful features are denied outright.
import { on } from '@ember/modifier';
import type Owner from '@ember/owner';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { eq } from '@cardstack/boxel-ui/helpers';

import type { FilePreviewSignature } from './file-preview-stage';

// Preserve the canonical FileDef URL inside a generated `<base>` element.
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Relative assets in the document resolve beside the file itself, not against
// the opaque `srcdoc` origin's meaningless base.
export function sourceWithBaseURL(source: string, sourceURL: string): string {
  let base = `<base href="${escapeAttribute(sourceURL)}">`;
  if (/<head(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${base}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(source)) {
    return source.replace(
      /<html(?:\s[^>]*)?>/i,
      (html) => `${html}<head>${base}</head>`,
    );
  }
  return `<head>${base}</head>${source}`;
}

const COPY_FEEDBACK_MS = 2000;

export class HtmlPreview extends GlimmerComponent<FilePreviewSignature> {
  @tracked view: 'rendered' | 'source' = 'rendered';
  @tracked sourceText: string | undefined;
  @tracked loadError = '';
  @tracked copyState: 'idle' | 'copied' | 'failed' = 'idle';
  copyFeedbackTimer?: ReturnType<typeof setTimeout>;

  constructor(owner: Owner, args: FilePreviewSignature['Args']) {
    super(owner, args);
    if (!this.isFitted && this.sourceUrl) {
      void this.loadSource();
    }
  }

  willDestroy() {
    super.willDestroy();
    if (this.copyFeedbackTimer) {
      clearTimeout(this.copyFeedbackTimer);
    }
  }

  get isFitted() {
    return this.args.format === 'fitted';
  }

  get sourceUrl() {
    return String(this.args.model?.resourceUrl ?? this.args.model?.url ?? '');
  }

  get frameTitle() {
    return `${
      this.args.model?.baseName ?? this.args.model?.name ?? 'HTML document'
    } preview`;
  }

  // One authenticated fetch serves both the rendered frame and the source
  // view. `same-origin` rather than `include`: the realm answers with
  // `Access-Control-Allow-Origin: *`, which a credentialed cross-origin
  // request rejects; the auth service worker carries the session instead.
  async loadSource() {
    try {
      let response = await fetch(this.sourceUrl, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        throw new Error(`HTML fetch failed with HTTP ${response.status}`);
      }
      let text = await response.text();
      if (this.isDestroyed || this.isDestroying) {
        return;
      }
      this.sourceText = text;
    } catch (error) {
      if (this.isDestroyed || this.isDestroying) {
        return;
      }
      this.loadError =
        error instanceof Error ? error.message : 'HTML preview unavailable';
    }
  }

  get framedSource() {
    if (this.sourceText == null) {
      return undefined;
    }
    return sourceWithBaseURL(this.sourceText, this.sourceUrl);
  }

  // Reads the extracted fields off the FileDef itself; the shared projection
  // doesn't carry an excerpt.
  get summaryTitle() {
    return (
      this.args.model?.title ??
      this.args.model?.htmlMetadata?.documentTitle ??
      this.args.model?.baseName ??
      ''
    );
  }

  get summaryExcerpt() {
    return String(this.args.model?.source?.excerpt ?? '');
  }

  showRendered = () => {
    this.view = 'rendered';
  };

  showSource = () => {
    this.view = 'source';
  };

  get copyLabel() {
    if (this.copyState === 'copied') {
      return 'Copied';
    }
    if (this.copyState === 'failed') {
      return 'Copy failed';
    }
    return 'Copy';
  }

  // Keep the clipboard write inside the gesture that asked for it. The write
  // can be refused (permissions, an unfocused document), and a refusal is
  // feedback for the button, not an unhandled rejection.
  copySource = async () => {
    if (this.sourceText == null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.sourceText);
      this.copyState = 'copied';
    } catch {
      this.copyState = 'failed';
    }
    if (this.copyFeedbackTimer) {
      clearTimeout(this.copyFeedbackTimer);
    }
    this.copyFeedbackTimer = setTimeout(() => {
      this.copyState = 'idle';
    }, COPY_FEEDBACK_MS);
  };

  <template>
    <div class='html-preview' data-mode={{@format}} data-test-html-preview>
      {{#if this.isFitted}}
        <div class='summary' data-test-html-summary>
          {{#if this.summaryTitle}}
            <strong class='summary-title'>{{this.summaryTitle}}</strong>
          {{/if}}
          {{#if this.summaryExcerpt}}
            <p class='summary-excerpt'>{{this.summaryExcerpt}}</p>
          {{/if}}
        </div>
      {{else if this.loadError}}
        <div class='load-error' data-test-html-load-error>
          <span>Preview unavailable</span>
          <span class='error-detail'>{{this.loadError}}</span>
        </div>
      {{else}}
        {{#if (eq this.view 'rendered')}}
          <iframe
            class='frame'
            title={{this.frameTitle}}
            sandbox='allow-scripts'
            referrerpolicy='no-referrer'
            allow="camera 'none'; microphone 'none'; geolocation 'none'"
            srcdoc={{this.framedSource}}
            data-test-html-frame
          ></iframe>
        {{else}}
          <pre class='source' data-test-html-source>{{this.sourceText}}</pre>
        {{/if}}
        <div class='controls'>
          <button
            type='button'
            class='control {{if (eq this.view "rendered") "active"}}'
            data-test-html-view-rendered
            {{on 'click' this.showRendered}}
          >Rendered</button>
          <button
            type='button'
            class='control {{if (eq this.view "source") "active"}}'
            data-test-html-view-source
            {{on 'click' this.showSource}}
          >Source</button>
          {{#if (eq this.view 'source')}}
            <button
              type='button'
              class='control'
              aria-live='polite'
              data-test-html-copy-source
              {{on 'click' this.copySource}}
            >{{this.copyLabel}}</button>
          {{/if}}
        </div>
      {{/if}}
    </div>
    <style scoped>
      .html-preview {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        isolation: isolate;
        background: var(--card, #fff);
      }
      .frame {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: var(--card, #fff);
      }
      .source {
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0.75rem;
        overflow: auto;
        font-family: var(--font-mono);
        font-size: 0.6875rem;
        line-height: 1.5;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: var(--foreground);
        background: var(--card, #fff);
      }
      .controls {
        position: absolute;
        z-index: 2;
        top: 0.5rem;
        right: 0.5rem;
        display: flex;
        gap: 0.25rem;
      }
      .control {
        min-height: 1.75rem;
        padding: 0 0.625rem;
        border: 1px solid var(--border);
        border-radius: 0.375rem;
        background: color-mix(in srgb, var(--card, #fff) 92%, transparent);
        color: var(--foreground);
        font-family: var(--font-mono);
        font-size: 0.625rem;
        font-weight: 600;
        cursor: pointer;
      }
      .control.active {
        background: var(--fd-slate, var(--foreground));
        border-color: var(--fd-slate, var(--foreground));
        color: var(--fd-paper, var(--card, #f7f7f5));
      }
      .summary {
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        padding: 0.625rem 0.75rem;
        overflow: hidden;
        text-align: left;
        background: var(--fd-paper, var(--card, #f7f7f5));
      }
      .summary-title {
        font-size: 0.75rem;
        font-weight: 600;
        line-height: 1.3;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }
      .summary-excerpt {
        margin: 0;
        font-size: 0.625rem;
        line-height: 1.5;
        color: var(--muted-foreground);
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 5;
        line-clamp: 5;
      }
      .load-error {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        padding: 0.625rem;
        color: var(--muted-foreground);
        font-size: 0.6875rem;
      }
      .error-detail {
        font-family: var(--font-mono);
        font-size: 0.5625rem;
      }
    </style>
  </template>
}
