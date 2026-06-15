import type { ComponentLike } from '@glint/template';

import type { ResolvedCodeRef } from './code-ref.ts';
import type { SearchEntryCollectionDocument } from './document-types.ts';
import type { ErrorEntry } from './index.ts';
import type { PrerenderedHtmlFormat } from './prerendered-html-format.ts';
import type {
  CardResource,
  FileMetaResource,
  Saved,
} from './resource-types.ts';
import type { SearchEntryWireQuery } from './search-entry.ts';

// How an HTML-backed search result becomes a live, running card. `none` stays
// inert; `hover` / `click` / `touch` fetch the card on the matching gesture and
// swap the inert HTML for a live render. A host-side UX choice — it never
// travels on the wire.
export type HydrationMode = 'none' | 'hover' | 'click' | 'touch';

// One rendering of a search result: the wire's `html` resource flattened, with
// its `styles` references resolved to the stylesheets' hrefs. `id` is the
// (card URL, format, renderType) composite — an opaque cache key; the readable
// rendering dimensions are the `format` / `renderType` fields.
export interface SearchEntryRendering {
  id: string;
  // Absent only on an error rendering with no last-known-good HTML.
  html?: string;
  cardType: string;
  iconHtml?: string;
  isError: boolean;
  format: PrerenderedHtmlFormat;
  // The type this rendering was rendered as. A file rendering carries none
  // (files render natively).
  renderType?: ResolvedCodeRef;
  cssUrls: string[];
}

// One v2 search result as a renderable view-model. `component` renders the
// result transparently — prerendered HTML inert (hydrated lazily) or a live
// card — so a consumer renders `<entry.component />` without ever branching on
// prerendered-vs-live. `html` / `item` are the raw branches, exposed for custom
// rendering.
export interface RenderableSearchEntryLike {
  // The card/file identity URL.
  id: string;
  isError: boolean;
  // The chosen prerendered rendering, when the result carries one.
  html?: SearchEntryRendering;
  // The raw live serialization branch (full or sparse), when present.
  item?: CardResource<Saved> | FileMetaResource;
  // The ready-to-render component: renders `html` inert (hydrating lazily) or
  // the `item` serialization live, owning the prerendered-vs-live split so the
  // consumer never branches on it.
  component: ComponentLike<{ Args: {}; Element: Element }>;
}

// The block argument `<SearchResults>` yields: the heterogeneous result stream
// plus its loading / meta / error state.
export interface SearchResultsYield {
  entries: RenderableSearchEntryLike[];
  isLoading: boolean;
  meta: SearchEntryCollectionDocument['meta'];
  errors: ErrorEntry[] | undefined;
}

// The card-facing contract for the v2 search component the host provides on
// `@context` (`@context.searchResultsComponent`). It consumes the heterogeneous
// `search-entry` stream for a `search-entry`-rooted query and renders it
// transparently — prerendered HTML inert (hydrated lazily) or the live
// serialization. Used with a block it yields a `results` object
// (`entries` / `isLoading` / `meta` / `errors`); used without one it renders
// the default stream of `entry.component`s itself.
export interface SearchResultsComponentSignature {
  Element: HTMLElement;
  Args: {
    // The `search-entry`-rooted v2 query. Re-issued live on invalidation;
    // changing it re-runs the search. Undefined → idle (no results).
    query: SearchEntryWireQuery | undefined;
    // The hydration gesture for HTML-backed rows — a host-UX choice, never on
    // the wire. A full live row ignores it. Defaults to `hover`; pass `none` to
    // keep rows inert, `click` / `touch` to gate on those gestures.
    mode?: HydrationMode;
  };
  Blocks: {
    default: [SearchResultsYield];
  };
}
