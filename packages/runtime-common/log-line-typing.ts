// A typed log's lines, checked by the realm (`linksTo(JSONLFile, { of })`).
//
// The operations client checks and normalizes `record`'s `what` against the
// line type before it sends it (`packages/base/log-lines.ts`). The realm does
// the same when `record` runs, from the definitions it already holds, so a
// direct `_operations` invoke is held to the type too. The rules are the
// client's:
//
// - every key names one of the line type's own non-computed fields;
// - a value is normalized by its field's family: a number field takes a
//   number or a numeric string, a boolean field a boolean or "true" /
//   "false", a date field `YYYY-MM-DD`, a datetime field an ISO time (UTC
//   when it names no zone), a big integer its digits, a string field a string
//   (a number or boolean becomes its text); anything else of the wrong shape
//   is refused;
// - a compound field is checked the same way, recursively; a containsMany
//   takes a list;
// - a link isn't a value, so a line type with a `linksTo` field is refused.
//
// Which line type a log has is the realm's to work out from the cards that
// link it (`Realm.logLineType`): a log linked through one `of:` type is typed
// by it. A log no card links with `of:`, or one linked with two different
// line types, is not typed here, and only the client's check applies.

import type { CodeRef } from './code-ref.ts';
import type { Definition, FieldDefinition } from './definitions.ts';

export class LogLineTypeError extends Error {
  name = 'LogLineTypeError';
}

const ISO_DATE_TIME =
  /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(Z|[+-]\d\d:\d\d)?$/i;

function isStringField(def: FieldDefinition): boolean {
  let ref = def.fieldOrCard as { module?: string; name?: string };
  return (
    typeof ref.module === 'string' &&
    /\/string(\.gts)?$/.test(ref.module) &&
    ref.name === 'default'
  );
}

function refuse(at: string, wants: string, value: unknown): never {
  throw new LogLineTypeError(
    `${at} takes ${wants}, not ${JSON.stringify(value)?.slice(0, 80)}`,
  );
}

function normalizePrimitive(
  def: FieldDefinition,
  value: unknown,
  at: string,
): unknown {
  switch (def.serializerName) {
    case 'number': {
      let n =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : NaN;
      return Number.isFinite(n) ? n : refuse(at, 'a number', value);
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      return refuse(at, 'true or false', value);
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value)
        ? value
        : refuse(at, 'a date as YYYY-MM-DD', value);
    case 'datetime': {
      let iso =
        typeof value === 'string' ? ISO_DATE_TIME.exec(value.trim()) : null;
      if (!iso) return refuse(at, 'an ISO date and time', value);
      let ms = Date.parse(iso[1] ? iso[0] : `${iso[0]}Z`);
      return Number.isNaN(ms)
        ? refuse(at, 'an ISO date and time', value)
        : new Date(ms).toISOString();
    }
    case 'big-integer':
      return (typeof value === 'string' && /^-?\d+$/.test(value)) ||
        (typeof value === 'number' && Number.isInteger(value))
        ? String(value)
        : refuse(at, 'an integer', value);
  }
  if (isStringField(def)) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return refuse(at, 'text', value);
  }
  // A primitive this module doesn't know: stored as given.
  return value;
}

type Lookup = (ref: CodeRef) => Promise<Definition | undefined>;

async function normalizeValue(
  def: FieldDefinition,
  value: unknown,
  at: string,
  lookup: Lookup,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }
  if (def.isPrimitive) {
    return normalizePrimitive(def, value, at);
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new LogLineTypeError(`${at} takes an object`);
  }
  let nested = await lookup(def.fieldOrCard);
  if (!nested) {
    // A type the realm can't read: left as the client checked it.
    return value;
  }
  return await normalizeLogLine(nested, value, lookup, at);
}

// `what` as the line type `definition` declares it, or a `LogLineTypeError`
// naming what's wrong.
export async function normalizeLogLine(
  definition: Definition,
  what: unknown,
  lookup: Lookup,
  path = '',
): Promise<Record<string, unknown>> {
  if (typeof what !== 'object' || what === null || Array.isArray(what)) {
    throw new LogLineTypeError(
      `${path || 'what'} is a ${definition.displayName ?? 'line'} line, which takes an object`,
    );
  }
  let out: Record<string, unknown> = {};
  let names = Object.keys(definition.fields).filter((name) => {
    let def = definition.fieldDefs[definition.fields[name]];
    return def && !def.isComputed;
  });
  for (let [key, value] of Object.entries(what as Record<string, unknown>)) {
    let at = path ? `${path}.${key}` : key;
    let def = Object.prototype.hasOwnProperty.call(definition.fields, key)
      ? definition.fieldDefs[definition.fields[key]]
      : undefined;
    if (!def || def.isComputed) {
      throw new LogLineTypeError(
        `${at} is not a field of ${definition.displayName ?? 'the line type'} (it has ${names.join(', ') || 'none'})`,
      );
    }
    if (def.type === 'linksTo' || def.type === 'linksToMany') {
      throw new LogLineTypeError(
        `${at} is a link; a log line holds values, so name the card by its URL in a string field`,
      );
    }
    if (def.type === 'containsMany') {
      if (value === null || value === undefined) {
        out[key] = [];
        continue;
      }
      if (!Array.isArray(value)) {
        throw new LogLineTypeError(`${at} is a list`);
      }
      let items: unknown[] = [];
      for (let [i, item] of value.entries()) {
        items.push(await normalizeValue(def, item, `${at}[${i}]`, lookup));
      }
      out[key] = items;
      continue;
    }
    out[key] = await normalizeValue(def, value, at, lookup);
  }
  return out;
}
