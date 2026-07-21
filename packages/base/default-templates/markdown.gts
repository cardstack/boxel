import { task } from 'ember-concurrency';
import { scheduleOnce } from '@ember/runloop';
import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';

import { eq } from '@cardstack/boxel-ui/helpers';
import LinkOffIcon from '@cardstack/boxel-icons/link-off';

import {
  bfmRefFormatAndSize,
  buildWaiter,
  cardTypeName,
  fileNameFromUrl,
  extractMermaidBlocks,
  MAX_MARKDOWN_RENDER_LENGTH,
  processKatexPlaceholders,
  replaceMermaidSvgs,
  resolveRRIReference,
  rri,
  trimJsonExtension,
} from '@cardstack/runtime-common';
import {
  hasCodeBlocks,
  markdownToHtml,
  preloadMarkdownLanguages,
} from '@cardstack/runtime-common/marked-sync';
import {
  type BaseDef,
  type CardDef,
  type FileDef,
  getComponent,
} from '../card-api';
import { CardContextConsumer } from '../field-component';
function wrapTablesHtml(html: string | null | undefined): string {
  if (!html) return '';
  // Fast path when there are no tables to wrap.
  if (!html.includes('<table')) return html;
  if (typeof DOMParser === 'undefined') return html;

  let doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('table:not(.table-wrapper table)').forEach((table) => {
    if (table.parentElement?.classList.contains('table-wrapper')) return;
    let wrapper = doc.createElement('div');
    wrapper.className = 'table-wrapper';
    table.replaceWith(wrapper);
    wrapper.appendChild(table);
  });
  return doc.body.innerHTML;
}

// Lets `settled()` wait for the async markdown rendering work (Mermaid/KaTeX
// lazy-loading and the deferred card-slot collection) that is kicked off by
// modifiers and ember-concurrency tasks after the initial render settles.
const markdownRenderingWaiter = buildWaiter('markdown-rendering');

// How many leading characters of over-limit content to show as an escaped
// plain-text preview, so the field is not opaque without parsing all of it.
const OVERSIZED_PREVIEW_LENGTH = 2000;

// Escape the raw preview so over-limit content is shown as text and never
// interpreted as HTML.
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Approximate a content length (in string characters) as a human-readable
// size for the over-limit notice.
function markdownContentSizeLabel(length: number): string {
  if (length >= 1024 * 1024) {
    return `${(length / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.round(length / 1024)} KB`;
}

type CardSlotFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';
type SlotState = 'resolved' | 'loading' | 'unresolved';
type RefType = 'card' | 'file';

interface RenderSlot {
  element: HTMLElement;
  // 'card' refs (`:card[URL]`) resolve to CardDef instances; 'file' refs
  // (`:file[URL]`) resolve to FileDef instances. Both kinds share the same
  // slot pipeline — they're wired to `cardContext.cardComponentModifier` so
  // operator-mode overlays can target them, both honor BFM size specifiers,
  // and both render via the instance's `getComponent`.
  refType: RefType;
  kind: 'inline' | 'block';
  state: SlotState;
  format: CardSlotFormat;
  // Inline sizing (width/height) so loading and broken placeholders match the
  // eventual card's footprint; also carries `overflow: hidden` for resolved
  // fitted cards.
  style?: ReturnType<typeof htmlSafe>;
  // Present when state === 'resolved': a CardDef for 'card' refs, a FileDef for
  // 'file' refs. Both render via `getComponent` and register by `id`.
  instance?: CardDef | FileDef;
  url?: string; // present when state === 'loading' | 'unresolved'
  typeName?: string; // present when state === 'unresolved'
}

function resolveUrl(raw: string, baseUrl: string | null | undefined): string {
  // Resolve in RRI space (no VirtualNetwork), the same way the reference
  // extractors resolve the refs behind `linkedCards`/`linkedFiles`. Instance
  // ids are canonical (the realm serves prefix form for mapped realms, URL for
  // unmapped), so this produces the same form as a loaded card's `id` — the
  // slot key (`card.id` / `file.id`) matches without a VirtualNetwork.
  try {
    return trimJsonExtension(
      resolveRRIReference(raw, baseUrl ? rri(baseUrl) : undefined),
    );
  } catch {
    return trimJsonExtension(raw);
  }
}

export default class MarkDownTemplate extends GlimmerComponent<{
  Args: {
    content: string | null | undefined;
    linkedCards?: CardDef[] | null;
    linkedFiles?: FileDef[] | null;
    cardReferenceBaseUrl?: string | null;
  };
}> {
  @tracked monacoContextInternal: any = undefined;
  @tracked renderSlots: RenderSlot[] = [];
  // On the first modifier run linkedCards is likely still loading (empty [])
  // so we skip unresolved Pills to avoid flashing them for refs that will
  // soon resolve. On subsequent runs showFallback is true. For in-app
  // navigation where linkedCards is already cached, we detect this by
  // checking linkedCards.length > 0 on the first run.
  private _modifierHasRun = false;
  get isPrerenderContext() {
    return Boolean((globalThis as any).__boxelRenderContext);
  }
  get monacoContext() {
    if (this.isPrerenderContext) {
      return undefined;
    }
    if (!this.monacoContextInternal && this.prepareMonacoContextTask) {
      this.prepareMonacoContextTask.perform();
    }
    return this.monacoContextInternal;
  }
  prepareMonacoContextTask = task({ drop: true }, async () => {
    if (this.isPrerenderContext) {
      return;
    }
    let loadMonacoForMarkdown = (globalThis as any).__loadMonacoForMarkdown;
    if (typeof loadMonacoForMarkdown !== 'function') {
      // If Monaco loader is not available, skip loading and leave monacoContext undefined
      return;
    }
    let monacoContext = await loadMonacoForMarkdown();
    await preloadMarkdownLanguages(this.args.content || '', monacoContext);
    this.monacoContextInternal = monacoContext;
  });
  get hasCodeBlocks() {
    return hasCodeBlocks(this.args.content);
  }

  @cached
  get renderedHtml() {
    let content = this.args.content;
    // Skip the parse entirely for over-limit content: a synchronous multi-MB
    // parse + sanitize + DOMParser reparse blocks the render thread. Because
    // the Monaco/KaTeX/Mermaid follow-on work all runs inside this getter, the
    // early return also avoids scanning the oversized content for code fences,
    // math, and mermaid blocks.
    if (
      typeof content === 'string' &&
      content.length > MAX_MARKDOWN_RENDER_LENGTH
    ) {
      return this.oversizedContentHtml(content);
    }
    let html = markdownToHtml(content, {
      enableMonacoSyntaxHighlighting: !!(
        this.hasCodeBlocks && this.monacoContext
      ),
      monaco: this.monacoContext,
    });
    // `markdownToHtml()` already sanitizes by default. `wrapTablesHtml()` only
    // reparses that sanitized HTML so it can add wrapper divs around tables we
    // control for styling/overflow behavior. Re-sanitizing the result was
    // adding avoidable DOMParser churn during prerender and acceptance tests.
    html = wrapTablesHtml(html);

    // Post-process the HTML string to render math, mermaid, and strip card ref
    // text. This must happen at the HTML-string level (not via imperative DOM
    // mutation) so that Glimmer's autotracking sees the final content and does
    // not overwrite it on re-render.
    let hasBfmRefs = html.includes('data-boxel-bfm-type=');
    let katex = html.includes('math-placeholder') ? this.katexModule : null;
    let mermaidSvgs = html.includes('<pre class="mermaid">')
      ? this.mermaidSvgs
      : null;

    if (
      typeof DOMParser !== 'undefined' &&
      (hasBfmRefs || katex || (mermaidSvgs && mermaidSvgs.size))
    ) {
      let doc = new DOMParser().parseFromString(html, 'text/html');

      // Strip text content from BFM refs (card and file) so there is no flash
      // of raw URLs. The URL is preserved in the data attribute; the modifier
      // will inject fallback text for refs that can't be resolved.
      if (hasBfmRefs) {
        doc
          .querySelectorAll(
            '[data-boxel-bfm-inline-ref], [data-boxel-bfm-block-ref]',
          )
          .forEach((el) => (el.textContent = ''));
      }

      if (katex) {
        processKatexPlaceholders(doc, katex);
      }

      if (mermaidSvgs && mermaidSvgs.size) {
        replaceMermaidSvgs(doc, mermaidSvgs);
      }

      html = doc.body.innerHTML;
    }

    return htmlSafe(html);
  }

  // Fallback for over-limit content: a short notice plus an escaped, truncated
  // plain-text preview so the field is not opaque. The preview is escaped so
  // the raw content is never interpreted as HTML.
  private oversizedContentHtml(content: string) {
    let preview = escapeHtml(content.slice(0, OVERSIZED_PREVIEW_LENGTH));
    let sizeLabel = markdownContentSizeLabel(content.length);
    return htmlSafe(
      `<div class="markdown-oversized" data-test-markdown-oversized>` +
        `<p class="markdown-oversized-notice">This field is too large to render as Markdown (${sizeLabel}). Showing the beginning as plain text:</p>` +
        `<pre class="markdown-oversized-preview">${preview}…</pre>` +
        `</div>`,
    );
  }

  captureCardSlots = modifier(
    (element: HTMLElement, _positional: unknown[]) => {
      let linkedCards = this.args.linkedCards;
      let linkedFiles = this.args.linkedFiles;
      let baseUrl = this.args.cardReferenceBaseUrl;
      let pendingUpdate = false;
      let pendingToken: unknown = undefined;
      // On the very first modifier run the linked instances are likely still
      // loading (empty []) so we skip unresolved Pills to avoid flashing them
      // for refs that will soon resolve. On subsequent runs showFallback is
      // true. We also enable it immediately if data is already present (in-app
      // navigation with cached results).
      let hasLinkedData =
        (linkedCards != null && linkedCards.length > 0) ||
        (linkedFiles != null && linkedFiles.length > 0);
      let showFallback = this._modifierHasRun || hasLinkedData;
      this._modifierHasRun = true;

      let collectSlots = (): RenderSlot[] => {
        let cardsByUrl = new Map<string, CardDef>();
        if (linkedCards?.length) {
          for (let card of linkedCards) {
            if (card?.id) {
              cardsByUrl.set(card.id, card);
            }
          }
        }
        let filesByUrl = new Map<string, FileDef>();
        if (linkedFiles?.length) {
          for (let file of linkedFiles) {
            if (file?.id) {
              filesByUrl.set(trimJsonExtension(file.id), file);
            }
          }
        }

        let slots: RenderSlot[] = [];

        for (let el of Array.from(
          element.querySelectorAll<HTMLElement>(
            '[data-boxel-bfm-type="card"], [data-boxel-bfm-type="file"]',
          ),
        )) {
          let refType: RefType =
            el.dataset.boxelBfmType === 'file' ? 'file' : 'card';
          let isInline = !!el.dataset.boxelBfmInlineRef;
          let rawUrl =
            el.dataset.boxelBfmInlineRef ?? el.dataset.boxelBfmBlockRef ?? '';
          if (!rawUrl) continue;
          let kind: 'inline' | 'block' = isInline ? 'inline' : 'block';

          // Both inline and block refs derive their format and any fitted
          // sizing from the BFM size attributes, so `:card[url | embedded]` and
          // `::card[url | 400x300]` are honored alike. Only the default differs:
          // an inline ref with no specifier falls back to atom, a block ref to
          // embedded.
          let derived = bfmRefFormatAndSize(
            el.dataset.boxelBfmFormat,
            el.dataset.boxelBfmWidth,
            el.dataset.boxelBfmHeight,
            isInline ? 'atom' : 'embedded',
          );
          let format: CardSlotFormat = derived.format;
          let sizeStyle: string | undefined = derived.sizeStyle;

          // Fitted slots carry an inline width/height plus `overflow: hidden`
          // so the resolved instance occupies the requested footprint.
          let resolvedStyle: ReturnType<typeof htmlSafe> | undefined;
          if (format === 'fitted') {
            resolvedStyle = htmlSafe(
              sizeStyle ? `${sizeStyle}; overflow: hidden` : 'overflow: hidden',
            );
          }

          let resolvedUrl = resolveUrl(rawUrl, baseUrl);

          let instance =
            refType === 'file'
              ? filesByUrl.get(resolvedUrl)
              : cardsByUrl.get(resolvedUrl);
          if (instance) {
            slots.push({
              element: el,
              refType,
              kind,
              state: 'resolved',
              format,
              instance,
              style: resolvedStyle,
            });
            continue;
          }

          // No matching instance yet: show the sized loading shimmer until the
          // linked instances have settled (showFallback), then fall back to the
          // broken-link box. Skipping the broken state on the first modifier
          // run avoids flashing it for refs that will soon resolve.
          let style = sizeStyle ? htmlSafe(sizeStyle) : undefined;
          if (!showFallback) {
            slots.push({
              element: el,
              refType,
              kind,
              state: 'loading',
              format,
              style,
              url: rawUrl,
            });
          } else {
            slots.push({
              element: el,
              refType,
              kind,
              state: 'unresolved',
              format,
              style,
              url: rawUrl,
              typeName:
                refType === 'file'
                  ? fileNameFromUrl(rawUrl)
                  : cardTypeName(rawUrl),
            });
          }
        }

        return slots;
      };

      // Deferred via scheduleOnce to avoid Glimmer backtracking assertion.
      // The didChange guard prevents an infinite loop: MutationObserver fires
      // when #in-element renders cards → collectSlots → set cardSlots →
      // re-render → observer fires again.
      let updateSlots = () => {
        pendingUpdate = false;
        let token = pendingToken;
        pendingToken = undefined;
        try {
          let nextSlots = collectSlots();
          let didChange =
            nextSlots.length !== this.renderSlots.length ||
            nextSlots.some((slot, index) => {
              let current = this.renderSlots[index];
              if (!current || current.element !== slot.element) return true;
              if (current.refType !== slot.refType) return true;
              if (current.kind !== slot.kind) return true;
              if (current.state !== slot.state) return true;
              if (current.format !== slot.format) return true;
              if (current.instance !== slot.instance) return true;
              if (current.url !== slot.url) return true;
              return String(current.style ?? '') !== String(slot.style ?? '');
            });

          if (didChange) {
            this.renderSlots = nextSlots;
          }
        } finally {
          markdownRenderingWaiter.endAsync(token);
        }
      };

      let scheduleUpdate = () => {
        if (pendingUpdate) {
          return;
        }
        pendingUpdate = true;
        pendingToken = markdownRenderingWaiter.beginAsync();
        scheduleOnce('afterRender', this, updateSlots);
      };

      scheduleUpdate();

      // End any in-flight waiter token on teardown so a destroyed modifier
      // (e.g. the scheduled update never flushed) cannot leave `settled()`
      // hanging. `updateSlots` clears `pendingToken` first, so this only fires
      // for a still-pending update.
      let endPendingToken = () => {
        let token = pendingToken;
        pendingToken = undefined;
        markdownRenderingWaiter.endAsync(token);
      };

      // MutationObserver re-collects slots when the DOM is reconstructed
      // (e.g. after browser back-navigation rebuilds the element's children).
      if (typeof MutationObserver === 'undefined') {
        return endPendingToken;
      }

      let observer = new MutationObserver(scheduleUpdate);
      observer.observe(element, {
        childList: true,
        subtree: true,
      });

      return () => {
        observer.disconnect();
        endPendingToken();
      };
    },
  );

  // ── KaTeX lazy loading ──
  @tracked _katex: any = null;

  get katexModule() {
    if (this.isPrerenderContext) {
      return null;
    }
    if (!this._katex) {
      this._loadKatexTask.perform();
    }
    return this._katex;
  }

  _loadKatexTask = task({ drop: true }, async () => {
    let token = markdownRenderingWaiter.beginAsync();
    try {
      let loadKatex = (globalThis as any).__loadKatex;
      if (typeof loadKatex !== 'function') {
        return;
      }
      this._katex = await loadKatex();
    } finally {
      markdownRenderingWaiter.endAsync(token);
    }
  });

  // ── Mermaid lazy loading + pre-rendering ──
  @tracked _mermaidSvgs = new Map<string, string>();
  private _mermaidIdCounter = 0;

  get mermaidSvgs() {
    if (this.isPrerenderContext) {
      return this._mermaidSvgs;
    }
    if (!this._mermaidSvgs.size) {
      this._renderMermaidTask.perform();
    }
    return this._mermaidSvgs;
  }

  _renderMermaidTask = task({ drop: true }, async () => {
    let content = this.args.content || '';
    let blocks = extractMermaidBlocks(content);
    if (!blocks.length) {
      return;
    }

    let loadMermaid = (globalThis as any).__loadMermaid;
    if (typeof loadMermaid !== 'function') {
      return;
    }

    let token = markdownRenderingWaiter.beginAsync();
    try {
      let mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'default',
      });

      let svgs = new Map<string, string>();
      for (let block of blocks) {
        try {
          let { svg } = await mermaid.render(
            `mermaid-${++this._mermaidIdCounter}`,
            block,
          );
          svgs.set(block, svg);
        } catch {
          // skip failed blocks
        }
      }

      this._mermaidSvgs = svgs;
    } finally {
      markdownRenderingWaiter.endAsync(token);
    }
  });

  getCardComponent = (card: BaseDef) => getComponent(card);

  <template>
    <div
      class='markdown-content'
      {{this.captureCardSlots this.renderedHtml @linkedCards @linkedFiles}}
    >
      {{this.renderedHtml}}
    </div>
    {{#each this.renderSlots key='element' as |slot|}}
      {{#in-element slot.element insertBefore=null}}
        {{#if (eq slot.state 'resolved')}}
          {{! Card and file refs render identically: both resolve to a
              `getComponent`-rendered instance registered by `id`. Only the
              test hook differs (card vs file). }}
          <CardContextConsumer as |context|>
            {{#let (this.getCardComponent slot.instance) as |RefComponent|}}
              {{#if (eq slot.kind 'inline')}}
                <span
                  class='markdown-bfm-card-slot
                    {{if
                      (eq slot.format "atom")
                      "markdown-bfm-card-slot--inline"
                      "markdown-bfm-card-slot--inline-embed"
                    }}
                    {{if slot.style "markdown-bfm-card-slot--fitted"}}'
                  style={{slot.style}}
                  data-test-markdown-bfm-inline-file={{if
                    (eq slot.refType 'file')
                    ''
                  }}
                  data-test-markdown-bfm-inline-card={{if
                    (eq slot.refType 'card')
                    ''
                  }}
                  {{context.cardComponentModifier
                    cardId=slot.instance.id
                    format='data'
                    fieldType=undefined
                    fieldName=undefined
                  }}
                >
                  <RefComponent
                    @format={{slot.format}}
                    @displayContainer={{false}}
                  />
                </span>
              {{else}}
                <div
                  class='markdown-bfm-card-slot markdown-bfm-card-slot--block
                    {{if slot.style "markdown-bfm-card-slot--fitted"}}'
                  style={{slot.style}}
                  data-test-markdown-bfm-block-file={{if
                    (eq slot.refType 'file')
                    ''
                  }}
                  data-test-markdown-bfm-block-card={{if
                    (eq slot.refType 'card')
                    ''
                  }}
                  {{context.cardComponentModifier
                    cardId=slot.instance.id
                    format='data'
                    fieldType=undefined
                    fieldName=undefined
                  }}
                >
                  <RefComponent
                    @format={{slot.format}}
                    @displayContainer={{false}}
                  />
                </div>
              {{/if}}
            {{/let}}
          </CardContextConsumer>
        {{else if (eq slot.state 'loading')}}
          {{#if (eq slot.kind 'inline')}}
            {{#if (eq slot.format 'atom')}}
              <span
                class='markdown-bfm-loading markdown-bfm-loading--inline'
                aria-hidden='true'
                data-test-markdown-bfm-loading-inline
              />
            {{else}}
              <span
                class='markdown-bfm-loading markdown-bfm-loading--inline-embed markdown-bfm-loading--{{slot.format}}'
                style={{slot.style}}
                aria-hidden='true'
                data-test-markdown-bfm-loading-inline
              />
            {{/if}}
          {{else}}
            <div
              class='markdown-bfm-loading markdown-bfm-loading--block markdown-bfm-loading--{{slot.format}}'
              style={{slot.style}}
              aria-hidden='true'
              data-test-markdown-bfm-loading-block
            />
          {{/if}}
        {{else}}
          {{#if (eq slot.kind 'inline')}}
            {{#if (eq slot.format 'atom')}}
              <span
                class='markdown-bfm-broken markdown-bfm-broken--inline'
                title={{slot.url}}
                data-test-markdown-bfm-unresolved-inline
              >
                <span class='markdown-bfm-broken-label'>
                  <LinkOffIcon width='12' height='12' />
                  {{slot.typeName}}
                </span>
              </span>
            {{else}}
              <span
                class='markdown-bfm-broken markdown-bfm-broken--inline-embed markdown-bfm-broken--{{slot.format}}'
                style={{slot.style}}
                title={{slot.url}}
                data-test-markdown-bfm-unresolved-inline
              >
                <span class='markdown-bfm-broken-label'>
                  <LinkOffIcon width='14' height='14' />
                  {{slot.typeName}}
                </span>
              </span>
            {{/if}}
          {{else}}
            <div
              class='markdown-bfm-broken markdown-bfm-broken--block markdown-bfm-broken--{{slot.format}}'
              style={{slot.style}}
              title={{slot.url}}
              data-test-markdown-bfm-unresolved-block
            >
              <span class='markdown-bfm-broken-label'>
                <LinkOffIcon width='14' height='14' />
                {{slot.typeName}}
              </span>
            </div>
          {{/if}}
        {{/if}}
      {{/in-element}}
    {{/each}}
    <style scoped>
      @layer baseComponent {
        .markdown-content {
          --md-border: var(--border, var(--boxel-border-color));
          --md-muted: var(--muted, var(--boxel-100));
          --md-mono: var(
            --markdown-code-font-family,
            var(--font-mono, var(--boxel-monospace-font-family))
          );
          --vscode-editor-background: var(--boxel-dark);
          --vscode-editor-foreground: var(--boxel-light);
          --vscode-editorCodeLens-lineHeight: 15px;
          --vscode-editorCodeLens-fontSize: 10px;
          --vscode-editorCodeLens-fontFeatureSettings: 'liga' off, 'calt' off;

          max-width: 100%;
          font-size: var(--markdown-font-size, inherit);
          font-family: var(--markdown-font-family, inherit);
          overflow: hidden;
        }

        /* Over-limit content notice + truncated plain-text preview */
        .markdown-content :deep(.markdown-oversized-notice) {
          margin: 0 0 var(--boxel-sp-xs);
          font-style: italic;
          color: var(--boxel-500);
        }
        .markdown-content :deep(.markdown-oversized-preview) {
          max-height: 20rem;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          font-family: var(--md-mono);
          font-size: 0.8125em;
          background-color: var(--md-muted);
          border: 1px solid var(--md-border);
          border-radius: var(--boxel-border-radius);
          padding: var(--boxel-sp-xs);
        }

        /* Heading */
        .markdown-content :deep(h1),
        .markdown-content :deep(h2),
        .markdown-content :deep(h3),
        .markdown-content :deep(h4),
        .markdown-content :deep(h5),
        .markdown-content :deep(h6) {
          font-weight: 600;
          font-family: var(--markdown-heading-font-family, inherit);
        }
        .markdown-content :deep(h1) {
          font-size: 2.5em;
          line-height: 1.25;
          letter-spacing: normal;
          margin-top: var(--boxel-sp-xl);
          margin-bottom: var(--boxel-sp-lg);
        }
        .markdown-content :deep(h2) {
          font-size: 1.625em;
          margin-top: var(--boxel-sp-xxl);
          margin-bottom: var(--boxel-sp-xs);
        }
        .markdown-content :deep(h3) {
          font-size: 1.125em;
          margin-top: var(--boxel-sp-xl);
          margin-bottom: var(--boxel-sp-xxxs);
        }
        .markdown-content :deep(h4) {
          font-size: 1em;
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-xxxs);
        }
        .markdown-content :deep(h5) {
          font-size: 0.8125em;
          margin-top: var(--boxel-sp);
          margin-bottom: var(--boxel-sp-xxxs);
        }
        .markdown-content :deep(h6) {
          font-size: 0.6875em;
          margin-top: var(--boxel-sp-sm);
          margin-bottom: var(--boxel-sp-xxxs);
        }

        /* Paragraph */
        .markdown-content :deep(p) {
          font-family: inherit;
          font-size: inherit;
          font-weight: 400;
          line-height: 1.6;
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp);
        }

        /* Bold */
        .markdown-content :deep(strong),
        .markdown-content :deep(b) {
          font-weight: 700;
        }

        /* Italic */
        .markdown-content :deep(em),
        .markdown-content :deep(i) {
          font-style: italic;
        }

        /* Strikethrough */
        .markdown-content :deep(del),
        .markdown-content :deep(s) {
          text-decoration: line-through;
        }

        /* Highlight */
        /** Must use "<mark>...</mark>" html element **/
        .markdown-content :deep(mark) {
          background-color: var(--boxel-yellow);
        }

        /* Subscript */
        /** Must use <sub> **/

        /* Superscript */
        /** Must use <sup> **/

        /* Blockquote */
        .markdown-content :deep(blockquote) {
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-lg);
          margin-right: auto;
          margin-left: auto;
          padding-top: var(--boxel-sp-4xs);
          padding-bottom: var(--boxel-sp-4xs);
          border-right: 1px solid black;
          border-left: 1px solid black;
        }
        .markdown-content :deep(blockquote p) {
          font-size: 1.5em;
          font-style: italic;
          margin-inline-start: var(--boxel-sp-xl);
          margin-inline-end: var(--boxel-sp-xl);
        }

        /* GFM Alerts / Admonitions (rendered by marked-alert) */
        .markdown-content :deep(.markdown-alert) {
          border-left: 3px solid var(--markdown-alert-color, var(--boxel-400));
          border-radius: 0 6px 6px 0;
          padding: var(--boxel-sp-xs) var(--boxel-sp);
          margin: var(--boxel-sp-xs) 0;
        }
        .markdown-content :deep(.markdown-alert-title) {
          font-weight: 700;
          color: var(--markdown-alert-color, inherit);
          margin: 0;
        }
        .markdown-content :deep(.markdown-alert-title svg) {
          display: none;
        }
        .markdown-content :deep(.markdown-alert p:not(.markdown-alert-title)) {
          margin: var(--boxel-sp-4xs) 0 0;
        }
        .markdown-content :deep(.markdown-alert-note) {
          --markdown-alert-color: #0969da;
          background-color: #ddf4ff;
        }
        .markdown-content :deep(.markdown-alert-tip) {
          --markdown-alert-color: #1a7f37;
          background-color: #dcfce7;
        }
        .markdown-content :deep(.markdown-alert-important) {
          --markdown-alert-color: #8250df;
          background-color: #f5f0ff;
        }
        .markdown-content :deep(.markdown-alert-warning) {
          --markdown-alert-color: #9a6700;
          background-color: #fff8c5;
        }
        .markdown-content :deep(.markdown-alert-caution) {
          --markdown-alert-color: #d1242f;
          background-color: #ffebe9;
        }

        /* Horizontal rule */
        .markdown-content :deep(hr) {
          border-bottom: none;
          border-right: none;
          border-left: none;
          border-top: var(--boxel-border);
        }

        /* Code */
        .markdown-content :deep(code) {
          font-family: var(--md-mono);
          background-color: var(--md-muted);
          color: var(--foreground);
        }

        /* Code Block */
        .markdown-content :deep(pre) {
          white-space: var(--boxel-markdown-field-pre-wrap, pre-wrap);
          background-color: var(--vscode-editor-background, var(--md-muted));
          color: var(--vscode-editor-foreground, var(--foreground));
          font-family: var(--md-mono);
          border-radius: var(--boxel-border-radius-xl);
          padding: var(--boxel-sp-lg);
        }

        .markdown-content :deep(pre code) {
          background-color: var(--vscode-editor-background, var(--md-muted));
          color: var(--vscode-editor-foreground, var(--foreground));
        }

        /* Link */
        .markdown-content :deep(a),
        .markdown-content :deep(a:hover) {
          color: currentColor;
          text-decoration: underline;
        }

        /* Image */
        .markdown-content :deep(figure, img, svg) {
          max-width: 100%;
        }
        .markdown-content :deep(figure) {
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-lg);
          margin-right: auto;
          margin-left: auto;
        }
        .markdown-content :deep(figcaption) {
          font-size: 0.8125em;
          font-style: italic;
        }
        .markdown-content :deep(img) {
          border-radius: var(--boxel-border-radius-lg);
          overflow: hidden;
        }

        /* Ordered & Unordered List */
        .markdown-content :deep(ol),
        .markdown-content :deep(ul) {
          padding-left: 1.375em;
          margin-top: var(--boxel-sp);
          margin-bottom: var(--boxel-sp);
          font-size: inherit;
          font-weight: 400;
          font-family: inherit;
        }
        /* Nested list */
        .markdown-content :deep(ol ol),
        .markdown-content :deep(ol ul),
        .markdown-content :deep(ul ul),
        .markdown-content :deep(ul ol) {
          margin-top: var(--boxel-sp-xxxs);
          margin-bottom: var(--boxel-sp-xxxs);
        }

        /* Task List */
        .markdown-content :deep(ul:has(input[type='checkbox'])) {
          list-style-type: none;
          padding-left: 0;
        }

        /* Definition List */
        /* Must use <dl> <dt> <dd> tags -- default browser styling */

        /* Footnote */
        /* Not available */

        /* Emoji */
        /* Must copy/paste emoji */

        /* Scrollable table wrapper */
        .markdown-content :deep(.table-wrapper) {
          width: 100%;
          max-width: var(--markdown-table-max-width, 56.25rem);
          overflow-x: auto;
          margin-top: var(--boxel-sp-lg);
          margin-bottom: var(--boxel-sp-lg);
          background-color: var(--md-muted);
          border: 1px solid var(--md-border);
          border-radius: var(--boxel-border-radius);
          word-break: initial;
        }
        /* Table */
        .markdown-content :deep(table) {
          width: 100%;
          max-width: 100%; /* Allow full width within scroll container */
          border-radius: 0;
          border-collapse: collapse;
        }
        .markdown-content :deep(thead) {
          border-bottom: 2px solid var(--md-border);
        }
        .markdown-content :deep(th),
        .markdown-content :deep(td) {
          text-align: start;
          padding: var(--boxel-sp-2xs);
        }
        .markdown-content :deep(th:not(:last-child)),
        .markdown-content :deep(td:not(:last-child)) {
          border-right: 1px solid var(--md-border);
        }
        .markdown-content :deep(tr:not(:last-child) td) {
          border-bottom: 1px solid var(--md-border);
        }

        /* Mermaid diagrams */
        .markdown-content :deep(pre.mermaid) {
          background-color: transparent;
          color: inherit;
          text-align: center;
          padding: var(--boxel-sp);
          border-radius: var(--boxel-border-radius-xl);
          overflow-x: auto;
        }

        .markdown-content :deep(pre.mermaid svg) {
          max-width: 100%;
          height: auto;
        }

        /* Mermaid error display */
        .markdown-content :deep(pre.mermaid[data-processed='true'] .error-icon),
        .markdown-content :deep(pre.mermaid #d .error-text) {
          fill: var(--boxel-error-200, #b00020);
        }

        /* BFM references (card, file, etc.) */
        .markdown-content :deep([data-boxel-bfm-inline-ref]) {
          display: inline;
        }

        .markdown-content :deep([data-boxel-bfm-block-ref]) {
          display: block;
          margin: var(--boxel-sp) 0;
        }

        .markdown-bfm-card-slot {
          max-width: 100%;
        }

        .markdown-bfm-card-slot--inline {
          display: inline-flex;
          vertical-align: middle;
        }

        /* Inline embeds with an explicit non-atom format flow inline-block so a
           sized card sits in the text run without the flex shrink behavior the
           atom pill relies on. */
        .markdown-bfm-card-slot--inline-embed {
          display: inline-block;
          vertical-align: middle;
        }

        .markdown-bfm-card-slot--block {
          display: block;
        }

        .markdown-bfm-card-slot--fitted {
          border-radius: var(--boxel-border-radius);
        }

        /* Placeholder footprint shared by loading + broken states. The
           default block sizes approximate the eventual card so the layout does
           not jump when the card resolves; explicit fitted dimensions arrive
           as an inline style that overrides these. */
        .markdown-bfm-loading--embedded,
        .markdown-bfm-broken--embedded {
          width: 100%;
          min-height: 9.375rem;
        }
        .markdown-bfm-loading--isolated,
        .markdown-bfm-broken--isolated {
          width: 100%;
          min-height: 18.75rem;
        }
        .markdown-bfm-loading--fitted,
        .markdown-bfm-broken--fitted {
          width: 15.625rem;
          height: 10.625rem;
        }

        /* Loading shimmer for card refs before content is rendered */
        .markdown-bfm-loading {
          position: relative;
          overflow: hidden;
          max-width: 100%;
          background-color: var(--boxel-light-200);
          border-radius: var(--boxel-border-radius);
        }
        .markdown-bfm-loading--inline {
          display: inline-block;
          width: 6em;
          height: 1.2em;
          vertical-align: middle;
          border-radius: var(--boxel-border-radius-sm);
        }
        /* Inline embeds with an explicit non-atom format share the block
           footprint classes but flow inline. */
        .markdown-bfm-loading--inline-embed {
          display: inline-block;
          max-width: 100%;
          vertical-align: middle;
        }
        .markdown-bfm-loading--block {
          display: block;
        }
        .markdown-bfm-loading::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            transparent,
            var(--boxel-light-100),
            transparent
          );
          transform: translateX(-100%);
          animation: bfm-shimmer 1.6s linear 0.5s infinite;
        }
        @keyframes bfm-shimmer {
          0% {
            transform: translateX(-200%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        /* Broken-link placeholder: a card-sized box with a faint diagonal
           cross and a centered icon + type-name label (no chip). */
        .markdown-bfm-broken {
          display: flex;
          align-items: center;
          justify-content: center;
          max-width: 100%;
          border: 1px solid var(--md-border);
          border-radius: var(--boxel-border-radius);
          background-color: var(--boxel-light-100);
          background-image:
            linear-gradient(
              to top right,
              transparent calc(50% - 0.5px),
              var(--md-border) calc(50% - 0.5px),
              var(--md-border) calc(50% + 0.5px),
              transparent calc(50% + 0.5px)
            ),
            linear-gradient(
              to bottom right,
              transparent calc(50% - 0.5px),
              var(--md-border) calc(50% - 0.5px),
              var(--md-border) calc(50% + 0.5px),
              transparent calc(50% + 0.5px)
            );
          overflow: hidden;
        }
        .markdown-bfm-broken--inline {
          display: inline-flex;
          min-height: 1.6em;
          padding: 0 var(--boxel-sp-5xs);
          vertical-align: middle;
          border-radius: var(--boxel-border-radius-sm);
        }
        /* Inline embeds with an explicit non-atom format share the block
           footprint classes but flow inline. */
        .markdown-bfm-broken--inline-embed {
          display: inline-flex;
          vertical-align: middle;
        }
        .markdown-bfm-broken--block {
          display: flex;
          margin: var(--boxel-sp-xxxs) 0;
        }
        .markdown-bfm-broken-label {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-5xs);
          padding: 0 var(--boxel-sp-4xs);
          /* Match the box fill so the cross does not slice through the text. */
          background-color: var(--boxel-light-100);
          color: var(--boxel-500);
          font-size: 0.75rem;
          font-weight: 500;
          line-height: 1.5;
          white-space: nowrap;
        }
        .markdown-bfm-broken-label svg {
          flex: none;
        }
      }
    </style>
  </template>
}
