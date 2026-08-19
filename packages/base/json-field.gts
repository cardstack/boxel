import { primitive } from '@cardstack/runtime-common';
import type { BaseDef } from './card-api';
import { FieldDef, queryableValue } from './card-api';

// A field whose value is an arbitrary JSON object, round-tripped as-is. It is
// intentionally NOT indexed for search (queryableValue → null): it backs
// loosely-typed blobs (command payloads, raw frontmatter) that shouldn't bloat
// the search index, and the typed query engine can't filter arbitrary nested
// JSON paths anyway. Callers that need to filter project the searchable parts
// into their own typed fields.
export class JsonField extends FieldDef {
  static displayName = 'JSON';
  static [primitive]: Record<string, any>;
  static [queryableValue](_value: any, _stack: BaseDef[]): null {
    return null;
  }
}
