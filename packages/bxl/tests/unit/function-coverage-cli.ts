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
 * The inputs here are plain JSON, which is the whole function surface's
 * natural test bed. That BXL drives `computeVia` on real card instances —
 * including that each lazy family loads and dispatches inside the host
 * bundle — is proven by the host integration suites.
 *
 * See ./fixtures/function-coverage/runner.ts for how a case earns credit.
 */
import { resolveBuiltinRegistry } from '../../src/bxl/registry/index.ts';
import { BXL_REGISTRY } from '../../src/bxl/registry/index.ts';
import { loadAllFormulaExtensions } from '../../src/index.ts';
import {
  functionCoverageCases,
  UNREACHABLE_BUILTINS,
} from './fixtures/function-coverage/index.ts';
import {
  installInvocationRecorder,
  runCoverageCase,
} from './fixtures/function-coverage/runner.ts';

// The lazy families register themselves on load, so every chunk has to be in
// before the registry can report the full function surface.
await loadAllFormulaExtensions();

const libraries = installInvocationRecorder();
const exposed = new Set(resolveBuiltinRegistry(libraries).publicNames);

const failures: string[] = [];
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
      libraries.find(
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
    `functions invoked across ${functionCoverageCases.length} cases, ` +
    `${UNREACHABLE_BUILTINS.size} unreachable, ` +
    `${knownDefects.length} known defect(s)`,
);
