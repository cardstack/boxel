import type { CardResource } from './resource-types';
import type { SerializedError } from './error';
import type { PgPrimitive } from './expression';

export interface BoxelIndexTable {
  url: string;
  file_alias: string;
  realm_version: number;
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
  indexed_at: string | null; // pg represents big integers as strings in javascript
  last_modified: string | null; // pg represents big integers as strings in javascript
  resource_created_at: string | null; // pg represents big integers as strings in javascript
  is_deleted: boolean | null;
}

export interface RealmVersionsTable {
  realm_url: string;
  current_version: number;
}

export interface CardTypeSummary {
  code_ref: string;
  display_name: string;
  total: number;
  icon_html: string;
}

export interface RealmMetaTable {
  realm_version: number;
  realm_url: string;
  value: Record<string, string>[];
  indexed_at: string | null;
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
  value: 'JSON',
});

export interface PublishedRealmTable {
  id: string;
  owner_username: string;
  source_realm_url: string;
  published_realm_url: string;
  last_published_at: string;
}
