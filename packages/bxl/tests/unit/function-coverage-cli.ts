/**
 * Registry-enumerated function coverage.
 *
 * Every function BXL exposes must be invoked by at least one case with its
 * result asserted: jq's own builtins, the Excel/formulajs helpers — including
 * the lazily chunked statistical, Bessel, engineering, and financial families
 * — the validator.js helpers, and the authorization builtins. The list of
 * functions to cover is read out of the resolved registry rather than
 * maintained by hand, so adding a builtin without a case fails this suite.
 *
 * Credit is transitive through a jq definition: a worker can earn it from the
 * wrapper that calls it, so a case that reaches a name only through another
 * function asserts that caller's result rather than the worker's own. Where
 * the worker's contract is worth pinning on its own — the private helpers
 * especially — the case calls it directly.
 *
 * "Exposed" is the union over the library sets BXL actually ships — what a
 * card resolves against and what the authorization runtime does — and within
 * each, every name a program can reach rather than only the ones `builtins`
 * reports. A name callable but unlisted still needs a case; see
 * PRIVATE_BUILTINS for why each of those is unlisted.
 *
 * The inputs here are plain JSON, which is the whole function surface's
 * natural test bed. That BXL drives `computeVia` on real card instances —
 * including that each lazy family loads and dispatches inside the host
 * bundle — is proven by the host integration suites.
 *
 * See ./fixtures/function-coverage/runner.ts for how a case earns credit, and
 * ./fixtures/function-coverage/gate.ts for the registry invariants the
 * enumeration rests on.
 */
import {
  BXL_REGISTRY,
  resolveBuiltinRegistry,
} from '../../src/bxl/registry/index.ts';
import { loadAllFormulaExtensions } from '../../src/index.ts';
import {
  functionCoverageCases,
  UNREACHABLE_BUILTINS,
} from './fixtures/function-coverage/index.ts';
import { AUTHORIZATION_LIBRARIES } from './fixtures/function-coverage/case.ts';
import {
  PRIVATE_BUILTINS,
  reachableNames,
  registryGateFailures,
} from './fixtures/function-coverage/gate.ts';
import {
  COVERAGE_ZONES,
  installInvocationRecorder,
  runCoverageCase,
} from './fixtures/function-coverage/runner.ts';

// The lazy families register themselves on load, so every chunk has to be in
// before the registry can report the full function surface.
await loadAllFormulaExtensions();

const libraries = installInvocationRecorder();

const failures = registryGateFailures(libraries);

// The surface to cover is what a program can reach in either shipped set, so
// dropping a library from one set does not quietly shrink the gate.
const exposed = new Set([
  ...reachableNames(libraries),
  ...reachableNames(AUTHORIZATION_LIBRARIES),
]);

const published = new Set([
  ...resolveBuiltinRegistry(libraries).publicNames,
  ...resolveBuiltinRegistry(AUTHORIZATION_LIBRARIES).publicNames,
]);
const notPrivate = [...PRIVATE_BUILTINS.keys()]
  .filter((name) => !exposed.has(name) || published.has(name))
  .sort();
if (notPrivate.length > 0) {
  failures.push(
    'these names are recorded as callable-but-unlisted, but `builtins` now ' +
      'reports them or nothing exposes them at all; drop them from ' +
      `PRIVATE_BUILTINS\n    ${notPrivate.join(', ')}`,
  );
}

const covered = new Set<string>();

for (const testCase of functionCoverageCases) {
  const failure = runCoverageCase(testCase, libraries);
  if (failure) {
    failures.push(`${testCase.covers}: ${testCase.source}\n    ${failure}`);
  } else {
    covered.add(testCase.covers);
  }
}

const declared = new Set(functionCoverageCases.map((entry) => entry.covers));

const unknownDeclarations = [...declared]
  .filter((name) => !exposed.has(name))
  .sort();
if (unknownDeclarations.length > 0) {
  failures.push(
    'these cases cover names the registry no longer exposes — renamed or ' +
      `dropped builtins?\n    ${unknownDeclarations.join(', ')}`,
  );
}

const staleUnreachable = [...UNREACHABLE_BUILTINS.keys()]
  .filter((name) => !exposed.has(name))
  .sort();
if (staleUnreachable.length > 0) {
  failures.push(
    'these names are listed as unreachable but are no longer exposed; drop ' +
      `them from UNREACHABLE_BUILTINS\n    ${staleUnreachable.join(', ')}`,
  );
}

const reachableAfterAll = [...UNREACHABLE_BUILTINS.keys()]
  .filter((name) => declared.has(name))
  .sort();
if (reachableAfterAll.length > 0) {
  failures.push(
    'these names have a coverage case, so they are reachable after all; drop ' +
      `them from UNREACHABLE_BUILTINS\n    ${reachableAfterAll.join(', ')}`,
  );
}

const uncovered = [...exposed]
  .filter((name) => !declared.has(name) && !UNREACHABLE_BUILTINS.has(name))
  .sort();
if (uncovered.length > 0) {
  const byLibrary = new Map<string, string[]>();
  for (const name of uncovered) {
    const library =
      Object.keys(BXL_REGISTRY).find(
        (candidate) =>
          name in BXL_REGISTRY[candidate].jq ||
          name in BXL_REGISTRY[candidate].native,
      ) ?? 'unknown';
    byLibrary.set(library, [...(byLibrary.get(library) ?? []), name]);
  }
  failures.push(
    `${uncovered.length} exposed function(s) have no coverage case; add one ` +
      'per name under tests/unit/fixtures/function-coverage/\n' +
      [...byLibrary]
        .map(([library, names]) => `    ${library}: ${names.join(', ')}`)
        .join('\n'),
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n  ${failure}`);
  }
  throw new Error(`BXL function coverage: ${failures.length} failure(s)`);
}

const knownDefects = functionCoverageCases.filter((entry) => entry.knownDefect);
if (knownDefects.length > 0) {
  console.log('Known defects — the case asserts the correct answer and holds');
  console.log('it failing until the function is fixed:');
  for (const entry of knownDefects) {
    console.log(`  ${entry.covers} — ${entry.knownDefect}`);
  }
  console.log('');
}

console.log(
  `BXL function coverage: ${covered.size} of ${exposed.size} exposed ` +
    `functions invoked across ${functionCoverageCases.length} cases under ` +
    `${COVERAGE_ZONES.length} time zones, ${UNREACHABLE_BUILTINS.size} ` +
    `unreachable, ${knownDefects.length} known defect(s)`,
);
