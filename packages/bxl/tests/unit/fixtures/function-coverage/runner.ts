/**
 * Invocation recording and case execution for the function-coverage suite.
 *
 * Coverage is credited by observed invocation rather than by what a case
 * claims: every library's filters are wrapped before the registry resolves
 * them, so a case naming `ROUND/2` whose program never reaches `ROUND/2`
 * fails instead of quietly counting.
 *
 * Both dispatch paths are wrapped — the streaming `NativeFilter` and the bare
 * filter that the compiled-scalar fast path calls directly — so recording
 * does not push evaluation off the route production takes.
 */
import { ok, strictEqual, deepStrictEqual } from 'node:assert';
import { evaluateBxl } from '../../../../src/index.ts';
import {
  BXL_REGISTRY,
  registerBuiltinLibrary,
  resolveBuiltinRegistry,
  type BuiltinLibraryName,
  type ResolvedBuiltinRegistry,
} from '../../../../src/bxl/registry/index.ts';
import {
  getBareNativeFilter,
  wrapBareNativeFilters,
  type BareNativeFilter,
  type NativeFilter,
} from '../../../../src/jqtools/evaluate/filters/lib/nativeFilter.ts';
import type { CoverageCase } from './case.ts';

const invoked = new Set<string>();

function recordNative(name: string, filter: NativeFilter): NativeFilter {
  const bare = getBareNativeFilter(filter);
  if (bare) {
    // Re-wrap through the library's own helper so the result keeps its
    // `bareNativeFilter` handle. Dropping it would silently route every
    // formula function off the compiled-scalar fast path.
    const recorded: BareNativeFilter = function* (input, ...args) {
      invoked.add(name);
      yield* bare(input, ...args);
    };
    return wrapBareNativeFilters({ [name]: recorded })[name];
  }
  return new Proxy(filter, {
    apply(target, thisArg, args) {
      invoked.add(name);
      return Reflect.apply(target, thisArg, args as Parameters<NativeFilter>);
    },
  });
}

// A jq-source builtin is an AST, not a function, so it records when the
// evaluator reads the definition it is about to run.
function recordJqDef<T extends object>(name: string, def: T): T {
  return new Proxy(def, {
    get(target, property, receiver) {
      invoked.add(name);
      return Reflect.get(target, property, receiver);
    },
  });
}

/**
 * Replace every registered library with a recording equivalent and return the
 * library list to evaluate against. Call once, before anything resolves the
 * registry — `loadAllFormulaExtensions()` first, so the lazy families are in.
 */
export function installInvocationRecorder(): BuiltinLibraryName[] {
  for (const [libraryName, library] of Object.entries(BXL_REGISTRY)) {
    registerBuiltinLibrary(libraryName as BuiltinLibraryName, {
      jq: Object.fromEntries(
        Object.entries(library.jq).map(([name, def]) => [
          name,
          recordJqDef(name, def),
        ]),
      ),
      native: Object.fromEntries(
        Object.entries(library.native).map(([name, filter]) => [
          name,
          recordNative(name, filter),
        ]),
      ),
    });
  }
  return Object.keys(BXL_REGISTRY) as BuiltinLibraryName[];
}

const recordedRegistries = new WeakSet<ResolvedBuiltinRegistry>();

/**
 * `resolveRegistry` rebuilds `builtins/0` after copying the libraries in — it
 * has to, since the list of names it reports depends on which libraries
 * resolved — and that discards the recorder installed on the library entry.
 * Re-wrap it on the resolved registry instead. Resolutions are cached, so
 * each library set gets wrapped once.
 */
function recordResolvedBuiltinsFilter(libraries: BuiltinLibraryName[]) {
  const resolved = resolveBuiltinRegistry(libraries);
  if (recordedRegistries.has(resolved)) return;
  recordedRegistries.add(resolved);
  resolved.native['builtins/0'] = recordNative(
    'builtins/0',
    resolved.native['builtins/0'],
  );
}

/**
 * Evaluate one case and check both halves of its contract: the program
 * produced what the case says, and it really invoked the name the case
 * covers. A case listing `zones` has to satisfy that in every one of them.
 * Returns `undefined` on success, or a description of the failure.
 */
export function runCoverageCase(
  testCase: CoverageCase,
  libraries: BuiltinLibraryName[],
): string | undefined {
  const expectations = (
    ['expected', 'outputs', 'throws', 'check'] as const
  ).filter((key) => Object.hasOwn(testCase, key));
  if (expectations.length !== 1) {
    return `a case needs exactly one of expected/outputs/throws/check, got ${expectations.length}`;
  }

  if (!testCase.zones) return runInAmbientZone(testCase, libraries);

  const ambient = process.env.TZ;
  try {
    for (const zone of testCase.zones) {
      process.env.TZ = zone;
      const failure = runInAmbientZone(testCase, libraries);
      if (failure) return `under TZ=${zone}: ${failure}`;
    }
  } finally {
    if (ambient === undefined) delete process.env.TZ;
    else process.env.TZ = ambient;
  }
  return undefined;
}

function runInAmbientZone(
  testCase: CoverageCase,
  libraries: BuiltinLibraryName[],
): string | undefined {
  const effective = testCase.libraries ?? libraries;
  recordResolvedBuiltinsFilter(effective);
  invoked.clear();
  let outputs: unknown[] | undefined;
  let thrown: unknown;
  try {
    outputs = evaluateBxl(testCase.source, testCase.input ?? null, {
      libraries: effective,
      schema: testCase.schema,
      readableSyntax: testCase.readableSyntax ?? true,
    }).outputs;
  } catch (error) {
    thrown = error;
  }
  const reached = new Set(invoked);

  // A case documenting a known defect has to still reach its function — the
  // defect is in the answer, not the dispatch — and has to still get the
  // wrong answer. When it starts producing the right one the defect is
  // fixed, and the case should go back to being an ordinary assertion.
  if (testCase.knownDefect) {
    if (!reached.has(testCase.covers)) {
      return `the program never invoked ${testCase.covers}`;
    }
    return checkExpectation(testCase, outputs, thrown)
      ? undefined
      : `this case documents a known defect but now produces the expected ` +
          `result. If ${testCase.covers} was fixed, drop its knownDefect note ` +
          `so the case asserts normally.`;
  }

  return (
    checkExpectation(testCase, outputs, thrown) ??
    (reached.has(testCase.covers)
      ? undefined
      : `the program never invoked ${testCase.covers}` +
        (reached.size ? ` (it reached ${[...reached].sort().join(', ')})` : ''))
  );
}

/** The failure message, or `undefined` when the case produced what it claims. */
function checkExpectation(
  testCase: CoverageCase,
  outputs: unknown[] | undefined,
  thrown: unknown,
): string | undefined {
  try {
    if (testCase.throws) {
      ok(thrown, 'expected the program to fail');
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      ok(
        testCase.throws.test(message),
        `expected ${testCase.throws} to match ${JSON.stringify(message)}`,
      );
    } else {
      if (thrown) throw thrown;
      const values = outputs!;
      if (testCase.outputs) {
        deepStrictEqual(values, testCase.outputs);
      } else if (testCase.check) {
        testCase.check(values);
      } else if (testCase.tolerance !== undefined) {
        strictEqual(values.length, 1, 'expected a single output');
        const actual = values[0];
        ok(
          typeof actual === 'number' &&
            Math.abs(actual - (testCase.expected as number)) <=
              testCase.tolerance,
          `expected ${testCase.expected} +/- ${testCase.tolerance}, got ${actual}`,
        );
      } else {
        deepStrictEqual(
          values.length === 1 ? values[0] : values.length === 0 ? null : values,
          testCase.expected,
        );
      }
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}
