const sandboxNoncePattern = /^[a-f0-9]{32}$/;

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
  return (
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    ['127.0.0.1', '::1', '[::1]'].includes(url.hostname)
  );
}

/**
 * Allocate one origin per hosted Sandbox process. Hosted configuration names
 * a base origin (for example https://boxelusercontent.dev); a cryptographic
 * 128-bit nonce becomes its first hostname label. Local development already
 * assigns a dedicated Traefik/loopback origin and retains it verbatim.
 */
export function allocateSandboxRuntimeOrigin(
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
    if (
      configured.protocol !== 'https:' ||
      !nonce ||
      !sandboxNoncePattern.test(nonce)
    ) {
      return undefined;
    }
    configured.hostname = `${nonce}.${configured.hostname}`;
    return configured.origin;
  }

  let host = parsedOrigin(hostOrigin);
  if (
    !host ||
    (host.hostname !== 'localhost' && !host.hostname.endsWith('.localhost'))
  ) {
    return undefined;
  }
  if (host.hostname.endsWith('.localhost')) {
    host.hostname = `user.${host.hostname}`;
  } else if (host.hostname === 'localhost') {
    host.hostname = 'user.localhost';
  }
  return host.origin;
}

export function newSandboxRuntimeNonce(): string {
  return globalThis.crypto.randomUUID().split('-').join('').toLowerCase();
}
