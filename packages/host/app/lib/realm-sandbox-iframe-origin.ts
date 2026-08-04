const sandboxNoncePattern = /^[a-f0-9]{32}$/;

// A capsule survives presentation changes. Formats, delegated fields, and
// component refs are messages within the capsule, not execution identities.
export function realmSandboxIframeCapsuleKey(
  codePreviewID: string | undefined,
  reloadRevision: number,
): string {
  return `${codePreviewID ?? 'canonical'}|reload:${reloadRevision}`;
}

function parsedOrigin(value: string): URL | undefined {
  try {
    let url = new URL(value);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function isLoopback(url: URL): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
}

export function allocateRealmSandboxIframeOrigin(
  configuredOrigin: string | undefined,
  hostOrigin: string,
  nonce?: string,
): string | undefined {
  if (configuredOrigin) {
    let configured = parsedOrigin(configuredOrigin);
    if (!configured) {
      return undefined;
    }
    if (isLoopback(configured)) {
      return configured.origin;
    }
    if (!nonce || !sandboxNoncePattern.test(nonce)) {
      return undefined;
    }
    configured.hostname = `${nonce}.${configured.hostname}`;
    return configured.origin;
  }

  let host = parsedOrigin(hostOrigin);
  if (!host) {
    return undefined;
  }
  if (host.hostname === 'localhost') {
    host.hostname = '127.0.0.1';
    return host.origin;
  }
  if (host.hostname === '127.0.0.1') {
    return host.origin;
  }
  return undefined;
}

export function isRealmSandboxIframeChildLocation(
  configuredOrigin: string | undefined,
  currentOrigin: string,
  currentURL: string,
  isEmbedded: boolean,
): boolean {
  if (!isEmbedded) {
    return false;
  }
  let current = parsedOrigin(currentOrigin);
  let location: URL;
  try {
    location = new URL(currentURL);
  } catch {
    return false;
  }
  if (!current || location.pathname !== '/_realm-sandbox-frame') {
    return false;
  }

  if (configuredOrigin) {
    let configured = parsedOrigin(configuredOrigin);
    if (!configured) {
      return false;
    }
    if (isLoopback(configured)) {
      return current.origin === configured.origin;
    }
    if (
      current.protocol !== configured.protocol ||
      current.port !== configured.port
    ) {
      return false;
    }
    let suffix = `.${configured.hostname}`;
    if (!current.hostname.endsWith(suffix)) {
      return false;
    }
    let nonce = current.hostname.slice(0, -suffix.length);
    return sandboxNoncePattern.test(nonce);
  }

  return current.hostname === '127.0.0.1' || current.hostname === 'localhost';
}

export function newRealmSandboxIframeNonce(): string {
  return globalThis.crypto.randomUUID().split('-').join('').toLowerCase();
}
