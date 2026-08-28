import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import config from '@cardstack/host/config/environment';

// One-off compatibility exception for Chris's BXL prototype. `boxel.site` is
// a user-publishing domain and is NOT trusted; only this exact module URL is
// admitted because existing cards resolve it lazily through
// `import.meta.loader`, which static graph classification cannot discover.
// Once admitted, the ordinary Sandbox rule still applies: only literal ESM
// dependencies declared by this response may grow its exact module graph.
const trustedBxlPrototypeModule = 'https://bxl.boxel.site/bxl.ts';

// These are Host-installed package facades (see externals.ts), not authored
// realm modules. They are valid one-way dependencies of Sandbox code and may
// already be present in the Host Loader. Treating their resolved
// `https://packages/…` spellings as authored graph nodes makes admission both
// order-dependent and incorrect: the card is untrusted, the framework module
// it imports is not.
const hostProvidedPackageRoots = [
  '@floating-ui/dom',
  'awesome-phonenumber',
  'date-fns',
  'ember-animated',
  'ember-concurrency',
  'ember-css-url',
  'ember-modifier',
  'ember-modify-based-class-resource',
  'ember-provide-consume-context',
  'ember-resources',
  'ember-source/types',
  'ethers',
  'flat',
  'lodash',
  'lodash-es',
  'matrix-js-sdk',
  'qunit',
  'rsvp',
  'super-fast-md5',
  'tracked-built-ins',
  'uuid',
  'yaml',
] as const;

export function isImplicitSandboxModule(moduleIdentifier: string): boolean {
  return moduleIdentifier === trustedBxlPrototypeModule;
}

/**
 * The document-first execution classifier has intentionally only two
 * outcomes. Trust is the whole decision: Host-owned modules may execute
 * Direct; every other entry module executes in the Sandbox child.
 *
 * Source inspection still discovers the authored dependency graph that the
 * child may load, but it must never promote authored code into the Host.
 */
export function documentExecutionModeFor(
  moduleIdentifier: string,
): 'direct' | 'sandbox' {
  return isTrustedModule(moduleIdentifier) ? 'direct' : 'sandbox';
}

/**
 * The Host's trusted-module boundary (docs/
 * boxel-execution-runtime-architecture.md, "Trusted Cardstack components are
 * one-way portals"): modules that execute as Host-owned portals outside any
 * Capsule confinement. Their compiled scoped CSS is Host-trusted styling —
 * component resets, named `@layer`s, deliberate `:global()` selectors — never
 * authored content, so shared-document consumers (the boxel-execution
 * placeholder installer, the search-entries stylesheet loader) exempt these
 * origins from the Capsule CSS policy rather than misapply an
 * authored-content check to them.
 *
 * `isTrustedModule` is the module-graph classifier's boundary: `@cardstack/*`
 * packages (including the loader's package pseudo-origin spelling) and the
 * Base realm. `isTrustedImport` widens it with the further import origins the
 * execution engine treats as Host-provided: the platform-owned Catalog,
 * Skills, and OpenRouter realms, the icons host, and the framework shims.
 * These are dependency grants, not Direct entry grants: an authored card that
 * imports one of them still executes in Sandbox.
 */
export function isTrustedModule(moduleIdentifier: string): boolean {
  return (
    config.boxelExecutionTrustedModules?.includes(moduleIdentifier) ||
    isSafeCardstackPackageSpecifier(moduleIdentifier) ||
    isURLWithin(moduleIdentifier, `${PACKAGES_FAKE_ORIGIN}@cardstack/`) ||
    isURLWithin(moduleIdentifier, 'https://cardstack.com/base/') ||
    isURLWithin(moduleIdentifier, config.resolvedBaseRealmURL)
  );
}

/**
 * Bare package spellings are admitted before the Loader resolves them, so
 * URL normalization cannot protect this boundary. Dot segments (including
 * encoded or backslash spellings) would let an apparently trusted
 * `@cardstack/*` import resolve outside its package root.
 */
function isSafeCardstackPackageSpecifier(identifier: string): boolean {
  if (!identifier.startsWith('@cardstack/')) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(identifier);
  } catch {
    return false;
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('%') ||
    decoded.includes('?') ||
    decoded.includes('#')
  ) {
    return false;
  }
  let segments = decoded.split('/');
  return (
    segments.length >= 2 &&
    segments[0] === '@cardstack' &&
    segments[1] !== '' &&
    segments.every((segment) => segment !== '.' && segment !== '..')
  );
}

export function isTrustedImport(moduleIdentifier: string): boolean {
  return (
    isTrustedModule(moduleIdentifier) ||
    isHostProvidedFrameworkImport(moduleIdentifier) ||
    isURLWithin(moduleIdentifier, 'https://cardstack.com/catalog/') ||
    (config.resolvedCatalogRealmURL !== undefined &&
      isURLWithin(moduleIdentifier, config.resolvedCatalogRealmURL)) ||
    isURLWithin(moduleIdentifier, config.resolvedSkillsRealmURL) ||
    (config.resolvedOpenRouterRealmURL !== undefined &&
      isURLWithin(moduleIdentifier, config.resolvedOpenRouterRealmURL)) ||
    isURLWithin(moduleIdentifier, config.iconsURL) ||
    moduleIdentifier === '@cardstack/runtime-common'
  );
}

function isHostProvidedFrameworkImport(identifier: string): boolean {
  let packageIdentifier = identifier;
  try {
    let candidate = new URL(identifier);
    let packages = new URL(PACKAGES_FAKE_ORIGIN);
    if (candidate.origin !== packages.origin) {
      return false;
    }
    packageIdentifier = candidate.pathname.slice(packages.pathname.length);
  } catch {
    // Bare package specifier: use it as-is.
  }

  if (
    isSafeScopedPackageSpecifier(packageIdentifier, '@ember') ||
    isSafeScopedPackageSpecifier(packageIdentifier, '@glimmer')
  ) {
    return true;
  }
  return hostProvidedPackageRoots.some(
    (root) =>
      packageIdentifier === root || packageIdentifier.startsWith(`${root}/`),
  );
}

function isSafeScopedPackageSpecifier(
  identifier: string,
  scope: '@ember' | '@glimmer',
): boolean {
  if (!identifier.startsWith(`${scope}/`)) {
    return false;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(identifier);
  } catch {
    return false;
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('%') ||
    decoded.includes('?') ||
    decoded.includes('#')
  ) {
    return false;
  }
  let segments = decoded.split('/');
  return (
    segments.length >= 2 &&
    segments[0] === scope &&
    segments[1] !== '' &&
    segments.every((segment) => segment !== '.' && segment !== '..')
  );
}

function isURLWithin(identifier: string, root: string): boolean {
  try {
    let candidate = new URL(identifier);
    let boundary = new URL(root);
    if (candidate.origin !== boundary.origin) {
      return false;
    }
    let boundaryPath = boundary.pathname.endsWith('/')
      ? boundary.pathname
      : `${boundary.pathname}/`;
    return (
      candidate.pathname === boundaryPath.slice(0, -1) ||
      candidate.pathname.startsWith(boundaryPath)
    );
  } catch {
    return false;
  }
}
