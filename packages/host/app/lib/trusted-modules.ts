import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import config from '@cardstack/host/config/environment';

/**
 * The Host's trusted-module boundary: rule R1 of the routing function
 * (RP-6.1). A module inside this boundary is Host-owned code and executes
 * Direct — with the Host's own loader, DOM, and session. Everything outside it
 * is authored code and is caged.
 *
 * This is the ONE classification decision that is a security boundary rather
 * than a smoothness choice. Every other signal the classifier gathers only
 * decides WHICH cage authored code lands in, and a wrong answer there costs a
 * visible failure (a Compartment with no `document`) or an unnecessary iframe.
 * A wrong answer here means authored code running uncaged, so this file is
 * written to reject rather than to normalize: a spelling it does not
 * positively recognize as Host-owned is not trusted.
 *
 * `isTrustedModule` is what the module-graph classifier walks against:
 * `@cardstack/*` packages (including the loader's package pseudo-origin
 * spelling) and the Base realm. It is also the graph's leaf test — a trusted
 * dependency is never fetched or analyzed, because Host code carries no
 * authored evidence to propagate.
 *
 * `isTrustedImport` widens that set with the further import origins a cage may
 * be handed as a Host-provided stand-in: the Catalog realm, the icons host,
 * and the framework shims. Widening it does NOT make an importer Direct —
 * being allowed to import `@glimmer/component` says nothing about who wrote
 * the importing module.
 */
export function isTrustedModule(moduleIdentifier: string): boolean {
  return (
    isSafeCardstackPackageSpecifier(moduleIdentifier) ||
    isURLWithin(moduleIdentifier, `${PACKAGES_FAKE_ORIGIN}@cardstack/`) ||
    isURLWithin(moduleIdentifier, 'https://cardstack.com/base/') ||
    isURLWithin(moduleIdentifier, config.resolvedBaseRealmURL)
  );
}

export function isTrustedImport(moduleIdentifier: string): boolean {
  return (
    isTrustedModule(moduleIdentifier) ||
    isURLWithin(moduleIdentifier, 'https://cardstack.com/catalog/') ||
    (config.resolvedCatalogRealmURL !== undefined &&
      isURLWithin(moduleIdentifier, config.resolvedCatalogRealmURL)) ||
    isURLWithin(moduleIdentifier, config.iconsURL) ||
    hostProvidedFrameworkModules.has(moduleIdentifier)
  );
}

// Framework and Host-runtime modules a cage receives as a stand-in rather than
// as authored source. Exact identifiers only: these are bare specifiers with
// no path structure to bound, so a prefix test on any of them would admit an
// unrelated package whose name merely starts the same way.
const hostProvidedFrameworkModules = new Set([
  '@cardstack/runtime-common',
  '@ember/component',
  '@ember/component/template-only',
  '@ember/helper',
  '@ember/modifier',
  '@ember/object',
  '@ember/template-factory',
  '@glimmer/component',
  '@glimmer/tracking',
  'ember-provide-consume-context',
  `${PACKAGES_FAKE_ORIGIN}ember-provide-consume-context`,
]);

/**
 * A bare package spelling reaches this boundary BEFORE the Loader resolves it
 * to a URL, so `new URL()` normalization — which is what collapses `..` and
 * decodes escapes for every other identifier here — has not run and cannot
 * protect it. `@cardstack/base/../../evil/card` is a valid ESM specifier that
 * a resolver may take outside the package root while reading as trusted to a
 * naive prefix test.
 *
 * So the specifier is admitted only when it is unambiguously a path inside an
 * `@cardstack` package: decodable, free of the characters that carry a second
 * layer of interpretation (`\` as a separator on some resolvers, `%` for a
 * further encoding round, `?`/`#` for a query or fragment that could hide the
 * real path), and free of dot segments. Rejecting `%` outright is what makes
 * the single `decodeURIComponent` sufficient — a doubly-encoded `%252e%252e`
 * decodes to `%2e%2e`, which still carries a `%` and is refused, so there is
 * no need to decode to a fixed point.
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

/**
 * Origin-and-path containment for an absolute module URL. The boundary path is
 * compared with its trailing slash present so a sibling whose name merely
 * begins with the same characters — `/base-evil/` against `/base/` — is
 * outside it, while the boundary directory itself is still inside.
 *
 * A non-URL identifier (a bare specifier, a relative path) is not within any
 * URL boundary and returns false rather than throwing; `new URL()` also
 * resolves the dot segments and percent-escapes of the identifiers that do
 * parse, which is why the comparison here can be a plain prefix test.
 */
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
