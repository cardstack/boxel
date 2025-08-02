import {
  ResolvedCodeRef,
  type CardResource,
  type SerializerName,
} from './index';
import { type SerializedError } from './error';
import { type PgPrimitive } from './expression';
import { type FieldType } from 'https://cardstack.com/base/card-api';

export interface BoxelIndexTable {
  url: string;
  file_alias: string;
  realm_version: number;
  realm_url: string;
  type: 'instance' | 'card-def' | 'module' | 'error';
  // TODO in followup PR update this to be a document not a resource
  pristine_doc: CardResource | null;
  error_doc: SerializedError | null;
  search_doc: Record<string, PgPrimitive> | null;
  // `deps` is a list of URLs that the card depends on, either card URL's or
  // module URL's
  deps: string[] | null;
  // `types` is the adoption chain for card where each code ref is serialized
  // using `internalKeyFor()`
  meta: FieldsMeta | null;
  types: string[] | null;
  display_names: string[] | null;
  transpiled_code: string | null;
  source: string | null;
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

export interface FieldMeta {
  type: FieldType;
  isPrimitive: boolean;
  isComputed: boolean;
  fieldOrCard: ResolvedCodeRef;
  serializerName?: SerializerName;
}

export interface FieldsMeta {
  type: 'card-def' | 'field-def';
  codeRef: ResolvedCodeRef;
  displayName: string | null;
  fields: {
    [fieldName: string]: FieldMeta;
  };
}

export const coerceTypes = Object.freeze({
  deps: 'JSON',
  types: 'JSON',
  pristine_doc: 'JSON',
  error_doc: 'JSON',
  search_doc: 'JSON',
  embedded_html: 'JSON',
  fitted_html: 'JSON',
  display_names: 'JSON',
  meta: 'JSON',
  is_deleted: 'BOOLEAN',
  last_modified: 'VARCHAR',
  resource_created_at: 'VARCHAR',
  indexed_at: 'VARCHAR',
  value: 'JSON',
});
