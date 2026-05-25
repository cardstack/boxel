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

import { Pill } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  cardTypeName,
  extractCardReferenceUrls,
  isCardErrorJSONAPI,
  rri,
  trimJsonExtension,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { markdownToHtml } from '@cardstack/runtime-common/marked-sync';

import CardRenderer from '@cardstack/host/components/card-renderer';

import type NetworkService from '@cardstack/host/services/network';
import type StoreService from '@cardstack/host/services/store';

import type { CardContext, CardDef } from 'https://cardstack.com/base/card-api';

type CardSlotFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';

interface ResolvedSlot {
  element: HTMLElement;
  card: CardDef;
  format: CardSlotFormat;
  kind: 'inline' | 'block';
  style?: ReturnType<typeof htmlSafe>;
}

interface UnresolvedSlot {
  element: HTMLElement;
  url: string;
  typeName: string;
  kind: 'inline' | 'block';
}

type RenderSlot =
  | (ResolvedSlot & { card: CardDef })
  | (UnresolvedSlot & { card?: undefined });

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
  private _modifierHasRun = false;

  // ── HTML rendering ──

  @cached
  get renderedHtml() {
    let html = markdownToHtml(this.args.content);
    html = wrapTablesHtml(html);

    let hasCardRefs = html.includes('data-boxel-bfm-type="card"');
    if (typeof DOMParser !== 'undefined' && hasCardRefs) {
      let doc = new DOMParser().parseFromString(html, 'text/html');
      doc
        .querySelectorAll('[data-boxel-bfm-type="card"]')
        .forEach((el) => (el.textContent = ''));
      html = doc.body.innerHTML;
    }

    return htmlSafe(html);
  }

  // ── Card loading ──

  @cached
  private get cardReferenceUrls(): string[] {
    if (!this.args.content) return [];
    return extractCardReferenceUrls(
      this.args.content,
      this.args.cardReferenceBaseUrl ?? '',
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

  // ── Slot capture modifier ──

  captureCardSlots = modifier(
    (element: HTMLElement, _positional: unknown[]) => {
      let baseUrl = this.args.cardReferenceBaseUrl ?? undefined;
      let pendingUpdate = false;

      let showFallback = this._modifierHasRun || this.loadedCards.size > 0;
      this._modifierHasRun = true;

      // Trigger card loading when content changes
      this.loadReferencedCards.perform();

      let collectSlots = (): RenderSlot[] => {
        let cardsByUrl = this.loadedCards;
        let slots: RenderSlot[] = [];
        let resolvedEls = new Set<HTMLElement>();

        for (let el of Array.from(
          element.querySelectorAll<HTMLElement>(
            '[data-boxel-bfm-inline-ref][data-boxel-bfm-type="card"]',
          ),
        )) {
          let rawUrl = el.dataset.boxelBfmInlineRef;
          if (!rawUrl) continue;
          let resolved = resolveUrl(
            rawUrl,
            baseUrl,
            this.network.virtualNetwork,
          );
          let card = cardsByUrl.get(resolved);
          if (card) {
            resolvedEls.add(el);
            slots.push({ element: el, card, format: 'atom', kind: 'inline' });
          }
        }

        for (let el of Array.from(
          element.querySelectorAll<HTMLElement>(
            '[data-boxel-bfm-block-ref][data-boxel-bfm-type="card"]',
          ),
        )) {
          let rawUrl = el.dataset.boxelBfmBlockRef;
          if (!rawUrl) continue;
          let resolved = resolveUrl(
            rawUrl,
            baseUrl,
            this.network.virtualNetwork,
          );
          let card = cardsByUrl.get(resolved);
          if (card) {
            let bfmFormat = el.dataset.boxelBfmFormat;
            let format: CardSlotFormat =
              bfmFormat === 'fitted' || bfmFormat === 'isolated'
                ? bfmFormat
                : 'embedded';

            let style: ReturnType<typeof htmlSafe> | undefined;
            if (format === 'fitted') {
              let w = el.dataset.boxelBfmWidth;
              let h = el.dataset.boxelBfmHeight;
              let parts: string[] = [];
              if (w && /^\d+%$/.test(w)) {
                parts.push(`width: ${w}`);
              } else if (w && /^\d+$/.test(w)) {
                parts.push(`width: ${w}px`);
              }
              if (h && /^\d+$/.test(h)) {
                parts.push(`height: ${h}px`);
              }
              parts.push('overflow: hidden');
              style = htmlSafe(parts.join('; '));
            }

            resolvedEls.add(el);
            slots.push({ element: el, card, format, kind: 'block', style });
          }
        }

        if (!showFallback) return slots;
        for (let el of Array.from(
          element.querySelectorAll<HTMLElement>('[data-boxel-bfm-type="card"]'),
        )) {
          let url =
            el.dataset.boxelBfmInlineRef || el.dataset.boxelBfmBlockRef || '';
          if (!resolvedEls.has(el) && url) {
            let kind: 'inline' | 'block' = el.dataset.boxelBfmInlineRef
              ? 'inline'
              : 'block';
            slots.push({
              element: el,
              url,
              typeName: cardTypeName(url),
              kind,
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
            if (current.kind !== slot.kind) return true;
            if (!!current.card !== !!slot.card) return true;
            if (current.card && slot.card) {
              return (
                current.card !== slot.card ||
                (current as ResolvedSlot).format !==
                  (slot as ResolvedSlot).format
              );
            }
            if (!current.card && !slot.card) {
              return (
                (current as UnresolvedSlot).url !== (slot as UnresolvedSlot).url
              );
            }
            return false;
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
      {{this.captureCardSlots this.renderedHtml this.loadedCards}}
    >
      {{this.renderedHtml}}
    </div>
    {{#each this.renderSlots key='element' as |slot|}}
      {{#in-element slot.element insertBefore=null}}
        {{#if slot.card}}
          {{#if (eq slot.kind 'inline')}}
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
        {{else}}
          {{#if (eq slot.kind 'inline')}}
            <Pill
              @variant='muted'
              @size='extra-small'
              title={{slot.url}}
              data-test-markdown-bfm-unresolved-inline
            >
              <:iconLeft><LinkOffIcon width='12' height='12' /></:iconLeft>
              <:default>{{slot.typeName}}</:default>
            </Pill>
          {{else}}
            <div
              class='markdown-bfm-unresolved--block'
              title={{slot.url}}
              data-test-markdown-bfm-unresolved-block
            >
              <Pill @variant='muted' @size='small'>
                <:iconLeft><LinkOffIcon width='14' height='14' /></:iconLeft>
                <:default>{{slot.typeName}}</:default>
              </Pill>
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

        /* Loading shimmer */
        .markdown-content :deep([data-boxel-bfm-type='card']:empty) {
          background-color: var(--boxel-light-200);
          border-radius: var(--boxel-border-radius-sm);
          position: relative;
          overflow: hidden;
        }
        .markdown-content :deep([data-boxel-bfm-type='card']:empty::after) {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(
            90deg,
            transparent,
            var(--boxel-light-100),
            transparent
          );
          animation: bfm-shimmer 1.6s linear 0.5s infinite;
          transform: translateX(-100%);
        }
        .markdown-content :deep([data-boxel-bfm-inline-ref]:empty) {
          display: inline-block;
          width: 6em;
          height: 1.2em;
          vertical-align: middle;
        }
        .markdown-content :deep([data-boxel-bfm-block-ref]:empty) {
          display: block;
          width: 100%;
          height: 3em;
        }
        @keyframes bfm-shimmer {
          0% {
            transform: translateX(-200%);
          }
          100% {
            transform: translateX(100%);
          }
        }

        /* Unresolved block indicator */
        .markdown-bfm-unresolved--block {
          display: block;
          margin: var(--boxel-sp-xxxs) 0;
        }
      } /* end @layer baseComponent */
    </style>
  </template>
}
