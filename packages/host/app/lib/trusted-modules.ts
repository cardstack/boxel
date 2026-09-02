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
