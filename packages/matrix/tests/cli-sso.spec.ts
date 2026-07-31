import { expect, test } from './fixtures.ts';
import { getMatrixTestContext } from '../helpers/index.ts';
import {
  MOCK_OAUTH2_CONTAINER,
  MOCK_OAUTH2_HOST_PORT,
  MOCK_OAUTH2_INTERNAL_PORT,
} from '../docker/mock-oauth2.ts';
import { ssoLogin } from '../../boxel-cli/src/lib/sso-login.ts';

// boxel-cli signs in by opening a browser at Synapse's SSO redirect and
// catching the result on a loopback listener. Everything here is the real
// thing — Synapse, the mock OIDC provider, the mapping provider, the loopback
// server, the m.login.token redemption — with `driveMockSso` standing in for
// the browser, since the CLI takes its browser-opener as an argument.
//
//   CLI loopback listener ← Synapse OIDC callback ← mock /authorize form
//                                                 ← Synapse SSO redirect

// Synapse reaches the mock by container name, so its redirect points there.
// This process reaches the same proxy on a published host port.
const CONTAINER_ORIGIN = `http://${MOCK_OAUTH2_CONTAINER}:${MOCK_OAUTH2_INTERNAL_PORT}`;
const HOST_ORIGIN = `http://localhost:${MOCK_OAUTH2_HOST_PORT}`;

function reachable(url: string): string {
  return url.startsWith(CONTAINER_ORIGIN)
    ? HOST_ORIGIN + url.slice(CONTAINER_ORIGIN.length)
    : url;
}

// Synapse carries its OIDC session in a cookie across the redirect chain, so
// the browser stand-in has to keep one.
class CookieJar {
  #byHost = new Map<string, Map<string, string>>();

  store(url: string, res: Response) {
    const cookies = res.headers.getSetCookie?.() ?? [];
    if (!cookies.length) {
      return;
    }
    const host = new URL(url).host;
    const jar = this.#byHost.get(host) ?? new Map<string, string>();
    for (const raw of cookies) {
      const pair = raw.split(';')[0];
      const idx = pair.indexOf('=');
      if (idx > 0) {
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
      }
    }
    this.#byHost.set(host, jar);
  }

  header(url: string): string | undefined {
    const jar = this.#byHost.get(new URL(url).host);
    if (!jar?.size) {
      return undefined;
    }
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

interface Hop {
  method: string;
  url: string;
  status: number;
}

// Walks the SSO redirect chain the way a browser would, filling in the mock's
// login form when it appears. Returns every hop so tests can assert on the
// shape of the chain, not just its outcome.
async function driveMockSso(ssoUrl: string, email: string): Promise<Hop[]> {
  const jar = new CookieJar();
  const hops: Hop[] = [];
  let url = ssoUrl;
  let method = 'GET';
  let body: string | undefined;

  for (let hop = 0; hop < 12; hop++) {
    const headers: Record<string, string> = {};
    const cookie = jar.header(url);
    if (cookie) {
      headers.Cookie = cookie;
    }
    if (body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const res = await fetch(url, { method, headers, body, redirect: 'manual' });
    jar.store(url, res);
    hops.push({ method, url, status: res.status });

    if (res.status >= 300 && res.status < 400) {
      url = reachable(new URL(res.headers.get('location')!, url).href);
      method = 'GET';
      body = undefined;
      // The loopback leg is the CLI's own listener; delivering it ends the
      // browser's part of the flow.
      if (new URL(url).hostname === '127.0.0.1') {
        const final = await fetch(url);
        hops.push({ method: 'GET', url, status: final.status });
        return hops;
      }
      continue;
    }

    const html = await res.text();
    // mock-oauth2-server's interactive login form: `username` becomes the sub,
    // and `claims` carries the verified email the mapping provider keys on.
    if (html.includes('name="username"')) {
      url = reachable(
        new URL(/action="([^"]*)"/.exec(html)?.[1] ?? '', url).href,
      );
      method = 'POST';
      body = new URLSearchParams({
        username: 'google-oauth2|cli',
        claims: JSON.stringify({
          email,
          email_verified: true,
          name: 'CLI Test User',
        }),
      }).toString();
      continue;
    }

    // Synapse serves this instead of redirecting when the target is missing
    // from `sso.client_whitelist`. A real user would click through it; naming
    // it here saves the next person from decoding a wall of HTML.
    if (html.includes('Continue to your account')) {
      throw new Error(
        `Synapse served its SSO redirect-confirmation page at ${url} instead ` +
          "of redirecting to the CLI's loopback listener. Add a matching " +
          'prefix to sso.client_whitelist in the test homeserver.yaml (entries ' +
          'are matched with str.startswith, so "http://127.0.0.1:" is what ' +
          'covers an ephemeral loopback port).',
      );
    }

    throw new Error(
      `SSO chain stalled at ${res.status} with no redirect and no login form: ${html.slice(0, 300)}`,
    );
  }
  throw new Error('SSO chain exceeded the redirect budget');
}

test.describe('boxel-cli browser sign-in (mock OIDC)', () => {
  test('completes the SSO round trip and returns a usable Matrix session', async () => {
    const { matrixUrl } = getMatrixTestContext();
    expect(matrixUrl).toBeTruthy();
    // A fresh address every run: with no account to link, the mapping provider
    // registers one whose localpart derives from the email.
    const email = `cli-sso-${Date.now()}@example.com`;
    let hops: Hop[] = [];

    const auth = await ssoLogin({
      matrixUrl: matrixUrl!,
      openBrowserFn: async (ssoUrl) => {
        hops = await driveMockSso(ssoUrl, email);
        return true;
      },
      log: () => {},
    });

    expect(auth.userId).toMatch(/^@cli-sso-\d+:localhost$/);
    expect(auth.accessToken).toBeTruthy();
    expect(auth.deviceId).toBeTruthy();
    expect(auth.matrixUrl).toBe(matrixUrl);

    // The token is a real session, not just a well-shaped response.
    const whoami = await fetch(
      `${matrixUrl}/_matrix/client/v3/account/whoami`,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toMatchObject({
      user_id: auth.userId,
      device_id: auth.deviceId,
    });

    // Synapse only redirects straight to a target listed in
    // `sso.client_whitelist`; anything else gets a "Continue to your account"
    // interstitial served as 200 HTML. Asserting the callback handed back a
    // redirect is what pins the "http://127.0.0.1:" allowlist entry — drop it
    // from homeserver.yaml and this is the assertion that notices.
    const callbackHop = hops.find((h) =>
      h.url.includes('/_synapse/client/oidc/callback'),
    );
    expect(callbackHop?.status).toBe(302);
    const lastHop = hops[hops.length - 1];
    expect(lastHop.url).toContain('loginToken=');
    expect(lastHop.status).toBe(200);
  });
});
