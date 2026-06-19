import type { ComponentLike } from '@glint/template';
import type { Query } from './query.ts';
import type { Format } from './formats.ts';
import type { QueryResultsMeta } from './index-query-engine.ts';
import type { ResolvedCodeRef } from './code-ref.ts';

/**
 * @deprecated Backing data for the legacy prerendered-card view-model. The v2
 * `search-entry` model supersedes this shape — favor `RenderableSearchEntryLike`.
 * Removed once every consumer is on v2.
 */
export interface PrerenderedCardData {
  url: string;
  realmUrl: string;
  html: string;
  isError: boolean;
  cardType?: string;
  iconHtml?: string;
  usedRenderType?: ResolvedCodeRef;
  isFileMeta?: boolean;
}

/**
 * @deprecated Legacy per-row view-model consumed by `<PrerenderedCardSearch>`.
 * Favor the v2 `search-entry` shape `RenderableSearchEntryLike`, which a row
 * renders transparently (prerendered HTML inert or the live card). Removed once
 * every consumer is on v2.
 */
export interface PrerenderedCardLike {
  url: string;
  isError: boolean;
  realmUrl: string;
  component: ComponentLike<{ Args: {}; Element: Element }>;
  cardType?: string;
  iconHtml?: string;
  usedRenderType?: ResolvedCodeRef;
  // True iff the prerender pipeline produced HTML for this row. Currently
  // false for executable-module FileDef rows (`.gts`/`.ts`) because the
  // fused visit skips the FileRender pass when `isModule` is true — see
  // CS-11171. Consumers (e.g., CardList) can use this to render a fallback
  // when html is missing so the row stays visible and clickable.
  hasHtml?: boolean;
}

/**
 * @deprecated Glimmer signature of the legacy `<PrerenderedCardSearch>`
 * component. Favor the v2 `SearchResultsComponentSignature` (the
 * `@context.searchResultsComponent` / `<SearchResults>` contract). Removed once
 * every consumer is on v2.
 */
export interface PrerenderedCardComponentSignature {
  Element: undefined;
  Args: {
    query: Query;
    format: Format;
    realms: string[];
    cardUrls?: string[];
    isLive?: boolean;
  };
  Blocks: {
    loading: [];
    response: [cards: PrerenderedCardLike[]];
    meta: [meta: QueryResultsMeta];
  };
}
