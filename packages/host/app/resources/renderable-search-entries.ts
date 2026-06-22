import {
  isResolvedCodeRef,
  isValidPrerenderedHtmlFormat,
  RealmPaths,
  type CardResource,
  type ErrorEntry,
  type FileMetaResource,
  type Format,
  type HtmlQuery,
  type PrerenderedHtmlFormat,
  type ResolvedCodeRef,
  type Saved,
  type SearchEntryWireQuery,
  type StoreReadType,
} from '@cardstack/runtime-common';

import { htmlComponent } from '../lib/html-component';
import {
  hydratableEntryComponent,
  type EntryComponent,
} from '../lib/hydratable-entry-component';

import {
  getSearchEntriesResource,
  type SearchEntry,
  type SearchEntryRendering,
} from './search-entries';

import type { HydrationMode } from '../components/card-search/hydratable-card';

// The diagnostic/labeling attributes the prerendered HTML carries so consumers
// (e.g. the operator-mode overlay) can label and icon a card before its
// instance loads — mirrors what the legacy prerendered path stamped.
function extraAttributesFor(
  rendering: SearchEntryRendering,
  iconHtml: string | undefined,
): Record<string, string> {
  let attrs: Record<string, string> = {};
  if (rendering.isError) {
    attrs['data-is-error'] = 'true';
  }
  if (rendering.cardType) {
    attrs['data-card-type-display-name'] = rendering.cardType;
  }
  // The type icon rides as a deduped `icon` resource on the entry, not the
  // rendering — see `SearchEntry.iconHtml`.
  if (iconHtml) {
    attrs['data-card-type-icon-html'] = iconHtml;
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
export class RenderableSearchEntry {
  constructor(
    private raw: SearchEntry,
    private fallbackRenderType: ResolvedCodeRef | undefined,
    private fallbackFormat: PrerenderedHtmlFormat,
    private mode: HydrationMode,
  ) {}

  get id(): string {
    return this.raw.id;
  }

  // The URL of the realm hosting this result — used to group results by realm.
  get realmUrl(): string {
    return this.raw.realmUrl;
  }

  // The result's realm-local path (e.g. `Person/error`), shown by the host
  // error tile to identify which result failed. Falls back to the bare id when
  // the id isn't under the entry's realm.
  get name(): string {
    try {
      return new RealmPaths(new URL(this.raw.realmUrl)).local(
        new URL(this.raw.id),
      );
    } catch {
      return this.raw.id;
    }
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

  // The result's card-type descriptor, resolved from the deduped `icon`
  // resource — exposed so a consumer can render a type icon / name (and render
  // as the right type) for an item-only row without loading the live instance.
  get iconHtml(): string | undefined {
    return this.raw.iconHtml;
  }

  get displayName(): string | undefined {
    return this.raw.displayName;
  }

  get codeRef(): ResolvedCodeRef | undefined {
    return this.raw.codeRef;
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
          ? htmlComponent(html.html, extraAttributesFor(html, this.iconHtml))
          : undefined;
      this.#component = hydratableEntryComponent({
        cardId: this.id,
        name: this.name,
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

// Wraps `getSearchEntriesResource` with the render-stable view-model layer that
// `<SearchResults>` and bespoke consumers (the search sheet) share. The
// underlying resource is created once and parented to the owner (teardown +
// realm subscriptions ride with it); this object only memoizes view-models on
// top, so it holds no lifecycle of its own beyond the `WeakMap` (collected with
// the raw entries it keys on).
export class RenderableSearchEntries {
  // View-models memoized by raw-entry identity: the resource preserves a row's
  // object identity across live re-runs when nothing about it changed, so the
  // same render-stable view-model (and its built component) is reused —
  // unchanged rows are never re-mounted.
  #renderables = new WeakMap<SearchEntry, RenderableSearchEntry>();
  // The render inputs a view-model captures at construction (gesture mode + the
  // document-level fallback render type/format). They are not part of a row's
  // raw identity, so when any of them changes the memoized view-models are
  // stale and the cache is dropped.
  #renderInputsKey: string | undefined;

  constructor(
    private resource: ReturnType<typeof getSearchEntriesResource>,
    private getMode: () => HydrationMode,
  ) {}

  private get fallbackRenderType(): ResolvedCodeRef | undefined {
    return renderTypeFromHtmlQuery(this.resource.meta.htmlQuery);
  }

  private get fallbackFormat(): PrerenderedHtmlFormat {
    return formatFromHtmlQuery(this.resource.meta.htmlQuery);
  }

  get entries(): RenderableSearchEntry[] {
    let fallbackRenderType = this.fallbackRenderType;
    let fallbackFormat = this.fallbackFormat;
    let mode = this.getMode();
    let inputsKey = JSON.stringify([mode, fallbackRenderType, fallbackFormat]);
    if (inputsKey !== this.#renderInputsKey) {
      // Pure memoization bookkeeping — see the per-row note below. Dropping the
      // cache when the captured inputs change rebuilds view-models with the new
      // mode/render type/format instead of reusing stale ones. Mutates only
      // untracked private fields, so it dirties no tracked state.
      this.#renderInputsKey = inputsKey;
      this.#renderables = new WeakMap();
    }
    return this.resource.entries.map((raw) => {
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
      this.#renderables.set(raw, renderable);
      return renderable;
    });
  }

  get isLoading(): boolean {
    return this.resource.isLoading;
  }

  get meta() {
    return this.resource.meta;
  }

  get errors() {
    return this.resource.errors;
  }
}

// Build the render-stable view-model layer over a v2 search. Call exactly once
// per owner (a class field), never inside a getter or during render: it creates
// one `getSearchEntriesResource` parented to `owner`, and per-render calls would
// pile up live resources. Vary the search through the `getQuery` thunk (re-read
// reactively) and the hydration gesture through `getMode`; the resource is never
// rebuilt.
export function getRenderableSearchEntries(
  owner: object,
  getQuery: () => SearchEntryWireQuery | undefined,
  getMode: () => HydrationMode,
): RenderableSearchEntries {
  return new RenderableSearchEntries(
    getSearchEntriesResource(owner, getQuery),
    getMode,
  );
}
