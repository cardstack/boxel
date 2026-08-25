/**
 * A failure, as data — because an `Error` is a class instance and cannot
 * cross a boundary.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type { Cloneable } from './cloneable.ts';

/**
 * How far a `ProjectedError`'s `cause` chain is followed. Bounded because the
 * chain is built from data the far side controls, and an unbounded walk over a
 * cyclic or adversarial chain is a hang rather than a diagnostic.
 */
export const PROJECTED_ERROR_MAX_CAUSE_DEPTH = 8;

type ProjectedErrorShape = {
  name: string;
  message: string;
  /**
   * A `ProtocolRefusal`'s code, when the failure was one. The code is the
   * whole point of naming a refusal — the identity a catalog, a log query or
   * a test keys on — and without a member of its own it survives a crossing
   * only as a prefix of `message`, recoverable by string-parsing.
   */
  code?: string;
  stack?: string;
  cause?: ProjectedErrorShape;
};

/**
 * A failure, as data.
 *
 * An `Error` is a class instance and cannot cross a boundary, so a tier that
 * fails projects it into this. The `stack` and the `cause` chain ride along
 * because the error a boundary hands back is usually the wrapper, not the
 * fault: presenting `name`/`message` alone shows "render failed" where the
 * root cause said which getter threw and where.
 */
export type ProjectedError = Cloneable<ProjectedErrorShape>;

/**
 * How much of a projected error's text crosses.
 *
 * Generous enough for a real stack, bounded because the text is chosen by the
 * side that failed, and this record reaches the Host's error presentation.
 */
export const PROJECTED_ERROR_MAX_TEXT_LENGTH = 8192;

function boundText(value: string): string {
  return value.length > PROJECTED_ERROR_MAX_TEXT_LENGTH
    ? `${value.slice(0, PROJECTED_ERROR_MAX_TEXT_LENGTH)}…`
    : value;
}

/**
 * Projects a thrown value into the cloneable record, following `cause` no
 * further than `PROJECTED_ERROR_MAX_CAUSE_DEPTH`.
 *
 * The bound is what makes the depth limit real rather than advisory: a cause
 * chain is built from data the far side controls and `structuredClone`
 * preserves cycles, so a chain that loops back on itself arrives intact and a
 * consumer walking it without a bound hangs instead of reporting.
 */
export function projectError(
  error: unknown,
  depth: number = PROJECTED_ERROR_MAX_CAUSE_DEPTH,
): ProjectedError {
  // Clamped, not trusted: an exported depth a caller may raise is not a bound.
  depth = Math.min(depth, PROJECTED_ERROR_MAX_CAUSE_DEPTH);
  // Never throws. Projection IS the clone step for a thrown value, so unlike
  // a record arriving over a port nothing has sanitized this yet — and
  // authored code can throw anything, including an object whose every member
  // is a getter that throws. A projector that fails here turns "render
  // failed" into a lane with no response on it, which its peer can only
  // discover by timing out.
  //
  // This is the one place the module reads THROUGH accessors rather than
  // refusing them, and it has to: on a real `Error`, `stack` is an own
  // accessor and `name` is inherited from the prototype, so a descriptor-only
  // read returns neither — projecting every `TypeError` as a nameless,
  // stackless `Error` and defeating the record's whole reason for carrying
  // them. Reading is guarded instead; a throwing member simply goes missing.
  let read = (key: string): unknown => {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }
    try {
      return (error as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  };
  // Deliberately not `String(error)`, which dispatches to the producer's own
  // `toString`/`Symbol.toPrimitive`. A `try/catch` would contain a throw from
  // there but not a spin or a 200MB return, and either of those is the very
  // no-response-on-the-lane outcome this function exists to prevent.
  let describe = (): string => `a thrown ${typeof error}`;

  let name = read('name');
  let message = read('message');
  let stack = read('stack');
  let cause = read('cause');

  let projected: ProjectedErrorShape = {
    name: boundText(typeof name === 'string' ? name : 'Error'),
    message: boundText(typeof message === 'string' ? message : describe()),
  };
  let code = read('code');
  if (typeof code === 'string') {
    projected.code = boundText(code);
  }
  if (typeof stack === 'string') {
    projected.stack = boundText(stack);
  }
  if (cause != null && depth > 1) {
    projected.cause = projectError(cause, depth - 1);
  }
  return projected;
}
