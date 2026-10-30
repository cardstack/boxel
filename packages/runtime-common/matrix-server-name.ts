// Matrix server names, the users they name, and where a server so named
// answers federation requests. A leaf module with no imports, so a process
// that needs only these can read them without the runtime-common barrel.
//
// A server name is configuration (`MATRIX_SERVER_NAME`), never derived from
// a homeserver's hostname: Matrix delegation lets a server named `example`
// be served from a host on another domain (ADR 004 §1.2).

// Whether `text` is a Matrix server name: a hostname or an IP literal, with
// an optional port.
export function isMatrixServerName(text: string): boolean {
  return (
    text.length <= 255 &&
    /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/.test(text)
  );
}

// The server a full Matrix user id (`@localpart:server`) names, or undefined
// for text that is not one. A localpart never contains `:`, so the first
// colon ends it, and a server name may carry a port.
export function matrixServerNameOf(userId: string): string | undefined {
  let colon = userId.indexOf(':');
  if (!userId.startsWith('@') || colon < 2 || colon === userId.length - 1) {
    return undefined;
  }
  return userId.slice(colon + 1);
}

// Whether `userId` is a user of the server named `serverName`.
export function isUserOfMatrixServer(
  userId: string,
  serverName: string,
): boolean {
  return matrixServerNameOf(userId) === serverName;
}

const WELL_KNOWN_TIMEOUT_MS = 5_000;
const DEFAULT_FEDERATION_PORT = 8448;

// Whether a server name is an IP literal, or carries an explicit port, in
// which case the Matrix server discovery procedure uses it as it is.
function isLiteralOrPorted(serverName: string): boolean {
  return (
    serverName.startsWith('[') ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/.test(serverName) ||
    /:\d{1,5}$/.test(serverName)
  );
}

function withDefaultPort(hostOrHostPort: string): string {
  return /:\d{1,5}$/.test(hostOrHostPort) && !hostOrHostPort.endsWith(']')
    ? hostOrHostPort
    : `${hostOrHostPort}:${DEFAULT_FEDERATION_PORT}`;
}

// The host and port that `https://<serverName>/.well-known/matrix/server`
// delegates federation to, or undefined when the server publishes none, or
// publishes something that is not a server name.
async function wellKnownDelegate(
  serverName: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<string | undefined> {
  try {
    let response = await fetchImpl(
      `https://${serverName}/.well-known/matrix/server`,
      { signal: AbortSignal.timeout(WELL_KNOWN_TIMEOUT_MS) },
    );
    if (!response.ok) {
      return undefined;
    }
    let json = (await response.json()) as { 'm.server'?: unknown };
    let delegate = json?.['m.server'];
    return typeof delegate === 'string' && isMatrixServerName(delegate)
      ? delegate
      : undefined;
  } catch {
    return undefined;
  }
}

// The base URLs at which the homeserver named `serverName` may answer a
// federation request, in the order the Matrix server discovery procedure
// tries them. Each ends with `/`.
//
// An IP literal, or a name with an explicit port, is used as it is. Otherwise
// the server's `.well-known/matrix/server` delegation comes first, then the
// server name on the federation port, then the server name on the HTTPS port
// for a server that delegates through a DNS SRV record, which this module
// does not look up. A name that is not a Matrix server name resolves to no
// URL at all.
export async function federationBaseURLs(
  serverName: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<string[]> {
  if (!isMatrixServerName(serverName)) {
    return [];
  }
  if (isLiteralOrPorted(serverName)) {
    return [`https://${withDefaultPort(serverName)}/`];
  }
  let urls: string[] = [];
  let delegate = await wellKnownDelegate(serverName, fetchImpl);
  if (delegate) {
    urls.push(`https://${withDefaultPort(delegate)}/`);
  }
  urls.push(
    `https://${serverName}:${DEFAULT_FEDERATION_PORT}/`,
    `https://${serverName}/`,
  );
  return [...new Set(urls)];
}

// The homeservers a realm server federates with, from a comma-separated list
// of server names such as `MATRIX_FEDERATION_ALLOWLIST` holds. Blank entries
// are ignored; an entry that is not a server name is a configuration error.
export function parseMatrixFederationAllowlist(
  text: string | undefined,
): string[] {
  let names = (text ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  for (let name of names) {
    if (!isMatrixServerName(name)) {
      throw new Error(
        `${JSON.stringify(name)} in the Matrix federation allowlist is not a Matrix server name`,
      );
    }
  }
  return [...new Set(names)];
}
