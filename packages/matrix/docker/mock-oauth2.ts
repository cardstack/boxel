import { dockerRun, dockerStop, dockerRm } from '../support/docker.ts';

// navikt/mock-oauth2-server stands in for Google's OIDC provider for the
// realm server's Google sign-in in the Playwright suite. It is published on
// the host at MOCK_OAUTH2_HOST_PORT, where the realm server and the browser
// both reach it (see `GOOGLE_OAUTH_ISSUER` in support/isolated-realm-server.ts).
// The mock derives its `issuer` from the request's Host header, so the
// discovery document, the authorization endpoint the browser is sent to and
// the `iss` claim all name `localhost:${MOCK_OAUTH2_HOST_PORT}`.
//
// The mock answers with `Connection: close` and no `Content-Length`, a
// close-delimited body that Node's `fetch` reads as-is.
export const MOCK_OAUTH2_CONTAINER = 'boxel-mock-oauth';
export const MOCK_OAUTH2_HOST_PORT = 8083;
const MOCK_OAUTH2_INTERNAL_PORT = 8080;

export async function mockOauth2Start() {
  await mockOauth2Stop();

  const containerId = await dockerRun({
    // If you bump this version, also update the GHCR mirror so CI keeps caching
    // it (it must match the version pinned there):
    // .github/workflows/mirror-test-images.yml and
    // .github/actions/warm-test-images/action.yml.
    image: 'ghcr.io/navikt/mock-oauth2-server:4.0.1',
    containerName: MOCK_OAUTH2_CONTAINER,
    dockerParams: [
      '-p',
      `${MOCK_OAUTH2_HOST_PORT}:${MOCK_OAUTH2_INTERNAL_PORT}`,
    ],
  });

  console.log(
    `Started mock-oauth2-server (id ${containerId}) on host port ${MOCK_OAUTH2_HOST_PORT}.`,
  );
  return containerId;
}

export async function mockOauth2Stop() {
  try {
    await dockerStop({ containerId: MOCK_OAUTH2_CONTAINER });
    await dockerRm({ containerId: MOCK_OAUTH2_CONTAINER });
  } catch (e: any) {
    if (!e.message?.includes('No such container')) {
      throw e;
    }
  }
}
