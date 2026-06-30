import {
  identifyCard,
  primitive,
  fieldSerializer,
  isResolvedCodeRef,
  type CodeRef,
} from './index.ts';
import type { SerializerName } from './serializers/index.ts';
import type {
  FieldType,
  Searchable,
} from 'https://cardstack.com/base/card-api';
import type { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { Query } from './query.ts';

export interface FieldDefinition {
  type: FieldType;
  isPrimitive: boolean;
  isComputed: boolean;
  fieldOrCard: CodeRef;
  serializerName?: SerializerName;
  query?: Query;
  // Raw `searchable` annotation mirrored from the field descriptor (the source
  // of truth in `card-api.gts`). Carried here for the loaderless query compiler
  // and definition-build validation — not a pre-resolved plan. Persisted as
  // plain JSON in `modules.definitions`; omitted when the field declares none.
  searchable?: Searchable;
}

// `Definition.fields` only carries the **immediate** field map. Dotted
// paths like `cardInfo.theme.cardInfo.name` are resolved at lookup time
// by chasing each segment's `fieldOrCard` codeRef through
// `definitionLookup`. Pre-materializing every reachable path explodes
// combinatorially on cards with cyclic linksTo graphs (e.g. via
// `cardInfo.theme`), and the per-segment cost at lookup time is
// dominated by the `CachingDefinitionLookup`'s warm-cache hit.
export interface Definition {
  type: 'card-def' | 'field-def';
  codeRef: CodeRef;
  displayName: string | null;
  fields: { [fieldName: string]: string };
  fieldDefs: { [defId: string]: FieldDefinition };
}

// Stable JSON serialization for content-keyed interning. Keys sorted at
// every nesting level so logically-equal `FieldDefinition`s collapse to
// the same string regardless of property iteration order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  let entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (k) =>
        JSON.stringify(k) +
        ':' +
        stableStringify((value as Record<string, unknown>)[k]),
    );
  return '{' + entries.join(',') + '}';
}

export function getFieldDefinitions(
  api: typeof CardAPI,
  cardDef: typeof BaseDef,
): { fields: Definition['fields']; fieldDefs: Definition['fieldDefs'] } {
  let fields: Definition['fields'] = {};
  let fieldDefs: Definition['fieldDefs'] = {};
  let internIndex = new Map<string, string>();

  function intern(def: FieldDefinition): string {
    let contentKey = stableStringify(def);
    let existing = internIndex.get(contentKey);
    if (existing !== undefined) {
      return existing;
    }
    let id = `f${internIndex.size}`;
    internIndex.set(contentKey, id);
    fieldDefs[id] = def;
    return id;
  }

  let immediateFields = api.getFields(cardDef, { includeComputeds: true });
  for (let [fieldName, field] of Object.entries(immediateFields)) {
    let isPrimitive = primitive in field.card;
    let queryDefinition = field.queryDefinition
      ? (JSON.parse(JSON.stringify(field.queryDefinition)) as Query) // ensure this is a plain object
      : undefined;
    let def: FieldDefinition = {
      type: field.fieldType,
      isPrimitive,
      isComputed: Boolean(field.computeVia),
      fieldOrCard: identifyCard(field.card)!,
      serializerName:
        fieldSerializer in field.card
          ? (field.card[fieldSerializer] as SerializerName)
          : undefined,
      query: queryDefinition,
      searchable: field.searchable,
    };
    fields[fieldName] = intern(def);
  }

  return { fields, fieldDefs };
}

// Look up the immediate `FieldDefinition` for a single field name on
// `definition`. Returns undefined if the field doesn't exist on this
// card. Sync — does not chase nested paths.
export function getImmediateFieldDef(
  definition: Pick<Definition, 'fields' | 'fieldDefs'>,
  fieldName: string,
): FieldDefinition | undefined {
  let id = definition.fields[fieldName];
  if (id === undefined) {
    return undefined;
  }
  return definition.fieldDefs[id];
}

// Resolve a (possibly dotted) field path on `definition`, traversing
// each segment via `lookupDefinition` for non-primitive intermediate
// fields. Each segment costs one definition lookup, all served from
// `CachingDefinitionLookup`'s cache after first touch.
//
// Returns undefined if any segment is missing, if the path goes deeper
// than a primitive, or if an intermediate `fieldOrCard` is unresolved.
export async function getFieldDef(
  definition: Pick<Definition, 'fields' | 'fieldDefs'>,
  dottedPath: string,
  lookupDefinition: (codeRef: CodeRef) => Promise<Definition | undefined>,
): Promise<FieldDefinition | undefined> {
  let segments = dottedPath.split('.');
  let current: Pick<Definition, 'fields' | 'fieldDefs'> = definition;
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];
    let fieldDef = getImmediateFieldDef(current, seg);
    if (!fieldDef) {
      return undefined;
    }
    if (i === segments.length - 1) {
      return fieldDef;
    }
    if (fieldDef.isPrimitive) {
      return undefined;
    }
    if (!isResolvedCodeRef(fieldDef.fieldOrCard)) {
      return undefined;
    }
    let next = await lookupDefinition(fieldDef.fieldOrCard);
    if (!next) {
      return undefined;
    }
    current = next;
  }
  return undefined;
}

// A `searchable` annotation path that didn't resolve against the definition
// graph during definition build. Recorded (never thrown) into
// `modules.diagnostics` so a typo / removed field / un-routable segment
// surfaces where authors can see it instead of silently making nothing
// searchable. Carries no owning-codeRef — the caller tags each finding with
// the definition it came from when aggregating across a module.
export interface SearchablePathIssue {
  // The immediate field (on the validated definition) carrying the annotation.
  fieldName: string;
  // The dotted `searchable` path that failed to resolve.
  path: string;
}

// Validate every field's `searchable` annotation on `definition` against the
// definition graph. A path is rooted at the annotated field's TARGET type
// (`fieldOrCard`), matching the search-doc semantics: `searchable: 'address'`
// on `author = linksTo(Author)` names Author's `address` link, so the path
// resolves against Author — not against the card declaring `author`. The
// `true` form (the immediate "self" link) carries no path and is always valid;
// an omitted annotation is skipped. Returns one issue per path that
// `getFieldDef` can't resolve and never throws — definition build is decoupled
// in time from the edit that introduced a bad path, so a throw would surface at
// a confusing moment, and the query-time check is the loud backstop if the
// intended path is ever actually queried. `lookupDefinition` resolves a CodeRef
// to its `Definition`; returning undefined for an unloadable ref makes every
// path under it unresolvable (recorded), which is the intended behavior.
export async function validateSearchablePaths(
  definition: Pick<Definition, 'fields' | 'fieldDefs'>,
  lookupDefinition: (codeRef: CodeRef) => Promise<Definition | undefined>,
): Promise<SearchablePathIssue[]> {
  let issues: SearchablePathIssue[] = [];
  for (let [fieldName, defId] of Object.entries(definition.fields)) {
    let fieldDef = definition.fieldDefs[defId];
    let searchable = fieldDef?.searchable;
    // Omitted = no annotation; `true` = the always-valid self link. Neither
    // carries a path to resolve. A malformed value (not a string or array —
    // e.g. a stray `false`) yields no paths via the fallback below, so it can't
    // throw. Mirrors `seedSearchableRoutes`.
    if (searchable == null || searchable === true) {
      continue;
    }
    let paths =
      typeof searchable === 'string'
        ? [searchable]
        : Array.isArray(searchable)
          ? searchable
          : [];
    // A path is rooted at this field's target type. If we can't even identify
    // that target, none of the paths can be followed.
    let targetDef = isResolvedCodeRef(fieldDef.fieldOrCard)
      ? await lookupDefinition(fieldDef.fieldOrCard)
      : undefined;
    for (let path of paths) {
      // A non-string entry is malformed and names nothing; an empty string is
      // the self link (no deeper path to resolve). Both are valid, not issues.
      if (typeof path !== 'string' || path === '') {
        continue;
      }
      let resolved = targetDef
        ? await getFieldDef(targetDef, path, lookupDefinition)
        : undefined;
      if (!resolved) {
        issues.push({ fieldName, path });
      }
    }
  }
  return issues;
}
