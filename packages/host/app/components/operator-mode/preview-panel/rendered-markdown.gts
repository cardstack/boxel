// Host-side counterpart of the base-realm `MarkdownTemplate` component
// (`packages/base/default-templates/markdown.gts`).  The base-realm version
// cannot be imported directly from host code (only type imports are allowed),
// so this component reuses the same shared utilities (`markdownToHtml`,
// `extractCardReferenceUrls`, `cardTypeName`) and follows the same rendering
// pattern: convert markdown → HTML, capture BFM card-reference placeholders
// via a modifier, then render live cards into those slots with `#in-element`.
// The markdown stylesheet itself is not duplicated: both renderers project
// into boxel-ui's MarkdownContentShell, the single source of the typography
// rules and the `--markdown-*` styling contract.

import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';

import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import LinkOffIcon from '@cardstack/boxel-icons/link-off';
import { beacon } from '@cardstack/choreo';
import { task } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { modifier } from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import { MarkdownContentShell } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  bfmRefFormatAndSize,
  bfmResolvedEmbedStyle,
  CardContextName,
  cardTypeName,
  extractCardReferenceUrls,
  extractFileReferenceUrls,
  fileNameFromUrl,
  isCardErrorJSONAPI,
  resolveRRIReference,
  rri,
  trimJsonExtension,
} from '@cardstack/runtime-common';
import {
  isMarkdownOverRenderLimit,
  markdownOversizedNoticeHtml,
  markdownToHtml,
} from '@cardstack/runtime-common/marked-sync';

import CardRenderer from '@cardstack/host/components/card-renderer';
import { cardRefLabel } from '@cardstack/host/lib/reply-furniture';

import type StoreService from '@cardstack/host/services/store';

import type {
  CardContext,
  CardDef,
  FileDef,
  Format,
} from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

type CardSlotFormat = 'atom' | 'embedded' | 'fitted' | 'isolated';
type SlotState = 'resolved' | 'loading' | 'unresolved';
type RefType = 'card' | 'file';

interface RenderSlot {
  element: HTMLElement;
  // 'card' refs (`:card[URL]`) resolve to CardDef instances; 'file' refs
  // (`:file[URL]`) resolve to FileDef instances. Both slot kinds are wired to
  // `cardContext.cardComponentModifier` so operator-mode overlays can target
  // them (the overlay layer distinguishes card vs. file targets).
  refType: RefType;
  kind: 'inline' | 'block';
  state: SlotState;
  format: CardSlotFormat;
  // Inline sizing (width/height) so loading and broken placeholders match the
  // eventual card's footprint; also carries `overflow: hidden` for resolved
  // fitted cards.
  style?: ReturnType<typeof htmlSafe>;
  // a sized slot whose size names no height: a fitted card in it is a size
  // container its content cannot grow, so the drawing card picks a height
  heightless?: boolean;
  card?: CardDef; // present when refType === 'card' && state === 'resolved'
  file?: FileDef; // present when refType === 'file' && state === 'resolved'
  url?: string; // present when state === 'loading' | 'unresolved'
  typeName?: string; // present when state === 'unresolved': the ref's name
}

function resolveUrl(raw: string, baseUrl: string | undefined): string {
  try {
    // Resolve in RRI space (no VirtualNetwork), the same way
    // `extractCardReferenceUrls`/`extractFileReferenceUrls` resolve the refs
    // that key `loadedCards`/`loadedFiles` — so a slot's resolved key matches
    // the loaded instance's map key.
    return trimJsonExtension(
      resolveRRIReference(raw, baseUrl ? rri(baseUrl) : undefined),
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

interface SlotCardSignature {
  Args: {
    card: CardDef | FileDef;
    format: Format;
    heightless?: boolean;
  };
}

const BareSlotCard: TemplateOnlyComponent<SlotCardSignature> = <template>
  <CardRenderer
    @card={{@card}}
    @format={{@format}}
    @displayContainer={{false}}
  />
</template>;

interface Signature {
  Args: {
    content: string | null | undefined;
    cardReferenceBaseUrl?: string | null;
    /** the assistant's Quick Look: when given, each card or file this
     * renders publishes its box as the beacon `<prefix>:<id>` (the place
     * the Quick Look sheet comes out of) and takes keyboard focus, so
     * Space or Enter can open it */
    lookKeyPrefix?: string;
    /** draws a card the content shows as a block, in place of the bare
     * CardRenderer: the assistant gives its cards a hat and a menu */
    blockCard?: ComponentLike<{
      Args: { card: CardDef; format: Format; heightless?: boolean };
    }>;
    /** draws every other resolved card or file, in place of the bare
     * CardRenderer: the assistant styles the chrome of the cards in a reply
     * through a class on its own component */
    slotCard?: ComponentLike<SlotCardSignature>;
    /** an inline card still loading shows a name taken from its URL, in
     * place of a bare placeholder, so its width holds when the card lands */
    loadingLabels?: boolean;
  };
}

// Fallback when no CardContext is provided (e.g. in tests without operator-mode).
// Only the subset of fields used by RenderedMarkdown is stubbed; the rest come
// from the dynamicCardContext injected at runtime.
const DEFAULT_CARD_CONTEXT: Partial<CardContext> = {
  cardComponentModifier: class NoOpModifier extends Modifier<any> {
    modify() {}
  },
  toolContext: undefined,
};

export default class RenderedMarkdown extends Component<Signature> {
  @service declare private store: StoreService;
  @consume(CardContextName) declare private dynamicCardContext: CardContext;

  private get cardContext(): CardContext {
    return {
      ...DEFAULT_CARD_CONTEXT,
      ...this.dynamicCardContext,
    } as CardContext;
  }

  private get slotCard() {
    return this.args.slotCard ?? BareSlotCard;
  }

  private get blockCard() {
    return this.args.blockCard ?? this.slotCard;
  }

  private lookKey = (id: string | undefined) =>
    this.args.lookKeyPrefix && id ? `${this.args.lookKeyPrefix}:${id}` : '';

  @tracked renderSlots: RenderSlot[] = [];
  @tracked private loadedCards = new Map<string, CardDef>();
  @tracked private loadedFiles = new Map<string, FileDef>();
  private _modifierHasRun = false;
  // Recomputes the slots from the cards loaded so far; set by the slot
  // modifier. The loads call it when they land: the modifier is not re-run
  // for a new map on its own every time, and a slot left "broken" by an
  // earlier pass would stay that way.
  private refreshSlots: (() => void) | undefined;

  // ── HTML rendering ──

  @cached
  get renderedHtml() {
    let content = this.args.content;
    // Skip the parse entirely for over-limit content so a multi-MB `.md` file
    // or field value cannot block the render thread on the synchronous
    // parse + sanitize + DOMParser pipeline.
    if (isMarkdownOverRenderLimit(content)) {
      return htmlSafe(markdownOversizedNoticeHtml(content));
    }
    let html = markdownToHtml(content);
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
    );
  }

  @cached
  private get fileReferenceUrls(): string[] {
    if (!this.args.content) return [];
    return extractFileReferenceUrls(
      this.args.content,
      this.args.cardReferenceBaseUrl ?? '',
    );
  }

  // A card the store already holds, for a ref this renderer has not loaded
  // itself yet
  private cachedCard(url: string): CardDef | undefined {
    let cached = this.store.peek(url);
    return cached && !isCardErrorJSONAPI(cached)
      ? (cached as CardDef)
      : undefined;
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
    this.refreshSlots?.();
  });

  private loadReferencedFiles = task({ restartable: true }, async () => {
    let urls = this.fileReferenceUrls;
    if (!urls.length) return;

    let files = new Map<string, FileDef>();
    await Promise.all(
      urls.map(async (url) => {
        try {
          let result = await this.store.get(url, {
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
    this.refreshSlots?.();
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
          let heightless = Boolean(styleRaw && !styleRaw.includes('height'));

          let resolvedUrl = resolveUrl(rawUrl, baseUrl);

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
                style,
                heightless,
              });
              continue;
            }
          } else {
            let card =
              cardsByUrl.get(resolvedUrl) ?? this.cachedCard(resolvedUrl);
            if (card) {
              slots.push({
                element: el,
                refType,
                kind,
                state: 'resolved',
                format,
                card,
                style,
                heightless,
              });
              continue;
            }
          }

          // No matching instance yet: show the sized loading shimmer until the
          // load settles (showFallback), then fall back to the broken-link box.
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
              // the card's own name from its id, so two broken refs to the
              // same type still read apart; the type only when the id says
              // nothing
              typeName:
                refType === 'file'
                  ? fileNameFromUrl(rawUrl)
                  : cardRefLabel(rawUrl) || cardTypeName(rawUrl),
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
      this.refreshSlots = scheduleUpdate;

      if (typeof MutationObserver === 'undefined') return;

      let observer = new MutationObserver(scheduleUpdate);
      observer.observe(element, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
  );

  <template>
    <MarkdownContentShell
      {{this.captureCardSlots
        this.renderedHtml
        this.loadedCards
        this.loadedFiles
      }}
    >
      {{this.renderedHtml}}
    </MarkdownContentShell>
    {{#each this.renderSlots key='element' as |slot|}}
      {{#in-element slot.element insertBefore=null}}
        {{#if (eq slot.state 'resolved')}}
          {{#if (eq slot.refType 'file')}}
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
                data-test-markdown-bfm-inline-file
                data-card-ref={{slot.file.id}}
                data-card-ref-kind='file'
                tabindex={{if @lookKeyPrefix '0'}}
                {{beacon (this.lookKey slot.file.id)}}
                {{this.cardContext.cardComponentModifier
                  cardId=slot.file.id
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
              >
                <this.slotCard
                  @card={{slot.file}}
                  @format={{slot.format}}
                  @heightless={{slot.heightless}}
                />
              </span>
            {{else}}
              <div
                class='markdown-bfm-card-slot markdown-bfm-card-slot--block
                  {{if slot.style "markdown-bfm-card-slot--fitted"}}'
                style={{slot.style}}
                data-test-markdown-bfm-block-file
                data-card-ref={{slot.file.id}}
                data-card-ref-kind='file'
                tabindex={{if @lookKeyPrefix '0'}}
                {{beacon (this.lookKey slot.file.id)}}
                {{this.cardContext.cardComponentModifier
                  cardId=slot.file.id
                  format='data'
                  fieldType=undefined
                  fieldName=undefined
                }}
              >
                <this.slotCard
                  @card={{slot.file}}
                  @format={{slot.format}}
                  @heightless={{slot.heightless}}
                />
              </div>
            {{/if}}
          {{else if (eq slot.kind 'inline')}}
            <span
              class='markdown-bfm-card-slot
                {{if
                  (eq slot.format "atom")
                  "markdown-bfm-card-slot--inline"
                  "markdown-bfm-card-slot--inline-embed"
                }}
                {{if slot.style "markdown-bfm-card-slot--fitted"}}'
              style={{slot.style}}
              data-test-markdown-bfm-inline-card
              data-card-ref={{slot.card.id}}
              data-card-ref-kind='card'
              tabindex={{if @lookKeyPrefix '0'}}
              {{beacon (this.lookKey slot.card.id)}}
              {{this.cardContext.cardComponentModifier
                card=slot.card
                format='data'
                fieldType=undefined
                fieldName=undefined
              }}
            >
              <this.slotCard
                @card={{slot.card}}
                @format={{slot.format}}
                @heightless={{slot.heightless}}
              />
            </span>
          {{else}}
            <div
              class='markdown-bfm-card-slot markdown-bfm-card-slot--block
                {{if slot.style "markdown-bfm-card-slot--fitted"}}'
              style={{slot.style}}
              data-test-markdown-bfm-block-card
              data-card-ref={{slot.card.id}}
              data-card-ref-kind='card'
              tabindex={{if @lookKeyPrefix '0'}}
              {{beacon (this.lookKey slot.card.id)}}
              {{this.cardContext.cardComponentModifier
                card=slot.card
                format='data'
                fieldType=undefined
                fieldName=undefined
              }}
            >
              <this.blockCard
                @card={{slot.card}}
                @format={{slot.format}}
                @heightless={{slot.heightless}}
              />
            </div>
          {{/if}}
        {{else if (eq slot.state 'loading')}}
          {{#if (eq slot.kind 'inline')}}
            {{#if (eq slot.format 'atom')}}
              <span
                class='markdown-bfm-loading markdown-bfm-loading--inline'
                aria-hidden='true'
                data-test-markdown-bfm-loading-inline
              >{{#if @loadingLabels}}{{cardRefLabel slot.url}}{{/if}}</span>
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
  </template>
}
