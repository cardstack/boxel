import ENV from '@cardstack/host/config/environment';

type ImportResolver = (moduleIdentifier: string) => string;

export const trustedHostRealmSpecifierPrefixes = [
  'https://cardstack.com/base/',
  '@cardstack/base/',
  'https://cardstack.com/catalog/',
  '@cardstack/catalog/',
] as const;

function withTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
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
  '@ember/object',
  '@ember/helper',
  '@ember/modifier',
  '@glimmer/tracking',
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
