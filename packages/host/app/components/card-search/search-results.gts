import { service } from '@ember/service';
import Component from '@glimmer/component';

import { modifier } from 'ember-modifier';

import {
  isResolvedCodeRef,
  isValidPrerenderedHtmlFormat,
  logger as runtimeLogger,
  type CardResource,
  type ErrorEntry,
  type FileMetaResource,
  type Format,
  type HtmlQuery,
  type PrerenderedHtmlFormat,
  type ResolvedCodeRef,
  type Saved,
  type SearchResultsComponentSignature,
  type SearchResultsYield,
  type StoreReadType,
} from '@cardstack/runtime-common';

import { htmlComponent } from '../../lib/html-component';
import {
  hydratableEntryComponent,
  type EntryComponent,
} from '../../lib/hydratable-entry-component';
import {
  getSearchEntriesResource,
  type SearchEntry,
  type SearchEntryRendering,
} from '../../resources/search-entries';

import type { HydrationMode } from './hydratable-card';

import type StoreService from '../../services/store';

// The diagnostic/labeling attributes the prerendered HTML carries so consumers
// (e.g. the operator-mode overlay) can label and icon a card before its
// instance loads — mirrors what the legacy prerendered path stamped.
function extraAttributesFor(
  rendering: SearchEntryRendering,
): Record<string, string> {
  let attrs: Record<string, string> = {};
  if (rendering.isError) {
    attrs['data-is-error'] = 'true';
  }
  if (rendering.cardType) {
    attrs['data-card-type-display-name'] = rendering.cardType;
  }
  if (rendering.iconHtml) {
    attrs['data-card-type-icon-html'] = rendering.iconHtml;
  }
  return attrs;
}

// The query's requested render type, echoed once at the document level. Used
// to render an item-only (live) fallback as the same ancestor its HTML
// siblings would have rendered as. Only a single `eq` leaf names one type; a
// composite html query has no single render type, so the fallback renders
// natively.
function renderTypeFromHtmlQuery(
  query: HtmlQuery | undefined,
): ResolvedCodeRef | undefined {
  if (query && 'eq' in query) {
    let renderType = query.eq.renderType;
    if (renderType && isResolvedCodeRef(renderType)) {
      return renderType;
    }
  }
  return undefined;
}

// The query's requested format, echoed once at the document level. Used so an
// item-only (live) fallback renders at the same format the HTML rows the query
// selected would have. A composite html query (no single `eq` leaf) and the
// default both fall back to `fitted`.
function formatFromHtmlQuery(
  query: HtmlQuery | undefined,
): PrerenderedHtmlFormat {
  if (query && 'eq' in query && isValidPrerenderedHtmlFormat(query.eq.format)) {
    return query.eq.format;
  }
  return 'fitted';
}

// One v2 search result as a renderable view-model. Wraps the resource's raw
// `SearchEntry`, exposing the chosen `html` rendering, the raw `item`
// serialization, and a ready-to-render `component` that renders HTML inert (and
// hydrates it lazily) or resolves a full live row — so a consumer renders
// `<entry.component />` without branching on prerendered-vs-live.
class RenderableSearchEntry {
  constructor(
    private raw: SearchEntry,
    private fallbackRenderType: ResolvedCodeRef | undefined,
    private fallbackFormat: PrerenderedHtmlFormat,
    private mode: HydrationMode,
  ) {}

  get id(): string {
    return this.raw.id;
  }

  // The chosen prerendered rendering. The query's htmlQuery selects one
  // format × render type, so the resource's `html` array holds at most the one
  // matching rendering. Absent → an item-only (live) row.
  get html(): SearchEntryRendering | undefined {
    return this.raw.html[0];
  }

  // The raw live serialization branch (full or sparse), when present.
  get item(): CardResource<Saved> | FileMetaResource | undefined {
    return this.raw.item;
  }

  // The error doc carried on the `item` serialization's `meta`. Present => the
  // live item cannot render, so the row falls through to the host error
  // component and the item is never deposited into the Store.
  get itemErrorDoc(): ErrorEntry | undefined {
    return this.item?.meta.error;
  }

  // The row is in an error state when its chosen rendering is an error
  // rendering (a last-known-good or bare error placeholder, both
  // non-hydratable) or its `item` serialization carries an error doc. Drives
  // both "never hydrate" and the fall-through to the host error component.
  get isError(): boolean {
    return (this.html?.isError ?? false) || this.itemErrorDoc != null;
  }

  // The error doc the host error component surfaces (rung 4). It comes from the
  // `item`'s `meta`; an error rendering with no last-known-good HTML and no
  // item carries no doc, so the component shows a generic message.
  get errorDoc(): ErrorEntry | undefined {
    return this.itemErrorDoc;
  }

  // `card` vs `file-meta`: the serialization carries its own type; an HTML-only
  // row is a file when its rendering carries no render type (files render
  // natively; a card rendering always names one).
  get type(): StoreReadType {
    if (this.item) {
      return this.item.type === 'file-meta' ? 'file-meta' : 'card';
    }
    if (this.html && !this.html.renderType) {
      return 'file-meta';
    }
    return 'card';
  }

  // The type the live/hydrated card renders as: the rendering's own resolved
  // type for an HTML-backed row, the query's requested ancestor for an
  // item-only fallback (so it matches its HTML siblings), else native.
  get renderType(): ResolvedCodeRef | undefined {
    return this.html ? this.html.renderType : this.fallbackRenderType;
  }

  // The format the live/hydrated card renders as: the rendering's own format for
  // an HTML-backed row, the query's requested format for an item-only fallback
  // (so it matches its HTML siblings).
  get format(): Format {
    return this.html ? this.html.format : this.fallbackFormat;
  }

  // Built once, lazily: an inert row never reaches here, and an unchanged row
  // keeps the same component object across live re-runs (its view-model is
  // memoized by raw-entry identity), so the rendered list stays render-stable.
  #component: EntryComponent | undefined;
  get component(): EntryComponent {
    if (this.#component === undefined) {
      let { html } = this;
      let inert =
        html && html.html != null
          ? htmlComponent(html.html, extraAttributesFor(html))
          : undefined;
      this.#component = hydratableEntryComponent({
        cardId: this.id,
        component: inert,
        renderType: this.renderType,
        type: this.type,
        format: this.format,
        isError: this.isError,
        errorDoc: this.errorDoc,
        mode: this.mode,
      });
    }
    return this.#component;
  }
}

// The one v2 search component family. Consumes the heterogeneous `search-entry`
// stream from `getSearchEntriesResource` and renders it transparently —
// prerendered HTML inert (the fast path, hydrated lazily on interaction) or the
// live serialization. Used with a block it yields a `results` object
// (`entries` / `isLoading` / `meta` / `errors`); used without one it renders
// the default stream of `entry.component`s itself. Additive: it supersedes the
// `prerendered-card-search` component and the live `SearchContent` tree as call
// sites migrate.
export default class SearchResults extends Component<SearchResultsComponentSignature> {
  @service declare private store: StoreService;

  // Created once per component (the resource owns its own realm subscriptions
  // and re-runs); the query varies through the reactive thunk, never by
  // rebuilding the resource.
  private searchEntries = getSearchEntriesResource(this, () => this.args.query);

  // View-models memoized by raw-entry identity: the resource preserves a row's
  // object identity across live re-runs when nothing about it changed, so the
  // same render-stable view-model (and its built component) is reused.
  #renderables = new WeakMap<SearchEntry, RenderableSearchEntry>();
  // The render inputs a view-model captures at construction (gesture mode + the
  // document-level fallback render type/format). They are not part of a row's
  // raw identity, so when any of them changes the memoized view-models are
  // stale and the cache is dropped.
  #renderInputsKey: string | undefined;
  #log = runtimeLogger('search-results');

  private get mode(): HydrationMode {
    return this.args.mode ?? 'hover';
  }

  private get fallbackRenderType(): ResolvedCodeRef | undefined {
    return renderTypeFromHtmlQuery(this.searchEntries.meta.htmlQuery);
  }

  private get fallbackFormat(): PrerenderedHtmlFormat {
    return formatFromHtmlQuery(this.searchEntries.meta.htmlQuery);
  }

  private get entries(): RenderableSearchEntry[] {
    let fallbackRenderType = this.fallbackRenderType;
    let fallbackFormat = this.fallbackFormat;
    let mode = this.mode;
    let inputsKey = JSON.stringify([mode, fallbackRenderType, fallbackFormat]);
    if (inputsKey !== this.#renderInputsKey) {
      // Pure memoization bookkeeping — see the per-row note below. Dropping the
      // cache when the captured inputs change rebuilds view-models with the new
      // mode/render type/format instead of reusing stale ones.
      // eslint-disable-next-line ember/no-side-effects
      this.#renderInputsKey = inputsKey;
      // eslint-disable-next-line ember/no-side-effects
      this.#renderables = new WeakMap();
    }
    return this.searchEntries.entries.map((raw) => {
      let existing = this.#renderables.get(raw);
      if (existing) {
        return existing;
      }
      let renderable = new RenderableSearchEntry(
        raw,
        fallbackRenderType,
        fallbackFormat,
        mode,
      );
      // Pure memoization keyed on the resource's stable entry identity — it
      // dirties no tracked state, and keeping unchanged rows' view-models (and
      // their built components) prevents a live re-run from re-mounting every
      // HydratableCard.
      // eslint-disable-next-line ember/no-side-effects
      this.#renderables.set(raw, renderable);
      return renderable;
    });
  }

  private get results(): SearchResultsYield {
    return {
      entries: this.entries,
      isLoading: this.searchEntries.isLoading,
      meta: this.searchEntries.meta,
      errors: this.searchEntries.errors,
    };
  }

  // Selective Store inflate: deposit only full `item` serializations so a
  // by-URL read (or the hydration GET) resolves without a round-trip. Sparse
  // items and `search-entry`s are never deposited (the store method no-ops on a
  // sparse item); an item carrying an error doc is skipped here too — it stands
  // in for a card that failed to render and must not enter the Store. A
  // render-side effect keyed on the live entry set, so it deposits an
  // item-bearing row whenever one lands on a re-run.
  private inflateFullItems = modifier(
    (_element: Element, [entries]: [RenderableSearchEntry[]]) => {
      for (let entry of entries) {
        if (entry.item && !entry.itemErrorDoc) {
          // Fire-and-forget; a deposit failure (e.g. a malformed resource)
          // must not reject unhandled mid-render — the row still renders
          // (resolving its instance on demand) and the next re-run retries.
          this.store
            .inflateSearchEntryItem(entry.item)
            .catch((err: unknown) => {
              this.#log.error(
                `failed to inflate search-entry item ${entry.id}`,
                err,
              );
            });
        }
      }
    },
  );

  <template>
    <div
      class='search-results'
      {{this.inflateFullItems this.entries}}
      data-test-search-results
      ...attributes
    >
      {{#if (has-block)}}
        {{yield this.results}}
      {{else}}
        {{#each this.results.entries key='id' as |entry|}}
          <entry.component data-test-search-result={{entry.id}} />
        {{/each}}
      {{/if}}
    </div>
    <style scoped>
      .search-results {
        display: contents;
      }
    </style>
  </template>
}
