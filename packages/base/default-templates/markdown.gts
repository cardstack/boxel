import { task } from 'ember-concurrency';
import { scheduleOnce } from '@ember/runloop';
import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';

import { MarkdownContentShell } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import LinkOffIcon from '@cardstack/boxel-icons/link-off';

import {
  bfmRefFormatAndSize,
  bfmResolvedEmbedStyle,
  buildWaiter,
  cardTypeName,
  fileNameFromUrl,
  extractMermaidBlocks,
  processKatexPlaceholders,
  replaceMermaidSvgs,
  resolveRRIReference,
  rri,
  trimJsonExtension,
} from '@cardstack/runtime-common';
import {
  hasCodeBlocks,
  isMarkdownOverRenderLimit,
  markdownOversizedNoticeHtml,
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
    if (isMarkdownOverRenderLimit(content)) {
      return htmlSafe(markdownOversizedNoticeHtml(content));
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

          // Non-atom slots carry a footprint so the instance occupies a
          // definite box instead of collapsing (isolated/inline-embedded
          // default templates lay out at 100%). Fitted uses its requested
          // dimensions; embedded/isolated get shared defaults. The same style
          // goes on the loading shimmer and broken-link box so the layout
          // doesn't jump as the slot transitions between states, and the same
          // helper drives the other render surfaces so footprints stay in
          // lockstep.
          let styleRaw = bfmResolvedEmbedStyle(format, kind, sizeStyle);
          let style: ReturnType<typeof htmlSafe> | undefined = styleRaw
            ? htmlSafe(styleRaw)
            : undefined;

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
              style,
            });
            continue;
          }

          // No matching instance yet: show the sized loading shimmer until the
          // linked instances have settled (showFallback), then fall back to the
          // broken-link box. Skipping the broken state on the first modifier
          // run avoids flashing it for refs that will soon resolve.
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
    <MarkdownContentShell
      class='monaco-code-surface'
      {{this.captureCardSlots this.renderedHtml @linkedCards @linkedFiles}}
    >
      {{this.renderedHtml}}
    </MarkdownContentShell>
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
      /* Everything visual lives in MarkdownContentShell (boxel-ui) — the
         single source of the markdown stylesheet and the `--markdown-*`
         styling contract. This block carries only what is specific to this
         renderer: the Monaco editor surface variables its syntax-highlighted
         code blocks rely on, which the shell's `pre` rules pick up when
         defined and fall past to the muted surface when not. */
      @layer baseComponent {
        .monaco-code-surface {
          --vscode-editor-background: var(--boxel-dark);
          --vscode-editor-foreground: var(--boxel-light);
          --vscode-editorCodeLens-lineHeight: 15px;
          --vscode-editorCodeLens-fontSize: 10px;
          --vscode-editorCodeLens-fontFeatureSettings: 'liga' off, 'calt' off;
        }
      }
    </style>
  </template>
}
