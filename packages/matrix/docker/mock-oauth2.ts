import {
  dockerCreateNetwork,
  dockerRun,
  dockerStop,
  dockerRm,
} from '../support/docker.ts';

// navikt/mock-oauth2-server stands in for Google's OIDC provider for the
// realm server's Google sign-in in the Playwright suite. Two containers are
// involved:
//
//   boxel-mock-oauth-upstream — the actual mock OIDC server (boxel network only)
//   boxel-mock-oauth          — a Caddy reverse proxy in front of it, published
//                               on the host at MOCK_OAUTH2_HOST_PORT
//
// The mock (OkHttp MockWebServer) answers with `Connection: close` and no
// `Content-Length`; Caddy re-frames responses with chunked transfer encoding
// and preserves the inbound Host header, so the mock derives its `issuer` from
// whichever host the caller used. The realm server and the browser both reach
// it at `localhost:${MOCK_OAUTH2_HOST_PORT}` (see `GOOGLE_OAUTH_ISSUER` in
// support/isolated-realm-server.ts), so the issuer / `iss` claim agrees on both
// sides.
export const MOCK_OAUTH2_UPSTREAM_CONTAINER = 'boxel-mock-oauth-upstream';
export const MOCK_OAUTH2_CONTAINER = 'boxel-mock-oauth';
export const MOCK_OAUTH2_INTERNAL_PORT = 8080;
export const MOCK_OAUTH2_HOST_PORT = 8083;
// `default` is mock-oauth2-server's default issuerId — the first path segment
// of every endpoint. This is the issuer as seen from inside the `boxel`
// network, by container name.
export const MOCK_OAUTH2_ISSUER = `http://${MOCK_OAUTH2_CONTAINER}:${MOCK_OAUTH2_INTERNAL_PORT}/default`;

export async function mockOauth2Start() {
  await mockOauth2Stop();
  await dockerCreateNetwork({ networkName: 'boxel' });

  await dockerRun({
    // If you bump this version, also update the GHCR mirror so CI keeps caching
    // it (it must match the version pinned there):
    // .github/workflows/mirror-test-images.yml and
    // .github/actions/warm-test-images/action.yml.
    image: 'ghcr.io/navikt/mock-oauth2-server:4.0.1',
    containerName: MOCK_OAUTH2_UPSTREAM_CONTAINER,
    dockerParams: ['--network=boxel'],
  });

  const proxyId = await dockerRun({
    // Pinned + mirrored alongside the mock image (see note above).
    image: 'caddy:2.10.2-alpine',
    containerName: MOCK_OAUTH2_CONTAINER,
    dockerParams: [
      '-p',
      `${MOCK_OAUTH2_HOST_PORT}:${MOCK_OAUTH2_INTERNAL_PORT}`,
      '--network=boxel',
    ],
    // reverse-proxy preserves the inbound Host header by default, so the mock
    // keeps deriving its issuer from `boxel-mock-oauth:8080`.
    applicationParams: [
      'caddy',
      'reverse-proxy',
      '--from',
      `:${MOCK_OAUTH2_INTERNAL_PORT}`,
      '--to',
      `${MOCK_OAUTH2_UPSTREAM_CONTAINER}:${MOCK_OAUTH2_INTERNAL_PORT}`,
    ],
  });

  console.log(
    `Started mock-oauth2-server (proxy id ${proxyId}) as ${MOCK_OAUTH2_ISSUER} (host port ${MOCK_OAUTH2_HOST_PORT}).`,
  );
  return proxyId;
}

export async function mockOauth2Stop() {
  for (const containerId of [
    MOCK_OAUTH2_CONTAINER,
    MOCK_OAUTH2_UPSTREAM_CONTAINER,
  ]) {
    try {
      await dockerStop({ containerId });
      await dockerRm({ containerId });
    } catch (e: any) {
      if (!e.message?.includes('No such container')) {
        throw e;
      }
    }
  }
}
