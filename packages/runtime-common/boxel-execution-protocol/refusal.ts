/**
 * How this protocol says no: the named refusal every consumer catches, and
 * the bounded diagnostics it carries.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

export const PROTOCOL_REFUSAL_CODES = [
  'BOXEL_RECORD_MALFORMED',
  'BOXEL_PROTOCOL_VERSION_UNSUPPORTED',
  'BOXEL_TRANSPORT_VERSION_UNSUPPORTED',
  'BOXEL_PROTOCOL_FEATURE_UNSUPPORTED',
  'BOXEL_TEMPLATE_DEPENDENCY_KIND_UNKNOWN',
  'BOXEL_TEMPLATE_BUNDLE_INCOMPLETE',
  'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
] as const;

export type ProtocolRefusalCode = (typeof PROTOCOL_REFUSAL_CODES)[number];

/**
 * A refusal to apply a record. The `code` is the stable identity a diagnostic
 * catalog, a log query, or a test can key on; the message says which record
 * and which member forced it.
 */
/**
 * Every refusal this module has minted.
 *
 * `WeakSet.prototype.has` runs no traps, answers `false` for a non-object, and
 * cannot be forged — which is what the one catch block that must not throw
 * needs. A structural check reads a property, and reading a property on a
 * caught value runs the very trap that catch block exists to contain.
 */
const minted = new WeakSet<object>();

export class ProtocolRefusal extends Error {
  readonly code: ProtocolRefusalCode;

  constructor(code: ProtocolRefusalCode, detail: string, cause?: unknown) {
    super(`${code}: ${detail}`);
    if (cause !== undefined) {
      // Stored, never read. Keeps a genuine internal bug recoverable from a
      // log without a diagnostic touching producer-controlled data.
      Object.defineProperty(this, 'cause', {
        value: cause,
        writable: true,
        configurable: true,
      });
    }
    // Defined, not assigned. `name` is inherited from `Error.prototype`, which
    // SES's lockdown() freezes, and a strict-mode assignment through a frozen
    // non-writable inherited property throws. Assigning here would make this
    // class unconstructible inside a Compartment — turning every refusal in
    // the module into the raw TypeError it exists to replace, in exactly the
    // environment the module exists to serve.
    Object.defineProperty(this, 'name', {
      value: 'ProtocolRefusal',
      writable: true,
      configurable: true,
    });
    this.code = code;
    minted.add(this);
  }
}

/**
 * How much of a boundary-supplied string a diagnostic repeats.
 *
 * A refusal is written to a log, and the string that triggered it is chosen by
 * the code being refused. Caged code that emits one malformed record per
 * render would otherwise put a megabyte into the log stream on every attempt.
 */
const DIAGNOSTIC_TOKEN_LIMIT = 64;

/**
 * How many offending items a diagnostic names before summarizing the rest.
 *
 * Bounding each token is not enough on its own: the far side also chooses how
 * many there are, so fifty thousand short names is the same megabyte of log
 * by a different route.
 */
const DIAGNOSTIC_LIST_LIMIT = 10;

/**
 * Quotes a boundary-supplied string for a diagnostic: JSON-escaped, so an
 * embedded newline cannot forge a log line, and truncated to a length the
 * far side does not choose.
 */
export function quoteToken(value: string): string {
  return JSON.stringify(
    value.length > DIAGNOSTIC_TOKEN_LIMIT
      ? `${value.slice(0, DIAGNOSTIC_TOKEN_LIMIT)}…`
      : value,
  );
}

/** Joins offending items for a diagnostic, bounded in count as well as size. */
export function joinTokens(items: string[], separator = ', '): string {
  let shown = items.slice(0, DIAGNOSTIC_LIST_LIMIT);
  let withheld = items.length - shown.length;
  return withheld > 0
    ? `${shown.join(separator)} (and ${withheld} more)`
    : shown.join(separator);
}

/**
 * Names a rejected value in a diagnostic. A scalar is named by its value,
 * because the value is the whole content of the complaint; a string goes
 * through `quoteToken`; anything else is named by its type, since the type is
 * what was wrong with it.
 */
export function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  if (typeof value === 'string') {
    return quoteToken(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return typeof value;
}

/**
 * Whether a caught value is a refusal this module minted.
 *
 * Membership, not shape. `instanceof` runs a Proxy's `getPrototypeOf` trap and
 * reading `code` runs its `getOwnPropertyDescriptor` trap — both of which throw
 * out of the one catch block whose job is that nothing else escapes — and a
 * structural check is forgeable, so a producer could mint an object this
 * answered `true` for and have it re-thrown to a consumer verbatim.
 */
export function isProtocolRefusal(value: unknown): value is ProtocolRefusal {
  return typeof value === 'object' && value !== null && minted.has(value);
}

/**
 * Whether a record *describes* a refusal — a `ProjectedError` that crossed a
 * boundary carrying a refusal's code, where structure is all there is.
 *
 * Distinct from `isProtocolRefusal`, which asks whether this process minted the
 * value in hand. Never use this on a caught value: it reads a member, and on a
 * caught value that runs far-side code.
 */
export function describesProtocolRefusal(value: {
  code?: string;
}): value is { code: ProtocolRefusalCode } {
  return (
    typeof value.code === 'string' &&
    (PROTOCOL_REFUSAL_CODES as readonly string[]).includes(value.code)
  );
}

/**
 * How many values one record may carry, across every member of it.
 *
 * Lives here rather than with the normalizer because every gate charges
 * against it, including the loops that never reach a normalizer — a scope of
 * unrecognized kinds, an effect list, a string array whose length a producer
 * chose. Each of those is a container the producer sizes, so each has to pay.
 *
 * Counting values rather than objects is the point: `structuredClone`
 * preserves sharing, so a directed acyclic graph arrives as a handful of
 * objects, and an array of holes arrives as a single own property.
 */
export const MAX_LITERAL_VALUE_NODES = 100_000;

/**
 * Collects an offending item for a diagnostic, keeping only as many as the
 * diagnostic will render.
 *
 * Capping the message is not enough on its own: the producer picks how many
 * offenders there are, and an accumulator that grows past what `joinTokens`
 * ever shows is the same unbounded growth in a different container. The array
 * keeps one extra so a caller can still tell "exactly the limit" from "more".
 */
export function recordOffender(offenders: string[], offender: string): void {
  if (offenders.length <= DIAGNOSTIC_LIST_LIMIT) {
    offenders.push(offender);
  }
}
