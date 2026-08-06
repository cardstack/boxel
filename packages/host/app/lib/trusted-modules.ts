import { PACKAGES_FAKE_ORIGIN } from '@cardstack/runtime-common/package-shim-handler';

import config from '@cardstack/host/config/environment';

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
 * execution engine treats as Host-provided: the Catalog realm, the icons
 * host, and the framework shims.
 */
export function isTrustedModule(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('@cardstack/') ||
    moduleIdentifier.startsWith(`${PACKAGES_FAKE_ORIGIN}@cardstack/`) ||
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
    moduleIdentifier === '@ember/component' ||
    moduleIdentifier === '@ember/object' ||
    moduleIdentifier === '@ember/helper' ||
    moduleIdentifier === '@ember/modifier' ||
    moduleIdentifier === '@ember/component/template-only' ||
    moduleIdentifier === '@ember/template-factory' ||
    moduleIdentifier === '@glimmer/component' ||
    moduleIdentifier === '@glimmer/tracking' ||
    moduleIdentifier === 'ember-provide-consume-context' ||
    moduleIdentifier === '@cardstack/runtime-common'
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
