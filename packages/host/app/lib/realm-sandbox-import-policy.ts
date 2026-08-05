import ENV from '@cardstack/host/config/environment';

type ImportResolver = (moduleIdentifier: string) => string;

const PACKAGES_FAKE_ORIGIN = 'https://packages/';

export const trustedHostRealmSpecifierPrefixes = [
  'https://cardstack.com/base/',
  '@cardstack/base/',
  'https://cardstack.com/catalog/',
  '@cardstack/catalog/',
] as const;

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function packageSpecifier(moduleIdentifier: string): string {
  return moduleIdentifier.startsWith(PACKAGES_FAKE_ORIGIN)
    ? moduleIdentifier.slice(PACKAGES_FAKE_ORIGIN.length)
    : moduleIdentifier;
}

function hasUnsafePathSegment(moduleIdentifier: string): boolean {
  let decoded = moduleIdentifier;
  try {
    decoded = decodeURIComponent(moduleIdentifier);
  } catch {
    return true;
  }
  return decoded
    .split('\\')
    .join('/')
    .split(/[/?#]/)
    .some((segment: string) => segment === '.' || segment === '..');
}

export function isModuleWithinRealm(
  moduleIdentifier: string,
  realmURL: string,
): boolean {
  if (hasUnsafePathSegment(moduleIdentifier)) {
    return false;
  }
  try {
    let moduleURL = new URL(moduleIdentifier);
    let realm = new URL(withTrailingSlash(realmURL));
    return (
      moduleURL.origin === realm.origin &&
      moduleURL.pathname.startsWith(realm.pathname)
    );
  } catch {
    return false;
  }
}

export function isBaseRealmModule(moduleIdentifier: string): boolean {
  if (hasUnsafePathSegment(moduleIdentifier)) {
    return false;
  }
  moduleIdentifier = packageSpecifier(moduleIdentifier);
  return (
    moduleIdentifier.startsWith('https://cardstack.com/base/') ||
    moduleIdentifier.startsWith('@cardstack/base/') ||
    isModuleWithinRealm(moduleIdentifier, ENV.resolvedBaseRealmURL)
  );
}

export function isCatalogRealmModule(moduleIdentifier: string): boolean {
  if (hasUnsafePathSegment(moduleIdentifier)) {
    return false;
  }
  moduleIdentifier = packageSpecifier(moduleIdentifier);
  return (
    moduleIdentifier.startsWith('https://cardstack.com/catalog/') ||
    moduleIdentifier.startsWith('@cardstack/catalog/') ||
    Boolean(
      ENV.resolvedCatalogRealmURL &&
      isModuleWithinRealm(moduleIdentifier, ENV.resolvedCatalogRealmURL),
    )
  );
}

export const trustedSandboxPresentationSpecifierPrefixes = [
  '@cardstack/boxel-icons/',
  '@cardstack/boxel-ui/',
] as const;

export const trustedSandboxRuntimeSpecifiers = [
  '@ember/component',
  '@ember/object',
  '@ember/helper',
  '@ember/modifier',
  '@ember/component/template-only',
  '@ember/template-factory',
  'ember-provide-consume-context',
  '@glimmer/component',
  '@glimmer/tracking',
  '@ember/template',
  '@cardstack/runtime-common',
] as const;

export function isTrustedHostRealmModule(moduleIdentifier: string): boolean {
  return (
    isBaseRealmModule(moduleIdentifier) ||
    isCatalogRealmModule(moduleIdentifier)
  );
}

export function isTrustedSandboxImport(moduleIdentifier: string): boolean {
  if (hasUnsafePathSegment(moduleIdentifier)) {
    return false;
  }
  moduleIdentifier = packageSpecifier(moduleIdentifier);
  return (
    isTrustedHostRealmModule(moduleIdentifier) ||
    trustedSandboxRuntimeSpecifiers.some(
      (specifier) => moduleIdentifier === specifier,
    ) ||
    trustedSandboxPresentationSpecifierPrefixes.some((prefix) =>
      moduleIdentifier.startsWith(prefix),
    ) ||
    isModuleWithinRealm(
      moduleIdentifier,
      new URL('/@cardstack/boxel-icons/v1/icons/', ENV.iconsURL).href,
    )
  );
}

// A trusted-export token is executable authority once the host reifies it.
// Return only a canonical module identity whose resolved URL remains inside a
// trusted realm. Package/runtime shims retain their exact safe specifier.
export function trustedSandboxImportIdentity(
  moduleIdentifier: string,
  resolveImport: ImportResolver,
): string | undefined {
  if (hasUnsafePathSegment(moduleIdentifier)) {
    return undefined;
  }
  moduleIdentifier = packageSpecifier(moduleIdentifier);
  if (
    trustedSandboxRuntimeSpecifiers.some(
      (specifier) => moduleIdentifier === specifier,
    ) ||
    trustedSandboxPresentationSpecifierPrefixes.some((prefix) =>
      moduleIdentifier.startsWith(prefix),
    )
  ) {
    return moduleIdentifier;
  }

  // Package spellings are an explicit part of the sandbox ABI. Canonicalize
  // them before consulting a realm-relative import map: test realms and
  // workspace import maps may otherwise resolve `@cardstack/base/*` beneath
  // the user realm, turning a trusted standard-library import into a remote
  // fetch (or, worse, a realm-local lookalike).
  if (
    moduleIdentifier.startsWith('@cardstack/base/') ||
    moduleIdentifier.startsWith('https://cardstack.com/base/')
  ) {
    let prefix = moduleIdentifier.startsWith('@cardstack/base/')
      ? '@cardstack/base/'
      : 'https://cardstack.com/base/';
    return new URL(
      moduleIdentifier.slice(prefix.length),
      withTrailingSlash(ENV.resolvedBaseRealmURL),
    ).href;
  }
  if (
    ENV.resolvedCatalogRealmURL &&
    (moduleIdentifier.startsWith('@cardstack/catalog/') ||
      moduleIdentifier.startsWith('https://cardstack.com/catalog/'))
  ) {
    let prefix = moduleIdentifier.startsWith('@cardstack/catalog/')
      ? '@cardstack/catalog/'
      : 'https://cardstack.com/catalog/';
    return new URL(
      moduleIdentifier.slice(prefix.length),
      withTrailingSlash(ENV.resolvedCatalogRealmURL),
    ).href;
  }

  let resolved: string;
  try {
    resolved = resolveImport(moduleIdentifier);
  } catch {
    return undefined;
  }
  if (hasUnsafePathSegment(resolved)) {
    return undefined;
  }
  let trustedRoots = [
    ENV.resolvedBaseRealmURL,
    ...(ENV.resolvedCatalogRealmURL ? [ENV.resolvedCatalogRealmURL] : []),
    new URL('/@cardstack/boxel-icons/v1/icons/', ENV.iconsURL).href,
  ];
  return trustedRoots.some((realmURL) =>
    isModuleWithinRealm(resolved, realmURL),
  )
    ? new URL(resolved).href
    : undefined;
}

export function trustedSandboxImportConfiguration(): {
  exact: string[];
  prefixes: string[];
} {
  return {
    exact: [...trustedSandboxRuntimeSpecifiers],
    prefixes: [
      ...trustedHostRealmSpecifierPrefixes,
      ...trustedSandboxPresentationSpecifierPrefixes,
      ENV.resolvedBaseRealmURL,
      ...(ENV.resolvedCatalogRealmURL ? [ENV.resolvedCatalogRealmURL] : []),
      ENV.iconsURL,
    ],
  };
}
