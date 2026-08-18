import type { ReadableSchema } from '../../../../src/index.ts';
import {
  DEFAULT_BUILTIN_LIBRARIES,
  type BuiltinLibraryName,
} from '../../../../src/bxl/registry/index.ts';

/**
 * The library set a card gets. `DEFAULT_BUILTIN_LIBRARIES` is the array the
 * runtime itself defaults to and the array `loadAllFormulaExtensions` folds
 * the lazy families into, so aliasing it — rather than copying it — keeps
 * the cases resolving against the same list, in the same order, that
 * `expression()` will use in production. Order matters: `resolveRegistry` is
 * last-wins, so a future collision between two libraries has to be decided
 * here the way production decides it.
 */
export const CARD_LIBRARIES: BuiltinLibraryName[] = DEFAULT_BUILTIN_LIBRARIES;

/**
 * The host time zone a case is being evaluated under. Every case runs under
 * each of the runner's zones, so a `check` that depends on the zone — the
 * handful of filters whose whole job is to read it — can assert the answer
 * that zone calls for instead of settling for one loose enough for all of
 * them.
 */
export interface ZoneContext {
  /** IANA zone name, e.g. `Pacific/Kiritimati`. */
  zone: string;
  /** Minutes east of UTC at `instant`, e.g. `-480` for winter in California. */
  offsetMinutes(instant: Date): number;
}

/**
 * What a program is expected to produce. Exactly one field must be set.
 */
export interface Expectation {
  /**
   * Expected normalized output: the lone value, or `null` for an empty
   * stream. A program that emits nothing and one that emits a single `null`
   * both normalize to `null` here — use `outputs` when that distinction is
   * the point of the case.
   */
  expected?: unknown;
  /**
   * Absolute tolerance for a numeric `expected`. Set it below the smallest
   * term the case exists to prove, not merely below the error of the naive
   * formula: a tolerance wider than the term it is testing for admits an
   * implementation that drops it.
   */
  tolerance?: number;
  /** Expected output stream, for programs that emit no values or several. */
  outputs?: unknown[];
  /** Expected failure, matched against the thrown message. */
  throws?: RegExp;
  /**
   * Assertion for results that are not fixed values — anything reading the
   * clock, the host time zone, or build configuration.
   */
  check?: (outputs: unknown[], context: ZoneContext) => void;
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
 * Every case is evaluated under a spread of host time zones and has to give
 * the same answer in all of them. Indexing runs server-side in UTC while a
 * browser runs in the viewer's zone and CI's is neither, so a result that
 * shifts with the host is both a flaky test and a product bug.
 *
 * The zone is switched by assigning `process.env.TZ` between runs, which is
 * to say after this package's modules have loaded. A host-zone value hoisted
 * to module scope — a `new Date(...)` in a top-level `const`, say — is
 * therefore frozen at whatever the zone was at process start, and stays
 * agreed-upon across every zone the runner tries. Read the zone inside the
 * function, where the sweep can see it.
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
   * Libraries to resolve the program against. Defaults to
   * {@link CARD_LIBRARIES}, the set a card gets. Narrow it to reach a builtin
   * that a later library shadows at the same name and arity, or widen it to
   * {@link AUTHORIZATION_LIBRARIES} for the authorization surface.
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
}

/** Marks a table of jq builtins, which are written in canonical jq. */
export function jqCases(cases: CoverageCase[]): CoverageCase[] {
  return cases.map((entry) => ({ readableSyntax: false, ...entry }));
}

/**
 * The libraries the authorization runtime resolves against, in the order
 * `authorization/conditions.ts` requests them.
 */
export const AUTHORIZATION_LIBRARIES: BuiltinLibraryName[] = [
  'core',
  'authorization',
];

/** Marks a case as reaching the authorization surface, which only that set exposes. */
export function inAuthorizationLibraries(entry: CoverageCase): CoverageCase {
  return { libraries: AUTHORIZATION_LIBRARIES, ...entry };
}
