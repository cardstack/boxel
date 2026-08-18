import type { ReadableSchema } from '../../../../src/index.ts';
import type { BuiltinLibraryName } from '../../../../src/bxl/registry/index.ts';

/**
 * What a program is expected to produce. Exactly one field must be set.
 */
export interface Expectation {
  /** Expected normalized output: the lone value, or `null` for an empty stream. */
  expected?: unknown;
  /** Absolute tolerance for a numeric `expected`. */
  tolerance?: number;
  /** Expected output stream, for programs that emit no values or several. */
  outputs?: unknown[];
  /** Expected failure, matched against the thrown message. */
  throws?: RegExp;
  /**
   * Assertion for results that are not fixed values — anything reading the
   * clock, the host time zone, or build configuration.
   */
  check?: (outputs: unknown[]) => void;
}

/**
 * One function-coverage case: a program that reaches a single registry entry,
 * plus an assertion about what that program produced.
 *
 * `covers` is the `NAME/arity` registry key this case is responsible for. The
 * runner watches which builtins the program actually invokes and fails the
 * case if `covers` is not among them, so a case cannot claim coverage its
 * program never reaches.
 *
 * Exactly one of `expected`, `outputs`, `throws`, or `check` must be set.
 */
export interface CoverageCase extends Expectation {
  /** Registry key this case covers, e.g. `ROUND/2`. */
  covers: string;
  /** Program source. */
  source: string;
  /** Value bound to `.`. Defaults to `null`. */
  input?: unknown;
  /** Field metadata the readable-syntax compiler uses to resolve labels. */
  schema?: ReadableSchema;
  /**
   * Libraries to resolve the program against. Defaults to every registered
   * library, which is what a card gets. Narrow it to reach a builtin that a
   * later library shadows at the same name and arity.
   */
  libraries?: BuiltinLibraryName[];
  /**
   * Run the readable-syntax compiler before evaluating. Excel and
   * validator.js helpers leave this at its `true` default — readable syntax
   * is the surface card authors write, so the compiler stays in the loop.
   * jq's own builtins have no readable form and set it to `false`.
   */
  readableSyntax?: boolean;
  /**
   * States that this function is known not to behave as the case asserts,
   * and why. The assertion stays as the correct answer — Excel's, jq's, or
   * validator.js's — and the suite inverts it: the case must keep failing
   * while the defect stands, and reports itself the moment it starts
   * passing, so a fix promotes the case instead of leaving it stale.
   *
   * Reach for this only for a divergence from the function's specification.
   * A divergence this codebase deliberately documents is not a defect: assert
   * the documented behavior and note it in a comment.
   *
   * Requires {@link produces}.
   */
  knownDefect?: string;
  /**
   * What the function returns today, required alongside {@link knownDefect}.
   * Tolerating "any wrong answer" would let a defect change shape unnoticed —
   * a different wrong value, or a throw where there was a value — so the
   * current behavior is pinned as tightly as the correct one.
   */
  produces?: Expectation;
  /**
   * Time zones to evaluate under, each of which must satisfy the same
   * expectation. Defaults to the ambient zone only. Anything reading a date
   * sets {@link TIMEZONES} so a case cannot pass on a developer's machine and
   * then disagree with whatever zone CI happens to run in.
   */
  zones?: string[];
}

/** Marks a table of jq builtins, which are written in canonical jq. */
export function jqCases(cases: CoverageCase[]): CoverageCase[] {
  return cases.map((entry) => ({ readableSyntax: false, ...entry }));
}

/**
 * The zone spread date cases run under: UTC, a negative whole-hour offset, a
 * half-hour offset, and the two extremes of the offset range. A date result
 * that is the same in all five does not depend on the host zone.
 */
export const TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'Asia/Kolkata',
  'Pacific/Kiritimati',
  'Pacific/Niue',
];

/** Marks a table whose results must not shift with the host time zone. */
export function dateCases(cases: CoverageCase[]): CoverageCase[] {
  return cases.map((entry) => ({ zones: TIMEZONES, ...entry }));
}
