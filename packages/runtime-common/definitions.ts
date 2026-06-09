import {
  identifyCard,
  primitive,
  fieldSerializer,
  isResolvedCodeRef,
  type CodeRef,
} from './index.ts';
import type { SerializerName } from './serializers/index.ts';
import type { FieldType } from 'https://cardstack.com/base/card-api';
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
