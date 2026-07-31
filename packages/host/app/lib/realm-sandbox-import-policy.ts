import ENV from '@cardstack/host/config/environment';

export const trustedHostRealmSpecifierPrefixes = [
  'https://cardstack.com/base/',
  '@cardstack/base/',
  'https://cardstack.com/catalog/',
  '@cardstack/catalog/',
] as const;

export function isBaseRealmModule(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('https://cardstack.com/base/') ||
    moduleIdentifier.startsWith('@cardstack/base/') ||
    moduleIdentifier.startsWith(ENV.resolvedBaseRealmURL)
  );
}

export function isCatalogRealmModule(moduleIdentifier: string): boolean {
  return (
    moduleIdentifier.startsWith('https://cardstack.com/catalog/') ||
    moduleIdentifier.startsWith('@cardstack/catalog/') ||
    Boolean(
      ENV.resolvedCatalogRealmURL &&
      moduleIdentifier.startsWith(ENV.resolvedCatalogRealmURL),
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
  return (
    isTrustedHostRealmModule(moduleIdentifier) ||
    trustedSandboxRuntimeSpecifiers.some(
      (specifier) => moduleIdentifier === specifier,
    ) ||
    trustedSandboxPresentationSpecifierPrefixes.some((prefix) =>
      moduleIdentifier.startsWith(prefix),
    ) ||
    moduleIdentifier.startsWith(ENV.iconsURL)
  );
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
