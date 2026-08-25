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
 * Whether a caught value is one of this module's refusals.
 *
 * `instanceof` is not available where it matters: the value may be a Proxy
 * whose `getPrototypeOf` trap throws, and this is called from inside the one
 * catch block that must not throw. The code member is checked by reading its
 * own descriptor, which runs nothing.
 */
export function isProtocolRefusal(value: unknown): value is ProtocolRefusal {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  let descriptor = Object.getOwnPropertyDescriptor(value, 'code');
  return (
    descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'string' &&
    (PROTOCOL_REFUSAL_CODES as readonly string[]).includes(descriptor.value)
  );
}
