import {
  internalKeyFor,
  identifyCard,
  primitive,
  fieldSerializer,
} from './index';
import type { CodeRef } from './code-ref';
import type { SerializerName } from './serializers';
import type { FieldType } from 'https://cardstack.com/base/card-api';
import type { BaseDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { Query } from './query';

export interface FieldDefinition {
  type: FieldType;
  isPrimitive: boolean;
  isComputed: boolean;
  fieldOrCard: CodeRef;
  serializerName?: SerializerName;
  query?: Query;
}

// `fields` maps each (possibly-dotted) path to an opaque `fieldDef` id;
// `fieldDefs` is the dictionary the ids point into. Many paths typically
// resolve to the same `FieldDefinition` because the recursive walk over
// `cardInfo.theme.cardInfo.theme.…` keeps re-emitting the same leaf
// metadata at every cycle. Dedupe shrinks the persisted module-cache
// row dramatically (orders of magnitude on cards whose link graphs have
// cycles).
export interface Definition {
  type: 'card-def' | 'field-def';
  codeRef: CodeRef;
  displayName: string | null;
  fields: { [path: string]: string };
  fieldDefs: { [defId: string]: FieldDefinition };
}

// Look up the `FieldDefinition` for a path. Hides the indirection
// through `fieldDefs` so call sites read like the previous
// `definition.fields[path]` lookups.
export function getFieldDef(
  definition: Pick<Definition, 'fields' | 'fieldDefs'>,
  path: string,
): FieldDefinition | undefined {
  let id = definition.fields[path];
  if (id === undefined) {
    return undefined;
  }
  return definition.fieldDefs[id];
}

// we are only recursing 3 levels deep when we see a card def that we have already encountered,
// we capture this: Person -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person)
// we do not capture this: Person -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person) -> bestFriend (Person)
const RECURSING_DEPTH = 3;

function recursingDepth(): number {
  return (globalThis as any).__boxel_definitions_recursing_depth != null
    ? (globalThis as any).__boxel_definitions_recursing_depth
    : RECURSING_DEPTH;
}

// Stable JSON serialization for content-keyed interning. Keys sorted at
// every nesting level so logically-equal `FieldDefinition`s collapse to
// the same string regardless of the order their properties happened to
// be assigned in.
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

  function walk(
    klass: typeof BaseDef,
    prefix: string,
    visited: string[],
  ): void {
    let cardKey = internalKeyFor(identifyCard(klass)!, undefined);
    let klassFields = api.getFields(klass, { includeComputeds: true });
    for (let [fieldName, field] of Object.entries(klassFields)) {
      let fullFieldName = `${prefix ? prefix + '.' : ''}${fieldName}`;
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
      fields[fullFieldName] = intern(def);
      if (!isPrimitive) {
        if (visited.filter((v) => v === cardKey).length > recursingDepth()) {
          continue;
        }
        walk(field.card, fullFieldName, [...visited, cardKey]);
      }
    }
  }

  walk(cardDef, '', []);
  return { fields, fieldDefs };
}
