import { RealmPaths, type VirtualNetwork } from '@cardstack/runtime-common';

/**
 * Ensures a module the prerenderer's loader is asked to import lives inside
 * the realm the caller names, so a tool input cannot point the sandbox at a
 * module from elsewhere (SSRF prevention). Either identifier may be a URL or
 * a prefix-form identifier; both are resolved through the virtual network
 * and must resolve to http(s) URLs. Throws if validation fails.
 */
export function assertModuleInRealm(
  moduleIdentifier: string,
  realmIdentifier: string,
  virtualNetwork: VirtualNetwork,
): void {
  let mod = resolveHttpURL(moduleIdentifier, 'moduleUrl', virtualNetwork);
  let realm = resolveHttpURL(realmIdentifier, 'realmUrl', virtualNetwork);

  if (mod.origin !== realm.origin) {
    throw new Error(
      `moduleUrl origin (${mod.origin}) does not match realmUrl origin (${realm.origin})`,
    );
  }

  let realmPaths = new RealmPaths(realm);
  if (!realmPaths.inRealm(mod)) {
    throw new Error(
      `moduleUrl path (${mod.pathname}) is not under realmUrl path (${new URL(realmPaths.url).pathname})`,
    );
  }
}

function resolveHttpURL(
  identifier: string,
  label: string,
  virtualNetwork: VirtualNetwork,
): URL {
  let url: URL;
  try {
    url = virtualNetwork.toURL(identifier);
  } catch {
    throw new Error(
      `${label} is neither a valid URL nor a registered realm-prefix identifier: ${identifier}`,
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `${label} must use http or https scheme, got ${url.protocol}`,
    );
  }
  return url;
}
