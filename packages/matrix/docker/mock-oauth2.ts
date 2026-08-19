import {
  dockerCreateNetwork,
  dockerRun,
  dockerStop,
  dockerRm,
} from '../support/docker.ts';

// navikt/mock-oauth2-server stands in for Google's OIDC provider in the
// Playwright SSO suite. Two containers are involved:
//
//   boxel-mock-oauth-upstream — the actual mock OIDC server (boxel network only)
//   boxel-mock-oauth          — a Caddy reverse proxy in front of it
//
// The proxy exists because the mock (OkHttp MockWebServer) returns responses
// with `Connection: close` and no `Content-Length`. Synapse's Twisted HTTP
// client rejects that framing with `PartialDownloadError`, so OIDC discovery
// fails and Synapse won't boot. Caddy buffers and re-frames the response with
// chunked transfer encoding, which Twisted accepts. Caddy preserves the inbound
// Host header, so the mock still derives its `issuer` from `boxel-mock-oauth`.
//
// Synapse (on the `boxel` network) reaches the proxy by container name; the
// Playwright browser reaches the same `boxel-mock-oauth` host via a
// `--host-resolver-rules` MAP in playwright.config.ts. Using the identical
// `boxel-mock-oauth:8080` URL on both sides keeps the issuer / `iss` claim
// consistent, which is what lets Synapse's discovery and token validation
// line up.
export const MOCK_OAUTH2_UPSTREAM_CONTAINER = 'boxel-mock-oauth-upstream';
export const MOCK_OAUTH2_CONTAINER = 'boxel-mock-oauth';
export const MOCK_OAUTH2_INTERNAL_PORT = 8080;
export const MOCK_OAUTH2_HOST_PORT = 8083;
// `default` is mock-oauth2-server's default issuerId — the first path segment
// of every endpoint. Synapse's `oidc_providers[].issuer` must equal this.
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
