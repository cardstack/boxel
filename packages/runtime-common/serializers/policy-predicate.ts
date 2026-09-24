import type {
  BaseDefConstructor,
  BaseInstanceType,
} from '@cardstack/base/card-api';

// A policy grant's `where` predicate: BXL source, stored as written.
//
// A policy document carries it in one of two shapes. The common one is a bare
// string of BXL source — the field's own type says the string is BXL, so the
// `{ $bxl: … }` envelope the `bxl` template tag produces in card code is not
// used. The annotated one, `{ bxl: "<source>", snapshot: true }`, marks a
// predicate that deliberately reads a snapshot (index-derived) value. Both
// deserialize to the same `PolicyPredicate`, and a predicate serializes back
// to whichever shape its `snapshot` flag calls for.
//
// The source is never parsed, trimmed or otherwise canonicalized here; what
// the author wrote is what reads back.
//
// An unset predicate is `null` — an unconditional grant — so a value that is
// present but malformed must not collapse to it. Anything other than the two
// shapes above is refused rather than read as absent.
export interface PolicyPredicate {
  source: string;
  snapshot: boolean;
}

export type SerializedPolicyPredicate =
  | string
  | { bxl: string; snapshot: true };

const ANNOTATED_KEYS = new Set(['bxl', 'snapshot']);

export function queryableValue(value: unknown): string | null {
  return asPredicate(value)?.source ?? null;
}

export function serialize(value: unknown): SerializedPolicyPredicate | null {
  let predicate = asPredicate(value);
  if (!predicate) {
    return null;
  }
  return predicate.snapshot
    ? { bxl: predicate.source, snapshot: true }
    : predicate.source;
}

export async function deserialize<T extends BaseDefConstructor>(
  this: T,
  value: unknown,
): Promise<BaseInstanceType<T>> {
  return normalize(value) as BaseInstanceType<T>;
}

// A field value in memory is a `PolicyPredicate`; the document shapes are read
// only by `deserialize`. A document shape assigned in code is refused here
// rather than normalized, because until it is saved and reloaded the field's
// templates and any direct reader of `where.source` would see it as having no
// source at all.
function asPredicate(value: unknown): PolicyPredicate | null {
  if (value == null) {
    return null;
  }
  if (isPolicyPredicate(value)) {
    return value;
  }
  throw new Error(
    `a policy predicate in memory must be { source, snapshot }; a document shape (a BXL string or { bxl, snapshot }) is read only when a card is deserialized`,
  );
}

export function isPolicyPredicate(value: unknown): value is PolicyPredicate {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  let record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    typeof record.source === 'string' &&
    typeof record.snapshot === 'boolean'
  );
}

// Reads a predicate from either document shape.
export function normalize(value: unknown): PolicyPredicate | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return { source: value, snapshot: false };
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    let record = value as Record<string, unknown>;
    let unknownKeys = Object.keys(record).filter(
      (key) => !ANNOTATED_KEYS.has(key),
    );
    if (unknownKeys.length > 0) {
      throw new Error(
        `a policy predicate object accepts only 'bxl' and 'snapshot', but has ${unknownKeys
          .map((key) => `'${key}'`)
          .join(', ')}`,
      );
    }
    if (typeof record.bxl !== 'string') {
      throw new Error(
        `a policy predicate object must carry its BXL source as a string in 'bxl'`,
      );
    }
    if (record.snapshot !== undefined && typeof record.snapshot !== 'boolean') {
      throw new Error(`a policy predicate's 'snapshot' must be a boolean`);
    }
    return { source: record.bxl, snapshot: record.snapshot === true };
  }
  throw new Error(
    `a policy predicate must be a string of BXL source or { bxl, snapshot }, but is ${typeof value}`,
  );
}
