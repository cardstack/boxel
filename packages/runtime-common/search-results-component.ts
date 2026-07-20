import type { ComponentLike } from '@glint/template';

import type { ResolvedCodeRef } from './code-ref.ts';
import type { EntryCollectionDocument } from './document-types.ts';
import type { ErrorEntry } from './error.ts';
import type { PrerenderedHtmlFormat } from './prerendered-html-format.ts';
import type {
  CardResource,
  FileMetaResource,
  Saved,
} from './resource-types.ts';
import type { SearchEntryWireQuery } from './search-entry.ts';

// How an HTML-backed search result becomes a live, running card. `none` stays
// inert; `hover` fetches the card on pointer-hover / keyboard-focus and swaps
// the inert HTML for a live render. A host-side UX choice — it never travels on
// the wire.
export type HydrationMode = 'none' | 'hover';

// One rendering of a search result: the wire's `html` resource flattened, with
// its `styles` references resolved to the stylesheets' hrefs. `id` is the
// (card URL, format, renderType) composite — an opaque cache key; the readable
// rendering dimensions are the `format` / `renderType` fields.
export interface SearchEntryRendering {
  id: string;
  // Absent only on an error rendering with no last-known-good HTML.
  html?: string;
  cardType: string;
  isError: boolean;
  format: PrerenderedHtmlFormat;
  // The type this rendering was rendered as. A file rendering carries none
  // (files render natively).
  renderType?: ResolvedCodeRef;
  cssUrls: string[];
}

// One search result as a renderable view-model. `component` renders the
// result transparently — prerendered HTML inert (hydrated lazily) or a live
// card — so a consumer renders `<entry.component />` without ever branching on
// prerendered-vs-live. `html` / `item` are the raw branches, exposed for custom
// rendering.
export interface RenderableSearchEntryLike {
  // The card/file identity URL.
  id: string;
  // The URL of the realm hosting this result — used to group results by realm.
  realmUrl: string;
  // Whether this result is a card instance or a file — lets a consumer (e.g. a
  // mixed card/file chooser) tag a selection by kind without inspecting the id.
  kind: 'card' | 'file';
  // The result's realm-local path (e.g. `Person/error`) — a readable label a
  // consumer shows on an error tile to identify which result failed. Falls back
  // to the bare id when the id isn't under the entry's realm.
  name: string;
  isError: boolean;
  // The result's card-type descriptor, resolved from the deduped `icon`
  // resource — present whenever the row's native type has one. Carried on the
  // entry (not the rendering) so an item-only / no-HTML row exposes it too:
  // the type's icon HTML, display name, and code ref.
  iconHtml?: string;
  displayName?: string;
  codeRef?: ResolvedCodeRef;
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
  meta: EntryCollectionDocument['meta'];
  errors: ErrorEntry[] | undefined;
}

// The card-facing contract for the search component the host provides on
// `@context` (`@context.searchResultsComponent`). It consumes the heterogeneous
// `entry` stream for an `entry`-rooted query and renders it
// transparently — prerendered HTML inert (hydrated lazily) or the live
// serialization. Used with a block it yields a `results` object
// (`entries` / `isLoading` / `meta` / `errors`); used without one it renders
// the default stream of `entry.component`s itself.
export interface SearchResultsComponentSignature {
  Element: HTMLElement;
  Args: {
    // The `entry`-rooted query. Re-issued live on invalidation;
    // changing it re-runs the search. Undefined → idle (no results).
    query: SearchEntryWireQuery | undefined;
    // The hydration gesture for HTML-backed rows — a host-UX choice, never on
    // the wire. A full live row ignores it. Defaults to `hover`; pass `none` to
    // keep rows inert.
    mode?: HydrationMode;
    // Whether rendered results register with the operator-mode overlay (the
    // card-type chip / options menu / selection toggle). Defaults to `true`;
    // pass `false` for a card that lays results out in its own UI and wants
    // them rendered plainly, with no overlay even inside operator mode.
    overlays?: boolean;
  };
  Blocks: {
    default: [SearchResultsYield];
  };
}
