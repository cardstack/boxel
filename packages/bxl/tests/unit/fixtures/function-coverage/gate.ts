/**
 * Registry-level invariants the coverage gate rests on.
 *
 * The gate's premise is that the resolved registry is the source of truth for
 * what BXL exposes, so anything that can change the registry without changing
 * `publicNames` can quietly shrink the gate. Each check here closes one of
 * those routes: a lazy family that never registers, a name callable but left
 * off the public list, and a native implementation a jq definition of the
 * same key permanently hides.
 */
import {
  BXL_REGISTRY,
  BUILTIN_LIBRARY_NAMES,
  DEFAULT_BUILTIN_LIBRARIES,
  LAZY_BUILTIN_LIBRARIES,
  resolveBuiltinRegistry,
  type BuiltinLibraryName,
} from '../../../../src/bxl/registry/index.ts';
import { FORMULA_STATISTICAL_FILTERS } from '../../../../src/bxl/bridge/formula-statistical-manifest.ts';
import { FORMULA_BESSEL_FILTERS } from '../../../../src/bxl/bridge/formula-bessel-manifest.ts';
import { FORMULA_ENGINEERING_FILTERS } from '../../../../src/bxl/bridge/formula-engineering-manifest.ts';
import { FORMULA_FINANCIAL_FILTERS } from '../../../../src/bxl/bridge/formula-financial-manifest.ts';
import { VALIDATION_FILTERS } from '../../../../src/bxl/bridge/validation-manifest.ts';
import { AUTHORIZATION_LIBRARIES } from './case.ts';

/**
 * The filters each lazy chunk promises. These sets are what the auto-loaders
 * match a program's source against to decide a chunk is needed, so a name
 * listed here that the chunk does not register would send BXL off to fetch a
 * family that still cannot answer.
 */
const LAZY_FAMILY_MANIFESTS: [BuiltinLibraryName, Set<string>][] = [
  ['formula-statistical', FORMULA_STATISTICAL_FILTERS],
  ['formula-bessel', FORMULA_BESSEL_FILTERS],
  ['formula-engineering', FORMULA_ENGINEERING_FILTERS],
  ['formula-financial', FORMULA_FINANCIAL_FILTERS],
  ['validation', VALIDATION_FILTERS],
];

/**
 * Names a program can call but `builtins` does not report, each with why it
 * is not public. Checked against the registry in both directions, so a new
 * one has to be classified here rather than slipping past the gate — and a
 * name that becomes public has to come off.
 *
 * Being unlisted is not being unreachable: jq hides its own `_`-prefixed
 * helpers from `builtins` and still lets a program name one, and BXL is
 * faithful to that. Each of these gets a coverage case like any other
 * function.
 */
export const PRIVATE_BUILTINS = new Map<string, string>([
  [
    'env/0',
    'blocked in the public sandbox, so it is reachable but only ever throws',
  ],
  [
    '_EXCEL_INDEX/2',
    "the worker behind Excel's `def INDEX`, named apart so the definition " +
      'does not recurse into itself',
  ],
  ['_EXCEL_INDEX/3', "the three-argument half of Excel's INDEX worker"],
  [
    '_assign/2',
    "jq's desugaring target for `=`; BXL's evaluator handles the operator " +
      'directly, so this runs only when a program names it',
  ],
  ['_modify/2', "jq's desugaring target for `|=`, same as `_assign`"],
  [
    '_negate/0',
    "jq's desugaring target for unary minus, which BXL's evaluator also " +
      'applies directly',
  ],
  ['_flatten/1', 'the depth-taking worker behind `flatten`'],
  [
    '_group_by_impl/1',
    'takes the key array `map([f])` builds, so `group_by` evaluates its key ' +
      'expression once per element',
  ],
  ['_sort_by_impl/1', 'the same key-array protocol, for `sort_by`'],
  ['_min_by_impl/1', 'the same key-array protocol, for `min_by`'],
  ['_max_by_impl/1', 'the same key-array protocol, for `max_by`'],
  ['_match_impl/3', 'the worker `match`, `test` and `capture` share'],
  ['_nwise/1', 'the chunking worker behind `splits` and friends'],
  ['_nwise/2', 'the two-argument half of the chunking worker'],
  ['_strindices/1', 'the string half of `indices`'],
]);

/** Every name a program can reach, public or private, across `libraries`. */
export function reachableNames(libraries: BuiltinLibraryName[]): Set<string> {
  const resolved = resolveBuiltinRegistry(libraries);
  return new Set([
    ...Object.keys(resolved.jq),
    ...Object.keys(resolved.native),
  ]);
}

/**
 * Check the registry itself, before any case runs. Returns one description
 * per failure.
 */
export function registryGateFailures(
  cardLibraries: BuiltinLibraryName[],
): string[] {
  const failures: string[] = [];

  // Every library the registry knows of has to have registered. The lazy
  // loader takes its work list from the same roster, so a family with no
  // chunk loader fails here rather than going silently missing.
  const unregistered = BUILTIN_LIBRARY_NAMES.filter(
    (name) => !(name in BXL_REGISTRY),
  );
  if (unregistered.length > 0) {
    failures.push(
      'these libraries are named in BUILTIN_LIBRARY_NAMES but nothing ' +
        `registered them\n    ${unregistered.join(', ')}`,
    );
  }

  const notDefaulted = LAZY_BUILTIN_LIBRARIES.filter(
    (name) => !DEFAULT_BUILTIN_LIBRARIES.includes(name),
  );
  if (notDefaulted.length > 0) {
    failures.push(
      'loadAllFormulaExtensions left these lazy libraries out of ' +
        `DEFAULT_BUILTIN_LIBRARIES, so a card cannot reach them\n    ${notDefaulted.join(', ')}`,
    );
  }

  // A manifest is the auto-loader's promise that naming one of these
  // functions is worth fetching the chunk. The chunk has to deliver it.
  for (const [library, manifest] of LAZY_FAMILY_MANIFESTS) {
    const exposed = reachableNames([...cardLibraries, library]);
    const undelivered = [...manifest]
      .filter((name) => !exposed.has(name))
      .sort();
    if (undelivered.length > 0) {
      failures.push(
        `the ${library} manifest lists function(s) its chunk does not ` +
          `register, so auto-loading them would fetch the chunk and still ` +
          `fail\n    ${undelivered.join(', ')}`,
      );
    }
  }

  // Every callable-but-unlisted name has to carry a reason. `publicNames` is
  // what the gate enumerates from, so a name that quietly falls off it would
  // take its coverage requirement with it.
  for (const libraries of [cardLibraries, AUTHORIZATION_LIBRARIES]) {
    const resolved = resolveBuiltinRegistry(libraries);
    const published = new Set(resolved.publicNames);
    const unrecorded = [...reachableNames(libraries)]
      .filter((name) => !published.has(name) && !PRIVATE_BUILTINS.has(name))
      .sort();
    if (unrecorded.length > 0) {
      failures.push(
        `resolving [${libraries.join(', ')}] exposes name(s) a program can ` +
          'call that `builtins` does not report; publish them or record why ' +
          `in PRIVATE_BUILTINS\n    ${unrecorded.join(', ')}`,
      );
    }
  }

  // A jq definition wins over a native of the same key in both the annotator
  // and the evaluator, so a native that shares a key with one can never run.
  // Coverage credits whichever the program reached, which means the pair
  // looks exercised while half of it is dead.
  for (const libraries of [cardLibraries, AUTHORIZATION_LIBRARIES]) {
    const resolved = resolveBuiltinRegistry(libraries);
    const shadowed = Object.keys(resolved.native)
      .filter((name) => name in resolved.jq)
      .sort();
    if (shadowed.length > 0) {
      failures.push(
        `resolving [${libraries.join(', ')}] leaves native implementation(s) ` +
          'a jq definition of the same key permanently hides; delete the ' +
          `native or rename it as a private worker\n    ${shadowed.join(', ')}`,
      );
    }
  }

  return failures;
}
