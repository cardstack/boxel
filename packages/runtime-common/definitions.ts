import {
  identifyCard,
  isCardDef,
  isFileDef,
  primitive,
  fieldSerializer,
  isResolvedCodeRef,
  type CodeRef,
} from './index.ts';
import type { OperationDefinition } from './card-operations/types.ts';
import type { SerializerName } from './serializers/index.ts';
import { vectorSpace, type VectorSpaceSource } from './vector-space.ts';
import type { FieldType, Searchable } from '@cardstack/base/card-api';
import type { BaseDef } from '@cardstack/base/card-api';
import type * as CardAPI from '@cardstack/base/card-api';
import type { Query } from './query.ts';
import {
  cardSearchIntentOf,
  type CardSearchIntent,
  type FieldSearchOption,
  type IndexFieldDeclarations,
} from './search-intent.ts';

export interface FieldDefinition {
  type: FieldType;
  isPrimitive: boolean;
  isComputed: boolean;
  fieldOrCard: CodeRef;
  serializerName?: SerializerName;
  // A vector field's declared space (vector-space.ts), worked out from its
  // type's static vectorizer, provider and size as the type's own `space`
  // is. A near search compares in this space, whatever spaces the type's
  // cards are stored in at the moment. Only on vector fields.
  vectorSpace?: string;
  query?: Query;
  // Raw `searchable` annotation mirrored from the field descriptor (the source
  // of truth in `card-api.gts`). Carried here for the loaderless query compiler
  // and definition-build validation — not a pre-resolved plan. Persisted as
  // plain JSON in `modules.definitions`; omitted when the field declares none.
  searchable?: Searchable;
  // The field's `search` option (docs/search-intent.md): its own, or else its
  // type's `searchDefaults`; omitted when neither says anything. The query
  // engine reads `rank`, `facet` and `patterns` from it.
  search?: FieldSearchOption;
  // A linked log's line type (`linksTo(JSONLFile, { of })`), for readers
  // that type a log's lines without loading the card's module.
  lineOf?: CodeRef;
}

// Which of the three `BaseDef` families a definition describes. A card has its
// own URL; a field is a value that only exists inside a card and has no URL; a
// file describes uploaded bytes, which have a URL and read-only,
// content-derived metadata. Files are a sibling of cards under `BaseDef`, not a
// kind of field, so recording the family is what lets a reader holding only the
// cached entry tell a file from a field without loading the type's module.
export type DefinitionKind = 'card-def' | 'field-def' | 'file-def';

// Classify a def for its definition entry. This is the single test the
// definition producers share, so every entry in the cache answers the question
// the same way.
export function definitionKind(def: typeof BaseDef): DefinitionKind {
  if (isCardDef(def)) {
    return 'card-def';
  }
  if (isFileDef(def)) {
    return 'file-def';
  }
  return 'field-def';
}

// The display name a definition entry records. Every family declares one on its
// class, but the entry carries it only for the families a consumer can address
// by URL — a card or a file — where the name identifies something the reader
// can go and fetch. Derived from `definitionKind` so the two cannot disagree
// about which families those are.
export function definitionDisplayName(def: typeof BaseDef): string | null {
  return definitionKind(def) === 'field-def' ? null : def.displayName;
}

// `Definition.fields` only carries the **immediate** field map. Dotted
// paths like `cardInfo.theme.cardInfo.name` are resolved at lookup time
// by chasing each segment's `fieldOrCard` codeRef through
// `definitionLookup`. Pre-materializing every reachable path explodes
// combinatorially on cards with cyclic linksTo graphs (e.g. via
// `cardInfo.theme`), and the per-segment cost at lookup time is
// dominated by the `CachingDefinitionLookup`'s warm-cache hit.
export interface Definition {
  type: DefinitionKind;
  codeRef: CodeRef;
  displayName: string | null;
  fields: { [fieldName: string]: string };
  fieldDefs: { [defId: string]: FieldDefinition };
  // The type's `@operation` declarations, lowered to base-operation data plus
  // BXL and keyed by operation name. This is what makes an operation
  // resolvable from a card's `adoptsFrom` alone: a card's JSON names its
  // type, and the type's entry carries everything needed to run the
  // operation, so the realm never loads the card's module to invoke one.
  // Omitted when the type declares no operations, which keeps the entry for
  // every other type unchanged.
  operations?: { [operationName: string]: OperationDefinition };
  // The type's `static searchDefaults`, merged up its ancestry; omitted when
  // no class in it declares one.
  search?: CardSearchIntent;
  // A FieldDef's `static facetValue`: the subfield a compound field declared
  // `search: { facet: true }` counts by when a facet names the compound
  // itself (facet-declarations.ts). Omitted when the type names none.
  facetValue?: string;
  // A card or file type's `static indexFields` (base's declarations of the
  // index columns every row has: its type, realm, created and modified
  // times), with their `search` options. Omitted for a field def.
  indexFields?: IndexFieldDeclarations;
}

// The `indexFields` member a definition entry records for `def`.
export function definitionIndexFields(
  def: typeof BaseDef,
): IndexFieldDeclarations | undefined {
  // A field def is a value inside a card, with no index row of its own.
  // (BaseDef itself, the root cards and files share, records them.)
  if ((def as unknown as { isFieldDef?: boolean }).isFieldDef) {
    return undefined;
  }
  let value = (def as unknown as { indexFields?: unknown }).indexFields;
  return value && typeof value === 'object'
    ? (JSON.parse(JSON.stringify(value)) as IndexFieldDeclarations)
    : undefined;
}

// The `facetValue` member a definition entry records for `def`: a FieldDef's
// own string `static facetValue`, inherited like any static.
export function definitionFacetValue(def: typeof BaseDef): string | undefined {
  if (definitionKind(def) !== 'field-def') {
    return undefined;
  }
  let value = (def as unknown as { facetValue?: unknown }).facetValue;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// The `search` member a definition entry records for `def`.
export function definitionSearchIntent(
  def: typeof BaseDef,
): CardSearchIntent | undefined {
  return cardSearchIntentOf(
    def as unknown as { searchDefaults?: CardSearchIntent },
  );
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
    let serializerName =
      fieldSerializer in field.card
        ? (field.card[fieldSerializer] as SerializerName)
        : undefined;
    let def: FieldDefinition = {
      type: field.fieldType,
      isPrimitive,
      isComputed: Boolean(field.computeVia),
      fieldOrCard: identifyCard(field.card)!,
      serializerName,
      ...(serializerName === 'vector'
        ? { vectorSpace: vectorSpace(field.card as VectorSpaceSource) }
        : {}),
      query: queryDefinition,
      searchable: field.searchable,
      ...(field.lineOf ? { lineOf: identifyCard(field.lineOf())! } : {}),
      ...(() => {
        // A link's target is a card, whose `searchDefaults` are card-level
        // defaults, not a field intent.
        let typeDefault =
          field.fieldType === 'contains' || field.fieldType === 'containsMany'
            ? (field.card as { searchDefaults?: FieldSearchOption })
                .searchDefaults
            : undefined;
        let search = field.searchIntent ?? typeDefault;
        return search !== undefined ? { search } : {};
      })(),
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
  // Own names only: `constructor` or `toString` is no field of any type.
  if (!Object.prototype.hasOwnProperty.call(definition.fields, fieldName)) {
    return undefined;
  }
  let id = definition.fields[fieldName];
  if (id === undefined) {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(definition.fieldDefs, id)
    ? definition.fieldDefs[id]
    : undefined;
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
