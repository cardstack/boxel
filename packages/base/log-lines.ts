// Typed lines for append-only logs: `linksTo(JSONLFile, { of: LineType })`.
//
// A log line is a value, not a card: a FieldDef names its shape, and `record`
// on the linked file appends `{ at, actor, what }` with `what` checked
// against that FieldDef and normalized by its fields' own serializers before
// the line is sent. The realm can't do the check itself, since a file doesn't
// know which card's field links it; the field does, so the instance read
// through it carries the type (`lineTypeOf` in card-api).
//
// The check is the shape a FieldDef declares:
// - every key names one of the line type's own non-computed fields;
// - a primitive field's value goes through that field type's deserialize and
//   serialize, as a card's would on save (a NumberField reads "12" as 12, a
//   DateField a date);
// - a compound field is checked the same way, recursively; a containsMany
//   takes a list;
// - a link isn't a value, so a line type with a `linksTo` field is refused.

import type { BaseDef } from './card-api';
import {
  deserialize,
  getFields,
  lineTypeOf,
  primitive,
  serialize,
} from './card-api';

export class LogLineError extends Error {}

async function normalizeValue(
  type: typeof BaseDef,
  value: unknown,
  path: string,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }
  if (primitive in type) {
    let read = await (type as any)[deserialize](value, undefined);
    return (type as any)[serialize](read, { data: {} } as any);
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LogLineError(
      `${path || 'the line'} is a ${type.displayName ?? type.name}, so it takes an object`,
    );
  }
  return normalizeLine(type, value as Record<string, unknown>, path);
}

// `what` as the line type declares it, or a `LogLineError` naming what's wrong.
export async function normalizeLine(
  lineType: typeof BaseDef,
  what: Record<string, unknown>,
  path = '',
): Promise<Record<string, unknown>> {
  if (typeof what !== 'object' || what === null || Array.isArray(what)) {
    throw new LogLineError(
      `a ${lineType.displayName ?? lineType.name} line takes an object`,
    );
  }
  let fields = getFields(lineType, { includeComputeds: false });
  let out: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(what)) {
    let at = path ? `${path}.${key}` : key;
    let field = (fields as Record<string, any>)[key];
    if (!field) {
      throw new LogLineError(
        `${at} is not a field of ${lineType.displayName ?? lineType.name} (it has ${Object.keys(fields).join(', ') || 'none'})`,
      );
    }
    if (field.fieldType === 'linksTo' || field.fieldType === 'linksToMany') {
      throw new LogLineError(
        `${at} is a link; a log line holds values, so name the card by its URL in a string field`,
      );
    }
    if (field.fieldType === 'containsMany') {
      if (value === null || value === undefined) {
        out[key] = [];
        continue;
      }
      if (!Array.isArray(value)) {
        throw new LogLineError(`${at} is a list`);
      }
      out[key] = await Promise.all(
        value.map((item, i) => normalizeValue(field.card, item, `${at}[${i}]`)),
      );
      continue;
    }
    out[key] = await normalizeValue(field.card, value, at);
  }
  return out;
}

// The line type a file instance was read with, if any.
export function lineTypeFor(instance: unknown): typeof BaseDef | undefined {
  let thunk =
    instance && typeof instance === 'object'
      ? ((instance as any)[lineTypeOf] as (() => typeof BaseDef) | undefined)
      : undefined;
  return thunk ? thunk() : undefined;
}
