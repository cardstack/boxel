// Host-side counterpart of the base-realm `MarkdownTemplate` component
// (`packages/base/default-templates/markdown.gts`).  The base-realm version
// cannot be imported directly from host code (only type imports are allowed),
// so this component reuses the same shared utilities (`markdownToHtml`,
// `extractCardReferenceUrls`, `cardTypeName`) and follows the same rendering
// pattern: convert markdown → HTML, capture BFM card-reference placeholders
// via a modifier, then render live cards into those slots with `#in-element`.

import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import LinkOffIcon from '@cardstack/boxel-icons/link-off';
import { task } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  bfmBlockFormatAndSize,
  CardContextName,
  cardTypeName,
  extractCardReferenceUrls,
  extractFileReferenceUrls,
  isCardErrorJSONAPI,
  rri,
  trimJsonExtension,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type NetworkService from '@cardstack/host/services/network';
import type StoreService from '@cardstack/host/services/store';

import type {
  CardContext,
  CardDef,
  FileDef,
} from 'https://cardstack.com/base/card-api';

type CardSlotFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';
type SlotState = 'resolved' | 'loading' | 'unresolved';
type RefType = 'card' | 'file';

interface RenderSlot {
  element: HTMLElement;
  // 'card' refs (`:card[URL]`) resolve to CardDef instances; 'file' refs
  // (`:file[URL]`) resolve to FileDef instances rendered without card overlays.
  refType: RefType;
  kind: 'inline' | 'block';
  state: SlotState;
  format: CardSlotFormat;
  // Inline sizing (width/height) so loading and broken placeholders match the
  // eventual card's footprint; also carries `overflow: hidden` for resolved
  // fitted cards.
  style?: ReturnType<typeof htmlSafe>;
  card?: CardDef; // present when refType === 'card' && state === 'resolved'
  file?: FileDef; // present when refType === 'file' && state === 'resolved'
  url?: string; // present when state === 'loading' | 'unresolved'
  typeName?: string; // present when state === 'unresolved'
}

// For a `:file[URL]` ref the human-readable label is the file name (the last
// path segment), unlike card refs whose type name is the second-to-last
// segment (`<base>/<TypeName>/<id>`).
function fileNameFromUrl(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL; treat as a path/reference string.
  }
  let cleaned = path.split(/[?#]/, 1)[0].replace(/\/+$/, '');
  let segments = cleaned.split('/').filter((s) => s && s !== '.' && s !== '..');
  return segments.length ? segments[segments.length - 1] : 'File';
}

function resolveUrl(
  raw: string,
  baseUrl: string | undefined,
  virtualNetwork: VirtualNetwork,
): string {
  try {
    return trimJsonExtension(
      virtualNetwork.resolveRRI(raw, baseUrl ? rri(baseUrl) : undefined),
    );
  } catch {
    return trimJsonExtension(raw);
  }
}

function wrapTablesHtml(html: string): string {
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

interface Signature {
  Args: {
    content: string | null | undefined;
    cardReferenceBaseUrl?: string | null;
  };
}

// Fallback when no CardContext is provided (e.g. in tests without operator-mode).
// Only the subset of fields used by RenderedMarkdown is stubbed; the rest come
// from the dynamicCardContext injected at runtime.
const DEFAULT_CARD_CONTEXT: Partial<CardContext> = {
  cardComponentModifier: class NoOpModifier extends Modifier<any> {
    modify() {}
  },
  commandContext: undefined,
};

export default class RenderedMarkdown extends Component<Signature> {
  @service declare private network: NetworkService;
  @service declare private store: StoreService;
  @consume(CardContextName) declare private dynamicCardContext: CardContext;

  private get cardContext(): CardContext {
    return {
      ...DEFAULT_CARD_CONTEXT,
      ...this.dynamicCardContext,
    } as CardContext;
  }

  @tracked renderSlots: RenderSlot[] = [];
  @tracked private loadedCards = new Map<string, CardDef>();
  @tracked private loadedFiles = new Map<string, FileDef>();
  private _modifierHasRun = false;

  // ── HTML rendering ──

  @cached
  get renderedHtml() {
    let html = markdownToHtml(this.args.content);
    html = wrapTablesHtml(html);

    // Strip text from BFM refs (card and file) so raw URLs don't flash before
    // the referenced instance loads.
    let hasBfmRefs = html.includes('data-boxel-bfm-type=');
    if (typeof DOMParser !== 'undefined' && hasBfmRefs) {
      let doc = new DOMParser().parseFromString(html, 'text/html');
      doc
        .querySelectorAll(
          '[data-boxel-bfm-inline-ref], [data-boxel-bfm-block-ref]',
        )
        .forEach((el) => (el.textContent = ''));
      html = doc.body.innerHTML;
    }

    return htmlSafe(html);
  }

  // ── Reference loading ──

  @cached
  private get cardReferenceUrls(): string[] {
    if (!this.args.content) return [];
    return extractCardReferenceUrls(
      this.args.content,
      this.args.cardReferenceBaseUrl ?? '',
      this.network.virtualNetwork,
    );
  }

  @cached
  private get fileReferenceUrls(): string[] {
    if (!this.args.content) return [];
    return extractFileReferenceUrls(
      this.args.content,
      this.args.cardReferenceBaseUrl ?? '',
      this.network.virtualNetwork,
    );
  }

  private loadReferencedCards = task({ restartable: true }, async () => {
    let urls = this.cardReferenceUrls;
    if (!urls.length) return;

    let cards = new Map<string, CardDef>();
    await Promise.all(
      urls.map(async (url) => {
        try {
          let result = await this.store.get(url);
          if (!isCardErrorJSONAPI(result)) {
            cards.set(url, result as CardDef);
          }
        } catch {
          // skip cards that can't be loaded
        }
      }),
    );
    this.loadedCards = cards;
  });

  private loadReferencedFiles = task({ restartable: true }, async () => {
    let urls = this.fileReferenceUrls;
    if (!urls.length) return;

    let files = new Map<string, FileDef>();
    await Promise.all(
      urls.map(async (url) => {
        try {
          let result = await this.store.get<FileDef>(url, {
            type: 'file-meta',
          });
          if (!isCardErrorJSONAPI(result)) {
            files.set(url, result as FileDef);
          }
        } catch {
          // skip files that can't be loaded
        }
      }),
    );
    this.loadedFiles = files;
  });

  // ── Slot capture modifier ──

  captureCardSlots = modifier(
    (element: HTMLElement, _positional: unknown[]) => {
      let baseUrl = this.args.cardReferenceBaseUrl ?? undefined;
      let pendingUpdate = false;

      let showFallback =
        this._modifierHasRun ||
        this.loadedCards.size > 0 ||
        this.loadedFiles.size > 0;
      this._modifierHasRun = true;

      // Trigger card + file loading when content changes
      this.loadReferencedCards.perform();
      this.loadReferencedFiles.perform();

      let collectSlots = (): RenderSlot[] => {
        let cardsByUrl = this.loadedCards;
        let filesByUrl = this.loadedFiles;
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

          // Files render in atom (inline) / embedded (block); cards derive
          // their block format/size from the BFM size attributes.
          let format: CardSlotFormat;
          let sizeStyle: string | undefined;
          if (refType === 'file') {
            format = isInline ? 'atom' : 'embedded';
          } else if (isInline) {
            format = 'atom';
          } else {
            let derived = bfmBlockFormatAndSize(
              el.dataset.boxelBfmFormat,
              el.dataset.boxelBfmWidth,
              el.dataset.boxelBfmHeight,
            );
            format = derived.format;
            sizeStyle = derived.sizeStyle;
          }

          let resolvedUrl = resolveUrl(
            rawUrl,
            baseUrl,
            this.network.virtualNetwork,
          );

          if (refType === 'file') {
            let file = filesByUrl.get(resolvedUrl);
            if (file) {
              slots.push({
                element: el,
                refType,
                kind,
                state: 'resolved',
                format,
                file,
              });
              continue;
            }
          } else {
            let card = cardsByUrl.get(resolvedUrl);
            if (card) {
              let style: ReturnType<typeof htmlSafe> | undefined;
              if (format === 'fitted') {
                style = htmlSafe(
                  sizeStyle
                    ? `${sizeStyle}; overflow: hidden`
                    : 'overflow: hidden',
                );
              }
              slots.push({
                element: el,
                refType,
                kind,
                state: 'resolved',
                format,
                card,
                style,
              });
              continue;
            }
          }

          // No matching instance yet: show the sized loading shimmer until the
          // load settles (showFallback), then fall back to the broken-link box.
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

      let updateSlots = () => {
        pendingUpdate = false;
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
            if (current.card !== slot.card) return true;
            if (current.file !== slot.file) return true;
            if (current.url !== slot.url) return true;
            return String(current.style ?? '') !== String(slot.style ?? '');
          });

        if (didChange) {
          this.renderSlots = nextSlots;
        }
      };

      let scheduleUpdate = () => {
        if (pendingUpdate) return;
        pendingUpdate = true;
        scheduleOnce('afterRender', null, updateSlots);
      };

      scheduleUpdate();

      if (typeof MutationObserver === 'undefined') return;

      let observer = new MutationObserver(scheduleUpdate);
      observer.observe(element, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  );

  <template>
    <div
      class='markdown-content'
      {{this.captureCardSlots
        this.renderedHtml
        this.loadedCards
        this.loadedFiles
      }}
    >
      {{this.renderedHtml}}
    </div>
    {{#each this.renderSlots key='element' as |slot|}}
      {{#in-element slot.element insertBefore=null}}
        {{#if (eq slot.state 'resolved')}}
          {{#if (eq slot.refType 'file')}}
            {{#if (eq slot.kind 'inline')}}
              <span
                class='markdown-bfm-card-slot markdown-bfm-card-slot--inline'
                data-test-markdown-bfm-inline-file
              >
                <CardRenderer
                  @card={{slot.file}}
                  @format={{slot.format}}
                  @displayContainer={{false}}
                />
              </span>
            {{else}}
              <div
                class='markdown-bfm-card-slot markdown-bfm-card-slot--block'
                data-test-markdown-bfm-block-file
              >
                <CardRenderer
                  @card={{slot.file}}
                  @format={{slot.format}}
                  @displayContainer={{false}}
                />
              </div>
            {{/if}}
          {{else if (eq slot.kind 'inline')}}
            <span
              class='markdown-bfm-card-slot markdown-bfm-card-slot--inline'
              data-test-markdown-bfm-inline-card
              {{this.cardContext.cardComponentModifier
                card=slot.card
                format='data'
                fieldType=undefined
                fieldName=undefined
              }}
            >
              <CardRenderer
                @card={{slot.card}}
                @format={{slot.format}}
                @displayContainer={{false}}
              />
            </span>
          {{else}}
            <div
              class='markdown-bfm-card-slot markdown-bfm-card-slot--block
                {{if slot.style "markdown-bfm-card-slot--fitted"}}'
              style={{slot.style}}
              data-test-markdown-bfm-block-card
              {{this.cardContext.cardComponentModifier
                card=slot.card
                format='data'
                fieldType=undefined
                fieldName=undefined
              }}
            >
              <CardRenderer
                @card={{slot.card}}
                @format={{slot.format}}
                @displayContainer={{false}}
              />
            </div>
          {{/if}}
        {{else if (eq slot.state 'loading')}}
          {{#if (eq slot.kind 'inline')}}
            <span
              class='markdown-bfm-loading markdown-bfm-loading--inline'
              aria-hidden='true'
              data-test-markdown-bfm-loading-inline
            />
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

    {{! Styles below are mirrored from packages/base/default-templates/markdown.gts
        to keep the rendered preview visually consistent with .md file rendering.
        Wrapped in @layer baseComponent so that unlayered card-specific styles
        (from CardContainer, card templates, etc.) automatically take precedence
        over these generic markdown typography rules. }}
    <style scoped>
      @layer baseComponent {
        .markdown-content {
          --md-border: var(--border, var(--boxel-border-color));
          --md-muted: var(--muted, var(--boxel-100));
          --md-mono: var(
            --markdown-code-font-family,
            var(--font-mono, var(--boxel-monospace-font-family))
          );

          max-width: 100%;
          font-size: var(--markdown-font-size, inherit);
          font-family: var(--markdown-font-family, inherit);
          overflow: hidden;
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
        .markdown-content :deep(mark) {
          background-color: var(--boxel-yellow);
        }

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

        /* GFM Alerts */
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
          background-color: var(--md-muted);
          color: var(--foreground);
          font-family: var(--md-mono);
          border-radius: var(--boxel-border-radius-xl);
          padding: var(--boxel-sp-lg);
        }

        .markdown-content :deep(pre code) {
          background-color: var(--md-muted);
          color: var(--foreground);
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

        /* Lists */
        .markdown-content :deep(ol),
        .markdown-content :deep(ul) {
          padding-left: 1.375em;
          margin-top: var(--boxel-sp);
          margin-bottom: var(--boxel-sp);
          font-size: inherit;
          font-weight: 400;
          font-family: inherit;
        }
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
        .markdown-content :deep(table) {
          width: 100%;
          max-width: 100%;
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

        /* BFM reference slots */
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

        /* Loading shimmer */
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
      } /* end @layer baseComponent */
    </style>
  </template>
}
