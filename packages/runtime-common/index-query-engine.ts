// The query engine's public face. Main's engine lived here until Query V2's
// (query-engine/) replaced it; what callers import from this module (the
// index row types, the non-searchable-field error, the HTML join and
// error-state helpers) is now Query V2's, which held identical copies.

export { IndexQueryEngine } from './query-engine/index-query-engine.ts';
export {
  FilterRefersToNonsearchableFieldError,
  isFilterRefersToNonsearchableFieldError,
} from './query-engine/filter-paths.ts';
export {
  generalSortFields,
  MATCH_RELEVANCE_SORT_KEY,
  isMatchRelevanceSort,
} from './query-engine/types.ts';
export type {
  IndexedFile,
  IndexedInstance,
  IndexedInstanceSource,
  InstanceError,
  InstanceOrError,
  LinkTargetFile,
  LinkTargetInstance,
  QueryOptions,
  QueryResultsMeta,
  SearchProjection,
  WIPOptions,
} from './query-engine/types.ts';
export {
  effectiveHasError,
  fileEntryFromResult,
  prerenderedJoin,
} from './query-engine/index-sql.ts';
export { isValidPrerenderedHtmlFormat } from './prerendered-html-format.ts';
