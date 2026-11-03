import { runAsGuardedCall } from './outbound/guarded-call-context.ts';

export interface HostedIdentityProof {
  matrixServerName: string;
  openIdToken: string;
}

export interface HostedIdentityVerifier {
  verify(
    proof: HostedIdentityProof,
    expectedUserId: string,
  ): Promise<string | undefined>;
}

// This native-only verifier is used when linking a local account. Endpoints
// come from trusted stack configuration, never from the browser or its proof.
// The existing paired-homeserver session path is unchanged.
export function createHostedIdentityVerifier(
  env: NodeJS.ProcessEnv = process.env,
): HostedIdentityVerifier {
  let issuers: unknown;
  try {
    issuers = JSON.parse(env.BOXEL_HOSTED_IDENTITY_ISSUERS ?? 'null');
  } catch {
    throw new Error(
      'BOXEL_HOSTED_IDENTITY_ISSUERS must be a JSON object of homeserver endpoints',
    );
  }
  if (!issuers || typeof issuers !== 'object' || Array.isArray(issuers)) {
    throw new Error(
      'BOXEL_HOSTED_IDENTITY_ISSUERS must be a JSON object of homeserver endpoints',
    );
  }
  let endpoints = new Map<string, URL>();
  for (let [serverName, endpoint] of Object.entries(issuers)) {
    if (!serverName || typeof endpoint !== 'string') {
      throw new Error('Hosted identity issuer configuration is invalid');
    }
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      throw new Error('Hosted identity issuer configuration is invalid');
    }
    let testLoopback =
      env.NODE_ENV === 'test' &&
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === '[::1]');
    if (
      (!testLoopback && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        'Hosted identity endpoints require verified HTTPS without credentials, query or fragment',
      );
    }
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    endpoints.set(serverName, url);
  }
  if (endpoints.size === 0)
    throw new Error('Configure at least one hosted identity issuer');
  return verifierForEndpoints(endpoints);
}

export function createLocalIdentityVerifier(options: {
  matrixURL: string;
  matrixServerName: string;
}): HostedIdentityVerifier & {
  identify(openIdToken: string): Promise<string | undefined>;
} {
  let endpoint: URL;
  try {
    endpoint = new URL(options.matrixURL);
  } catch {
    throw new Error('Invalid local Matrix identity endpoint');
  }
  if (
    endpoint.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    endpoint.pathname !== '/' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    !/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(options.matrixServerName)
  )
    throw new Error(
      'Local Matrix identity requires a configured loopback origin',
    );
  return {
    ...verifierForEndpoints(new Map([[options.matrixServerName, endpoint]])),
    identify: (openIdToken) =>
      requestIdentity(endpoint, options.matrixServerName, openIdToken),
  };
}

function verifierForEndpoints(
  endpoints: ReadonlyMap<string, URL>,
): HostedIdentityVerifier {
  return {
    async verify(proof, expectedUserId) {
      let separator = expectedUserId.indexOf(':');
      if (
        !expectedUserId.startsWith('@') ||
        separator < 2 ||
        expectedUserId.slice(separator + 1) !== proof.matrixServerName ||
        !proof.openIdToken ||
        proof.openIdToken.length > 8192
      )
        return undefined;
      let issuer = endpoints.get(proof.matrixServerName);
      if (!issuer) return undefined;
      const subject = await requestIdentity(
        issuer,
        proof.matrixServerName,
        proof.openIdToken,
      );
      return subject === expectedUserId ? subject : undefined;
    },
  };
}

async function requestIdentity(
  issuer: URL,
  matrixServerName: string,
  openIdToken: string,
): Promise<string | undefined> {
  if (
    typeof openIdToken !== 'string' ||
    !openIdToken ||
    openIdToken.length > 8192
  )
    return undefined;
  const url = new URL('_matrix/federation/v1/openid/userinfo', issuer);
  url.searchParams.set('access_token', openIdToken);
  return runAsGuardedCall(async () => {
    try {
      let response = await fetch(url, {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return undefined;
      }
      let reader = response.body.getReader();
      let chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        let { done, value } = await reader.read();
        if (done) break;
        if (!value) return undefined;
        bytes += value.byteLength;
        if (bytes > 16_384) {
          await reader.cancel();
          return undefined;
        }
        chunks.push(value);
      }
      let payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('sub' in payload) ||
        typeof payload.sub !== 'string' ||
        payload.sub.length > 255 ||
        !/^@[^:\s]+:[^\s/]+$/.test(payload.sub) ||
        payload.sub.slice(payload.sub.indexOf(':') + 1) !== matrixServerName
      )
        return undefined;
      return payload.sub;
    } catch {
      return undefined;
    }
  });
}
