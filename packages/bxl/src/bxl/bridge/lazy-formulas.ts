import type { AstNode } from './native.ts';
import {
  BXL_REGISTRY,
  DEFAULT_BUILTIN_LIBRARIES,
  LAZY_BUILTIN_LIBRARIES,
  registerBuiltinLibrary,
  type BuiltinLibraryName,
} from '../registry/index.ts';
import {
  FORMULA_STATISTICAL_FILTERS,
  sourceUsesStatisticalFormula,
} from './formula-statistical-manifest.ts';
import {
  FORMULA_BESSEL_FILTERS,
  sourceUsesBesselFormula,
} from './formula-bessel-manifest.ts';
import {
  FORMULA_ENGINEERING_FILTERS,
  sourceUsesEngineeringFormula,
} from './formula-engineering-manifest.ts';
import {
  FORMULA_FINANCIAL_FILTERS,
  sourceUsesFinancialFormula,
} from './formula-financial-manifest.ts';
import {
  VALIDATION_FILTERS,
  sourceUsesValidationFunction,
} from './validation-manifest.ts';

// Lazy chunks, one per usage persona:
//   - formula-statistical (~164 KB) — jstat distributions
//   - formula-bessel      (~11 KB)  — BESSELI/J/K/Y
//   - formula-extras      (~57 KB)  — engineering + financial co-bundled
//   - validation          (~TBD)    — validator.js functions
//
// Each chunk's loader registers the libraries it owns. Per-library
// names (formula-statistical, formula-bessel, formula-engineering,
// formula-financial, validation) stay in BuiltinLibraryName so callers
// can request a specific family — bundling is purely a packaging detail.

let formulaStatisticalLoad: Promise<void> | undefined;
let formulaBesselLoad: Promise<void> | undefined;
let formulaExtrasBundleLoad: Promise<void> | undefined;
let validationLoad: Promise<void> | undefined;

function astUsesFilterSet(node: unknown, filters: Set<string>): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }

  if (
    (node as { type?: unknown }).type === 'filter' &&
    filters.has(String((node as { name?: unknown }).name))
  ) {
    return true;
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      if (value.some((entry) => astUsesFilterSet(entry, filters))) {
        return true;
      }
    } else if (astUsesFilterSet(value, filters)) {
      return true;
    }
  }
  return false;
}

// A rejected chunk load must not stick: the memo caches the in-flight
// promise so concurrent callers share one import, but a failure (e.g. a
// transient network error fetching the chunk) clears the slot so the next
// caller retries — otherwise every later evaluation would re-reject off
// the cached rejection and the family could never load.
function memoizedLoad(
  read: () => Promise<void> | undefined,
  write: (value: Promise<void> | undefined) => void,
  load: () => Promise<void>,
): Promise<void> {
  let pending = read();
  if (!pending) {
    pending = load().catch((error) => {
      write(undefined);
      throw error;
    });
    write(pending);
  }
  return pending;
}

async function ensureStatisticalLoaded() {
  await memoizedLoad(
    () => formulaStatisticalLoad,
    (value) => (formulaStatisticalLoad = value),
    () =>
      import('../registry/formula-statistical.ts').then(
        ({ formulaStatisticalLibrary }) => {
          registerBuiltinLibrary(
            'formula-statistical',
            formulaStatisticalLibrary,
          );
        },
      ),
  );
}

async function ensureBesselLoaded() {
  await memoizedLoad(
    () => formulaBesselLoad,
    (value) => (formulaBesselLoad = value),
    () =>
      import('../registry/formula-bessel.ts').then(
        ({ formulaBesselLibrary }) => {
          registerBuiltinLibrary('formula-bessel', formulaBesselLibrary);
        },
      ),
  );
}

async function ensureExtrasBundleLoaded() {
  await memoizedLoad(
    () => formulaExtrasBundleLoad,
    (value) => (formulaExtrasBundleLoad = value),
    () =>
      import('../registry/bundles/formula-extras.ts').then(
        ({ formulaExtrasBundle }) => {
          for (const [name, library] of Object.entries(formulaExtrasBundle)) {
            registerBuiltinLibrary(name as BuiltinLibraryName, library);
          }
        },
      ),
  );
}

async function ensureValidationLoaded() {
  await memoizedLoad(
    () => validationLoad,
    (value) => (validationLoad = value),
    () =>
      import('../registry/validation.ts').then(({ validationLibrary }) => {
        registerBuiltinLibrary('validation', validationLibrary);
      }),
  );
}

const EXTRAS_LIBRARIES: BuiltinLibraryName[] = [
  'formula-engineering',
  'formula-financial',
];

function canAutoLoadFormulaExtension(
  libraries: BuiltinLibraryName[],
  extension: BuiltinLibraryName | BuiltinLibraryName[],
) {
  const target = Array.isArray(extension) ? extension : [extension];
  if (target.includes('validation')) {
    return libraries.includes('formula') || libraries.includes('validation');
  }
  if (libraries.includes('formula')) return true;
  return target.some((name) => libraries.includes(name));
}

async function maybeLoadSingle(
  next: BuiltinLibraryName[],
  extension: BuiltinLibraryName,
  needed: boolean,
  load: () => Promise<void>,
) {
  if (!needed || !canAutoLoadFormulaExtension(next, extension)) {
    return;
  }
  await load();
  if (!next.includes(extension)) {
    next.push(extension);
  }
}

async function maybeLoadBundle(
  next: BuiltinLibraryName[],
  bundleLibraries: BuiltinLibraryName[],
  needed: boolean,
  load: () => Promise<void>,
) {
  if (!needed || !canAutoLoadFormulaExtension(next, bundleLibraries)) {
    return;
  }
  await load();
  for (const name of bundleLibraries) {
    if (!next.includes(name)) {
      next.push(name);
    }
  }
}

export async function resolveLazyBuiltinLibrariesForAst(
  ast: AstNode,
  libraries: BuiltinLibraryName[] = DEFAULT_BUILTIN_LIBRARIES,
): Promise<BuiltinLibraryName[]> {
  const next = [...new Set(libraries)];
  await maybeLoadSingle(
    next,
    'formula-statistical',
    next.includes('formula-statistical') ||
      astUsesFilterSet(ast, FORMULA_STATISTICAL_FILTERS),
    ensureStatisticalLoaded,
  );
  await maybeLoadSingle(
    next,
    'formula-bessel',
    next.includes('formula-bessel') ||
      astUsesFilterSet(ast, FORMULA_BESSEL_FILTERS),
    ensureBesselLoaded,
  );
  const extrasNeeded =
    EXTRAS_LIBRARIES.some((name) => next.includes(name)) ||
    astUsesFilterSet(ast, FORMULA_ENGINEERING_FILTERS) ||
    astUsesFilterSet(ast, FORMULA_FINANCIAL_FILTERS);
  await maybeLoadBundle(
    next,
    EXTRAS_LIBRARIES,
    extrasNeeded,
    ensureExtrasBundleLoaded,
  );
  await maybeLoadSingle(
    next,
    'validation',
    next.includes('validation') || astUsesFilterSet(ast, VALIDATION_FILTERS),
    ensureValidationLoaded,
  );
  return next;
}

export async function resolveLazyBuiltinLibrariesForExpressions(
  expressions: string[],
  libraries: BuiltinLibraryName[] = DEFAULT_BUILTIN_LIBRARIES,
): Promise<BuiltinLibraryName[]> {
  const next = [...new Set(libraries)];
  await maybeLoadSingle(
    next,
    'formula-statistical',
    next.includes('formula-statistical') ||
      expressions.some((expression) =>
        sourceUsesStatisticalFormula(expression),
      ),
    ensureStatisticalLoaded,
  );
  await maybeLoadSingle(
    next,
    'formula-bessel',
    next.includes('formula-bessel') ||
      expressions.some((expression) => sourceUsesBesselFormula(expression)),
    ensureBesselLoaded,
  );
  const extrasNeeded =
    EXTRAS_LIBRARIES.some((name) => next.includes(name)) ||
    expressions.some((expression) =>
      sourceUsesEngineeringFormula(expression),
    ) ||
    expressions.some((expression) => sourceUsesFinancialFormula(expression));
  await maybeLoadBundle(
    next,
    EXTRAS_LIBRARIES,
    extrasNeeded,
    ensureExtrasBundleLoaded,
  );
  await maybeLoadSingle(
    next,
    'validation',
    next.includes('validation') ||
      expressions.some((expression) =>
        sourceUsesValidationFunction(expression),
      ),
    ensureValidationLoaded,
  );
  return next;
}

/**
 * Load every lazy formula extension and fold it into
 * `DEFAULT_BUILTIN_LIBRARIES`, so synchronous evaluation — most
 * importantly the `bxl()` / `expression()` computeVia factory, which
 * cannot await a chunk mid-compute — sees the full formula surface.
 *
 * A host that hands BXL to card authors (where any expression may name
 * any Excel function) awaits this once before serving the module. The
 * chunks still arrive via dynamic import, so bundlers keep them out of
 * the initial graph; embeds that skip this call keep the smaller core
 * and the per-program auto-loading of the async APIs.
 *
 * Idempotent and safe to call concurrently — each chunk load is
 * memoized module-wide.
 */
export async function loadAllFormulaExtensions(): Promise<void> {
  await Promise.all([
    ensureStatisticalLoaded(),
    ensureBesselLoaded(),
    ensureExtrasBundleLoaded(),
    ensureValidationLoaded(),
  ]);
  // The work list is the registry's own roster of lazy libraries, not a copy
  // of it, so a family added there without a loader above fails here instead
  // of going missing: nothing would ever register it, and every name it owns
  // would simply be absent from the function surface.
  const missing = LAZY_BUILTIN_LIBRARIES.filter(
    (name) => !(name in BXL_REGISTRY),
  );
  if (missing.length > 0) {
    throw new Error(
      `loadAllFormulaExtensions registered no library for ${missing.join(', ')} — ` +
        'add a chunk loader for it above',
    );
  }
  for (const name of LAZY_BUILTIN_LIBRARIES) {
    if (!DEFAULT_BUILTIN_LIBRARIES.includes(name)) {
      DEFAULT_BUILTIN_LIBRARIES.push(name);
    }
  }
}
