import { isHostPackageSpecifier } from '@cardstack/runtime-common/host-package-names';
import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import config from '@cardstack/host/config/environment';

/**
 * The Host's trusted-module boundary: rule R1 of the routing function
 * (RP-6.1), stated as a predicate by RP-6.6. A module inside this boundary is
 * Host-owned code and executes Direct — with the Host's own loader, DOM, and
 * session. Everything outside it is authored code and is caged.
 *
 * This is the ONE classification decision that is a security boundary rather
 * than a smoothness choice. Every other fact classification establishes
 * describes an authored module's closure, where a wrong answer costs a refused
 * fetch or an unnecessary walk. A wrong answer HERE means authored code
 * running uncaged, so this file is written to reject rather than to normalize:
 * a spelling it does not positively recognize as Host-owned is not trusted.
 *
 * Nothing computed from a module's source can reach this decision — it is a
 * function of the identifier alone, so no cache, hash, or module graph
 * participates in it.
 *
 * `isTrustedImport` answers a different, wider question: which modules the
 * Host serves from its own stand-ins rather than as authored source. That is
 * the module-graph walk's pruning test (RP-6.7) — such a module is recorded as
 * an edge and never fetched — and it is NOT a grant of Direct execution.
 * Being allowed to import `@glimmer/component` says nothing about who wrote
 * the importing module, so classification asks `isTrustedModule` for the
 * Direct decision and `isTrustedImport` for the walk; nothing here answers
 * both.
 *
 * What it widens by is deliberately narrow: the framework stand-ins and the
 * icons host, both of which bottom out in modules the Host provides. Pruning
 * is only sound where trust begins — a pruned module's own closure becomes
 * the Host's problem to resolve. Published realm content does not qualify
 * however Host-owned the realm is: it is authored source with its own import
 * graph, and pruning at it would report a complete graph while dropping
 * everything behind it.
 *
 * The icons host is here and not in `isTrustedModule`, so an icon module's
 * package spelling answers the provenance question and its CDN URL does not.
 * That asymmetry is deliberate: the boundary has no path of its own, and an
 * origin-wide grant is exactly what provenance refuses (see `isURLWithin`).
 * The two answers differ only in how strongly the module is contained, never
 * in whether the walk stops there, and the stricter one is what the URL gets.
 */
export function isTrustedModule(moduleIdentifier: string): boolean {
  return (
    isHostPackageSpecifier(moduleIdentifier) ||
    isURLWithin(moduleIdentifier, `${PACKAGES_FAKE_ORIGIN}@cardstack/`) ||
    isURLWithin(moduleIdentifier, 'https://cardstack.com/base/') ||
    isURLWithin(moduleIdentifier, config.resolvedBaseRealmURL)
  );
}

export function isTrustedImport(moduleIdentifier: string): boolean {
  return (
    isTrustedModule(moduleIdentifier) ||
    isURLWithin(moduleIdentifier, config.iconsURL, { allowOriginWide: true }) ||
    hostProvidedFrameworkModules.has(moduleIdentifier)
  );
}

/**
 * `isHostPackageSpecifier` and its list live in runtime-common, because
 * `VirtualNetwork.addRealmMapping` has to ask the same question in reverse —
 * refusing to register a realm whose content would be admitted here as
 * Host-owned — and two predicates that must agree exactly are a hole rather
 * than a duplicate.
 *
 * A Host package missing from that list fails closed: its modules classify as
 * authored, which cages them and makes the walk try to read them. That is the
 * right direction for a stale list — visible, and never an escalation — and it
 * does not break the graph walk, which prunes on the runtime's own shim
 * registry rather than on this list.
 */

// Framework and Host-runtime modules a cage receives as a stand-in rather than
// as authored source. Exact identifiers only: these are bare specifiers with
// no path structure to bound, so a prefix test on any of them would admit an
// unrelated package whose name merely starts the same way.
//
// This is the framework floor, not the whole of what `externals.ts` registers:
// a runtime shims further libraries (date-fns, lodash, ember-concurrency) that
// a card may import, and the walk learns those from the runtime's own registry
// rather than from a second copy of the list here.
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
function isURLWithin(
  identifier: string,
  root: string,
  { allowOriginWide = false }: { allowOriginWide?: boolean } = {},
): boolean {
  try {
    let candidate = new URL(identifier);
    let boundary = new URL(root);
    if (candidate.origin !== boundary.origin) {
      return false;
    }
    let boundaryPath = boundary.pathname.endsWith('/')
      ? boundary.pathname
      : `${boundary.pathname}/`;
    // A boundary with no path of its own covers its whole origin. That is what
    // the icons host is — one origin serving nothing else — and it is the one
    // degenerate input here that fails OPEN, so it is opted into rather than
    // inherited. A realm boundary misconfigured to an origin root would
    // otherwise make every realm on that host trusted, silently.
    if (boundaryPath === '/' && !allowOriginWide) {
      return false;
    }
    return (
      candidate.pathname === boundaryPath.slice(0, -1) ||
      candidate.pathname.startsWith(boundaryPath)
    );
  } catch {
    return false;
  }
}
