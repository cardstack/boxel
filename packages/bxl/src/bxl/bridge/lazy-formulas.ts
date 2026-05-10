import type { AstNode } from './native.js';
import {
  DEFAULT_BUILTIN_LIBRARIES,
  registerBuiltinLibrary,
  type BuiltinLibraryName,
} from '../registry/index.js';
import {
  FORMULA_STATISTICAL_FILTERS,
  sourceUsesStatisticalFormula,
} from './formula-statistical-manifest.js';
import {
  FORMULA_BESSEL_FILTERS,
  sourceUsesBesselFormula,
} from './formula-bessel-manifest.js';
import {
  FORMULA_ENGINEERING_FILTERS,
  sourceUsesEngineeringFormula,
} from './formula-engineering-manifest.js';
import {
  FORMULA_FINANCIAL_FILTERS,
  sourceUsesFinancialFormula,
} from './formula-financial-manifest.js';
import {
  VALIDATION_FILTERS,
  sourceUsesValidationFunction,
} from './validation-manifest.js';

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

async function ensureStatisticalLoaded() {
  formulaStatisticalLoad ??= import('../registry/formula-statistical.js').then(
    ({ formulaStatisticalLibrary }) => {
      registerBuiltinLibrary('formula-statistical', formulaStatisticalLibrary);
    },
  );
  await formulaStatisticalLoad;
}

async function ensureBesselLoaded() {
  formulaBesselLoad ??= import('../registry/formula-bessel.js').then(
    ({ formulaBesselLibrary }) => {
      registerBuiltinLibrary('formula-bessel', formulaBesselLibrary);
    },
  );
  await formulaBesselLoad;
}

async function ensureExtrasBundleLoaded() {
  formulaExtrasBundleLoad ??= import('../registry/bundles/formula-extras.js').then(
    ({ formulaExtrasBundle }) => {
      for (const [name, library] of Object.entries(formulaExtrasBundle)) {
        registerBuiltinLibrary(name as BuiltinLibraryName, library);
      }
    },
  );
  await formulaExtrasBundleLoad;
}

async function ensureValidationLoaded() {
  validationLoad ??= import('../registry/validation.js').then(
    ({ validationLibrary }) => {
      registerBuiltinLibrary('validation', validationLibrary);
    },
  );
  await validationLoad;
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
  await maybeLoadBundle(next, EXTRAS_LIBRARIES, extrasNeeded, ensureExtrasBundleLoaded);
  await maybeLoadSingle(
    next,
    'validation',
    next.includes('validation') ||
      astUsesFilterSet(ast, VALIDATION_FILTERS),
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
      expressions.some((expression) => sourceUsesStatisticalFormula(expression)),
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
    expressions.some((expression) => sourceUsesEngineeringFormula(expression)) ||
    expressions.some((expression) => sourceUsesFinancialFormula(expression));
  await maybeLoadBundle(next, EXTRAS_LIBRARIES, extrasNeeded, ensureExtrasBundleLoaded);
  await maybeLoadSingle(
    next,
    'validation',
    next.includes('validation') ||
      expressions.some((expression) => sourceUsesValidationFunction(expression)),
    ensureValidationLoaded,
  );
  return next;
}
