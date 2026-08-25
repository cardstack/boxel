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

import {
  MAX_LITERAL_VALUE_NODES,
  ProtocolRefusal,
  describeValue,
  isProtocolRefusal,
  quoteToken,
} from './refusal.ts';

/**
 * One normalization's shared bookkeeping: what it has already built (so the
 * sharing a producer sent is the sharing a consumer receives), what it is
 * currently inside (so a value containing itself is refused rather than
 * walked), and how much work is left.
 *
 * Threaded through a whole gate invocation rather than created per member: a
 * budget granted afresh to each of forty effects is forty times the budget.
 */
export interface NormalizationBudget {
  remaining: number;
  seen: Map<object, JSONTypes.Value>;
  open: Set<object>;
}

export function newNormalizationBudget(): NormalizationBudget {
  return {
    remaining: MAX_LITERAL_VALUE_NODES,
    seen: new Map(),
    open: new Set(),
  };
}

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
    if (isProtocolRefusal(error)) {
      throw error;
    }
    // The caught value is producer-controlled, so the diagnostic is built
    // WITHOUT touching it. `instanceof` runs a proxy's getPrototypeOf trap,
    // `error.name` runs a getter, and `JSON.stringify` runs `toJSON` or throws
    // on a BigInt — each of which throws out of the very catch block whose job
    // is to guarantee nothing but a refusal leaves. The value rides along as
    // `cause`, which stores without reading, so a genuine internal bug is
    // still recoverable from a log while a hostile one costs nothing.
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      'reading the record raised an error',
      error,
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
export function defineMember(
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
  budget: NormalizationBudget = newNormalizationBudget(),
): JSONTypes.Value {
  // Charged for EVERY value, before any early return. Counting only objects
  // leaves an array of holes free: `new Array(2**32 - 1)` is one own property
  // over the wire, `structuredClone`s in no time, and walks for minutes.
  if (--budget.remaining < 0) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `more than ${MAX_LITERAL_VALUE_NODES} values in one record`,
    );
  }
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
  // A value reachable from itself is not JSON, and refusing it here rather
  // than through a depth limit keeps the answer independent of the order a
  // producer happened to lay its keys out in.
  if (budget.open.has(value)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      'a value that contains itself is not data',
    );
  }
  // Restores the sharing the input had. Without it a shared subgraph is walked
  // once per path that reaches it, which is the exponential blow-up the node
  // budget would otherwise have to absorb.
  let memoized = budget.seen.get(value);
  if (memoized !== undefined) {
    return memoized;
  }
  budget.open.add(value);
  if (Array.isArray(value)) {
    let entries: JSONTypes.Value[] = [];
    budget.seen.set(value, entries);
    let length = readMember(value, 'length');
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an array's length must be a non-negative integer, received ${describeValue(length)}`,
      );
    }
    for (let index = 0; index < length; index++) {
      entries.push(normalizeJsonData(readMember(value, String(index)), budget));
    }
    budget.open.delete(value);
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
  budget.seen.set(value, normalized);
  // getOwnPropertyNames, not keys: a non-enumerable member is still reachable
  // by whoever holds the object, so skipping it proves nothing about what a
  // consumer would be handed.
  for (let key of Object.getOwnPropertyNames(value)) {
    defineMember(
      normalized,
      key,
      normalizeJsonData(readMember(value, key), budget),
    );
  }
  budget.open.delete(value);
  return normalized;
}

export function normalizeJsonRecord(
  value: unknown,
  label: string,
  budget: NormalizationBudget = newNormalizationBudget(),
): Record<string, JSONTypes.Value> {
  let normalized = normalizeJsonData(value, budget);
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

export function normalizeStringArray(
  value: unknown,
  label: string,
  budget: NormalizationBudget = newNormalizationBudget(),
): string[] {
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
    // Charged per entry. A producer picks `length`, so validating it as a
    // non-negative integer and then walking it leaves the walk uncharged —
    // one own property over the wire buying seconds of synchronous main
    // thread, on the first gate every record passes.
    if (--budget.remaining < 0) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `${label} is longer than the ${MAX_LITERAL_VALUE_NODES} values one record may carry`,
      );
    }
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
