/**
 * Asset-root compatibility for the Ember harness.
 *
 * Boxel's realm generator replaces this module with a realm-aware equivalent;
 * keeping the boundary here prevents demo components from depending on either
 * host's application configuration.
 */
let configuredAssetRoot: string | undefined;

export function configureAssetRoot(root: string | URL | undefined): void {
  if (!root) {
    configuredAssetRoot = undefined;
    return;
  }
  const value = typeof root === 'string' ? root : root.href;
  configuredAssetRoot = value.endsWith('/') ? value : `${value}/`;
}

function rootURL(): string {
  if (configuredAssetRoot) {
    return configuredAssetRoot;
  }
  if (typeof document === 'undefined') {
    return '/';
  }
  const base = document.querySelector('base')?.href ?? document.baseURI;
  return new URL('.', base).pathname;
}

function environment(): 'development' | 'test' {
  if (
    typeof location !== 'undefined' &&
    /(?:^|\/)tests(?:\/|$)/.test(location.pathname)
  ) {
    return 'test';
  }
  return 'development';
}

const config = {
  get environment() {
    return environment();
  },
  get rootURL() {
    return rootURL();
  },
};

export default config;
