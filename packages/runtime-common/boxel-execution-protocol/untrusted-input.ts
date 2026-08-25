/**
 * Reading a record whose producer sits on the other side of a trust boundary.
 *
 * Nothing here inspects an object and hands that same object on. Every read
 * goes through a property descriptor, once per member, and what these return
 * is rebuilt from those reads — so what a consumer holds is what was checked.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type * as JSONTypes from 'json-typescript';

import { ProtocolRefusal, describeValue, quoteToken } from './refusal.ts';

/**
 * How deep a literal value may nest before it is refused.
 *
 * Doubles as the cycle guard: a value that loops back on itself runs the depth
 * down and is refused rather than walked forever.
 */
const MAX_LITERAL_VALUE_DEPTH = 32;

/**
 * How many values one normalization may visit.
 *
 * Depth alone does not bound the work. `structuredClone` preserves sharing, so
 * a directed acyclic graph arrives as a handful of objects and expands
 * exponentially when walked as a tree — a 27-object payload exhausts memory
 * while sitting comfortably inside the depth limit. The memo below restores
 * the sharing, and this budget bounds what remains.
 */
const MAX_LITERAL_VALUE_NODES = 100_000;

/**
 * Runs a gate so that nothing but a `ProtocolRefusal` can come out of it.
 *
 * Reading through descriptors removes the accessors a gate would otherwise
 * run, but it cannot remove every route: a `Proxy` can throw from its own
 * `getOwnPropertyDescriptor` or `get` trap, and a value can be hostile in ways
 * no enumeration anticipates. A consumer catches one type, so anything else
 * escaping unhandled discards the last-known-good output the refusal exists to
 * protect. This turns "no far-side code runs inside the gate" from an
 * aspiration into an outcome: whatever happens in there leaves as a refusal.
 */
export function asRefusal<T>(gate: () => T): T {
  try {
    return gate();
  } catch (error) {
    if (error instanceof ProtocolRefusal) {
      throw error;
    }
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `reading the record raised ${
        error instanceof Error ? quoteToken(error.name) : describeValue(error)
      }`,
    );
  }
}

/**
 * Reads one member of an untrusted record as own data.
 *
 * Plain property access is not available to a gate. It runs an accessor — far
 * side code, inside the gate, free to throw straight past the refusal
 * contract — and it re-reads a member a Proxy may answer differently every
 * time. Every read below goes through here, once per member, and what a gate
 * returns is built from those reads rather than from the object they came
 * out of.
 */
export function readMember(source: object, key: string): unknown {
  let descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!('value' in descriptor)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${quoteToken(key)} is an accessor; a record carries data, not behavior`,
    );
  }
  return descriptor.value;
}

/**
 * Assigns an own data property, whatever it is named.
 *
 * `normalized[key] = value` invokes the `Object.prototype.__proto__` setter
 * for that one key: no own property is created, and the object the consumer
 * receives answers ordinary lookups with producer-chosen values while
 * reporting no keys at all. A legal JSON `__proto__` member would also be
 * silently lost, which `structuredClone` — the contract this module states —
 * does not do.
 */
function defineMember(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Returns `value` as inert JSON data, or refuses.
 *
 * Normalizing rather than inspecting is the whole point. An inspection answers
 * a question about the caller's object and then hands that same object on, so
 * a Proxy, a non-enumerable member, or a symbol-keyed one can differ between
 * the check and the use. What this returns has none of those: every leaf was
 * read once as own data, and the result is a plain graph a consumer can hold.
 */
export function normalizeJsonData(
  value: unknown,
  depth = MAX_LITERAL_VALUE_DEPTH,
  budget: { remaining: number } = { remaining: MAX_LITERAL_VALUE_NODES },
  seen: Map<object, JSONTypes.Value> = new Map(),
): JSONTypes.Value {
  if (value === null) {
    return null;
  }
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    // Every number, `NaN` and the infinities included: the contract this
    // module states is `structuredClone`, which carries them, and refusing
    // them would reject a value the record's own type declares legal.
    return value;
  }
  if (typeof value === 'undefined') {
    // `structuredClone` carries an undefined-valued member, and `Cloneable`
    // admits one, so refusing it here would reject a record the type declares
    // legal — an effect with no payload, or a spread that left a member unset.
    return undefined as unknown as JSONTypes.Value;
  }
  if (typeof value !== 'object') {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `not data: ${describeValue(value)}`,
    );
  }
  if (depth <= 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `nested past ${MAX_LITERAL_VALUE_DEPTH} levels`,
    );
  }
  if (--budget.remaining < 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `more than ${MAX_LITERAL_VALUE_NODES} values in one record`,
    );
  }
  // Restores the sharing the input had. Without it a shared subgraph is walked
  // once per path that reaches it, which is the exponential blow-up the node
  // budget would otherwise have to absorb.
  let memoized = seen.get(value);
  if (memoized !== undefined) {
    return memoized;
  }
  if (Array.isArray(value)) {
    let entries: JSONTypes.Value[] = [];
    seen.set(value, entries);
    let length = readMember(value, 'length');
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an array's length must be a non-negative integer, received ${describeValue(length)}`,
      );
    }
    for (let index = 0; index < length; index++) {
      entries.push(
        normalizeJsonData(
          readMember(value, String(index)),
          depth - 1,
          budget,
          seen,
        ),
      );
    }
    return entries;
  }
  let prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      'a value with a prototype of its own is an object, not data',
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      'a value carrying symbol-keyed members is not data',
    );
  }
  let normalized: Record<string, JSONTypes.Value> = {};
  seen.set(value, normalized);
  // getOwnPropertyNames, not keys: a non-enumerable member is still reachable
  // by whoever holds the object, so skipping it proves nothing about what a
  // consumer would be handed.
  for (let key of Object.getOwnPropertyNames(value)) {
    defineMember(
      normalized,
      key,
      normalizeJsonData(readMember(value, key), depth - 1, budget, seen),
    );
  }
  return normalized;
}

export function normalizeJsonRecord(
  value: unknown,
  label: string,
): Record<string, JSONTypes.Value> {
  let normalized = normalizeJsonData(value);
  if (
    typeof normalized !== 'object' ||
    normalized === null ||
    Array.isArray(normalized)
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must be a record of data, received ${describeValue(value)}`,
    );
  }
  return normalized;
}

export function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must be an array, received ${describeValue(value)}`,
    );
  }
  let entries: string[] = [];
  let length = readMember(value, 'length');
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must have a non-negative integer length, received ${describeValue(length)}`,
    );
  }
  for (let index = 0; index < length; index++) {
    let entry = readMember(value, String(index));
    if (typeof entry !== 'string') {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `${label} must hold strings, received ${describeValue(entry)}`,
      );
    }
    entries.push(entry);
  }
  return entries;
}

export function normalizeString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${label} must be a string, received ${describeValue(value)}`,
    );
  }
  return value;
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
