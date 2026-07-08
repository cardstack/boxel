import type { CardResource } from './resource-types.ts';
import type { SerializedError } from './error.ts';
import type { PgPrimitive } from './expression.ts';

export interface BoxelIndexTable {
  url: string;
  file_alias: string;
  generation: number;
  realm_url: string;
  type: 'instance' | 'file';
  has_error: boolean | null;
  // TODO in followup PR update this to be a document not a resource
  pristine_doc: CardResource | null;
  error_doc: SerializedError | null;
  search_doc: Record<string, PgPrimitive> | null;
  // `deps` is a list of URLs that the card depends on, either card URL's or
  // module URL's
  deps: string[] | null;
  // `last_known_good_deps` preserves deps from the most recent successful indexing
  // and is not overwritten during error cycles
  last_known_good_deps: string[] | null;
  // `types` is the adoption chain for card where each code ref is serialized
  // using `internalKeyFor()`
  types: string[] | null;
  display_names: string[] | null;
  head_html: string | null;
  embedded_html: Record<string, string> | null;
  fitted_html: Record<string, string> | null;
  isolated_html: string | null;
  atom_html: string | null;
  icon_html: string | null;
  markdown: string | null;
  indexed_at: string | null; // pg represents big integers as strings in javascript
  last_modified: string | null; // pg represents big integers as strings in javascript
  resource_created_at: string | null; // pg represents big integers as strings in javascript
  is_deleted: boolean | null;
  // Per-row render diagnostics. Carries the render timing breakdown
  // (launch/waits, render elapsed, host-side renderStage, top-N module
  // evaluations, etc.) plus non-timing render findings — notably
  // `brokenLinks`, the broken `linksTo` / `linksToMany` targets the
  // render surfaced. Populated on every updateEntry — success or error —
  // so operators can post-hoc investigate slow (but not failing) renders
  // and enumerate cards with broken links. See `Diagnostics` in `index.ts`.
  diagnostics: Record<string, unknown> | null;
  // Originating worker job id. Stamped on every working-table write so
  // a retry of the same job can find (and skip) URLs the previous
  // attempt already processed. Only present on `boxel_index_working`
  // — the production `boxel_index` mirror does not carry this column,
  // hence the field is optional.
  job_id?: number | null;
}

// Prerendered HTML lives on its own channel, separate from the search-doc
// index in `boxel_index`. One row per (url, realm_url, type), one column per
// HTML format. `icon_html` deliberately is NOT here — the icon renders in the
// index visit and stays on `boxel_index`. `generation` correlates a rendering
// with the index data it belongs to (fresh when it equals the matching
// `boxel_index` row's generation). A render error rides on `error_doc` here;
// an index error rides on `boxel_index.error_doc`; an instance's effective
// error is the union of the two.
export interface PrerenderedHtmlTable {
  url: string;
  file_alias: string;
  realm_url: string;
  type: 'instance' | 'file';
  fitted_html: Record<string, string> | null;
  embedded_html: Record<string, string> | null;
  atom_html: string | null;
  head_html: string | null;
  isolated_html: string | null;
  // The full-text `matches` predicate and its GIN index read this column.
  markdown: string | null;
  // Scoped-CSS URLs / deps needed to serve the HTML. `last_known_good_deps`
  // is the fallback preserved through error cycles.
  deps: string[] | null;
  last_known_good_deps: string[] | null;
  generation: number;
  is_deleted: boolean | null;
  error_doc: SerializedError | null;
  rendered_at: string | null; // pg represents big integers as strings in javascript
  // Originating worker job id. Only present on `prerendered_html_working`;
  // the production `prerendered_html` mirror does not carry this column,
  // hence the field is optional.
  job_id?: number | null;
}

export interface RealmGenerationsTable {
  realm_url: string;
  current_generation: number;
  // Opaque token identifying the realm's loader epoch: re-minted by any
  // index pass whose invalidation set includes executable modules. The
  // /render route resets its loader when a render's threaded epoch differs
  // from the one the tab last cleared for. '0' is the no-epoch-yet
  // sentinel (a realm no pass with executables has committed against).
  loader_epoch: string;
}

export interface CardTypeSummary {
  code_ref: string;
  display_name: string;
  total: number;
  icon_html: string;
}

// Top-level shape of `realm_meta.value`. `instances` summarizes CardDef rows
// (boxel_index.type='instance') and `files` summarizes FileDef rows
// (boxel_index.type='file'). Both arrays use the same per-type-summary shape.
// CardsGrid's sidebar partitions these into the "All Cards" and "All Files"
// top-level groups.
//
// Legacy realms written before this column was partitioned stored `value` as a
// bare `CardTypeSummary[]` (instances only). Readers should call
// `normalizeRealmMetaValue` (defined below) to tolerate that shape during the
// transition until every realm has been reindexed.
export interface RealmMetaValue {
  instances: CardTypeSummary[];
  files: CardTypeSummary[];
}

export interface RealmMetaTable {
  generation: number;
  realm_url: string;
  value: RealmMetaValue;
  indexed_at: string | null;
}

// Tolerate the legacy `value` shape (a bare CardTypeSummary[]) stored before
// realm_meta was partitioned into instances/files. Once every realm has been
// reindexed, the array branch becomes dead code and can be removed.
export function normalizeRealmMetaValue(raw: unknown): RealmMetaValue {
  if (!raw) {
    return { instances: [], files: [] };
  }
  if (Array.isArray(raw)) {
    return { instances: raw as CardTypeSummary[], files: [] };
  }
  let value = raw as Partial<RealmMetaValue>;
  return {
    instances: value.instances ?? [],
    files: value.files ?? [],
  };
}

export const coerceTypes = Object.freeze({
  deps: 'JSON',
  last_known_good_deps: 'JSON',
  types: 'JSON',
  pristine_doc: 'JSON',
  error_doc: 'JSON',
  search_doc: 'JSON',
  embedded_html: 'JSON',
  fitted_html: 'JSON',
  display_names: 'JSON',
  is_deleted: 'BOOLEAN',
  has_error: 'BOOLEAN',
  last_modified: 'VARCHAR',
  resource_created_at: 'VARCHAR',
  indexed_at: 'VARCHAR',
  rendered_at: 'VARCHAR',
  value: 'JSON',
  diagnostics: 'JSON',
});
