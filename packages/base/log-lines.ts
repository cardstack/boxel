// Typed lines for append-only logs: `linksTo(JSONLFile, { of: LineType })`.
//
// A log line is a value, not a card: a FieldDef names its shape, and `record`
// on the linked file appends `{ at, actor, what }` with `what` checked
// against that FieldDef and normalized before the line is sent. The realm
// can't check it, since a file doesn't know which card's field links it; the
// field does, so the instance read through it carries the type (`lineTypeOf`
// in card-api), and the operations client applies the check to every entry
// that instance makes, a single call or one inside atomic().
//
// Synchronous, because a batch registers its entries as the caller writes
// them. The check is the shape the FieldDef declares:
// - every key names one of the line type's own non-computed fields;
// - a value is normalized by its field's family: a number field takes a
//   number or a numeric string, a boolean field a boolean or "true" /
//   "false", a date field `YYYY-MM-DD`, a datetime field an ISO time, a big
//   integer its digits, a string field a string (a number or boolean becomes
//   its text); anything else of the wrong shape is refused;
// - a compound field is checked the same way, recursively; a containsMany
//   takes a list;
// - a link isn't a value, so a line type with a `linksTo` field is refused.

import { fieldSerializer } from '@cardstack/runtime-common';
import type { BaseDef } from './card-api';
import { getFields, lineTypeOf, primitive, StringField } from './card-api';

export class LogLineError extends Error {
  name = 'LogLineError';
}

function typeName(type: typeof BaseDef): string {
  return type.displayName ?? type.name;
}

function normalizePrimitive(
  type: typeof BaseDef,
  value: unknown,
  at: string,
): unknown {
  let refuse = (wants: string): never => {
    throw new LogLineError(
      `${at} is a ${typeName(type)}, which takes ${wants}, not ${JSON.stringify(value)}`,
    );
  };
  let serializer = (type as any)[fieldSerializer] as string | undefined;
  switch (serializer) {
    case 'number': {
      let n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : NaN;
      return Number.isFinite(n) ? n : refuse('a number');
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      return refuse('true or false');
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
        ? value
        : refuse('a date as YYYY-MM-DD');
    case 'datetime':
      if (value instanceof Date) return value.toISOString();
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? new Date(value).toISOString()
        : refuse('an ISO date and time');
    case 'big-integer':
      return (typeof value === 'string' && /^-?\d+$/.test(value)) ||
        (typeof value === 'number' && Number.isInteger(value)) ||
        typeof value === 'bigint'
        ? String(value)
        : refuse('an integer');
  }
  if (type === StringField || type.prototype instanceof StringField) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return refuse('text');
  }
  // A primitive this module doesn't know: stored as given.
  return value;
}

function normalizeValue(
  type: typeof BaseDef,
  value: unknown,
  at: string,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (primitive in type) {
    return normalizePrimitive(type, value, at);
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LogLineError(
      `${at} is a ${typeName(type)}, so it takes an object`,
    );
  }
  return normalizeLine(type, value, at);
}

// `what` as the line type declares it, or a `LogLineError` naming what's wrong.
export function normalizeLine(
  lineType: typeof BaseDef,
  what: unknown,
  path = '',
): Record<string, unknown> {
  if (typeof what !== 'object' || what === null || Array.isArray(what)) {
    throw new LogLineError(
      `${path || 'what'} is a ${typeName(lineType)} line, which takes an object`,
    );
  }
  let fields = getFields(lineType, { includeComputeds: false }) as Record<
    string,
    any
  >;
  let out: Record<string, unknown> = {};
  for (let [key, value] of Object.entries(what as Record<string, unknown>)) {
    let at = path ? `${path}.${key}` : key;
    let field = fields[key];
    if (!field) {
      throw new LogLineError(
        `${at} is not a field of ${typeName(lineType)} (it has ${Object.keys(fields).join(', ') || 'none'})`,
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
      out[key] = value.map((item, i) =>
        normalizeValue(field.card, item, `${at}[${i}]`),
      );
      continue;
    }
    out[key] = normalizeValue(field.card, value, at);
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

// The `paramsFor` an operations subject carries for a typed log: `record`'s
// `what` checked and normalized as a line.
export function lineParamsFor(
  lineType: typeof BaseDef,
): (name: string, payload: unknown) => unknown {
  return (name, payload) => {
    if (name !== 'record' || payload === null || typeof payload !== 'object') {
      return payload;
    }
    let { what, ...rest } = payload as Record<string, unknown>;
    return { ...rest, what: normalizeLine(lineType, what) };
  };
}
