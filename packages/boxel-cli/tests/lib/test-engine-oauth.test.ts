import { describe, expect, it, vi } from 'vitest';

import { OAuthConnectionEndedError } from '../../src/lib/oauth-login.ts';
import {
  describeRefusedForOAuth,
  oauthRealmRequestHandlers,
} from '../../src/lib/test-engine.ts';

const REALM_ORIGIN = 'https://realms.example.test';

function route(headers: Record<string, string> = { accept: '*/*' }) {
  return {
    request: () => ({ headers: () => headers }),
    continue: vi.fn(
      async (_options: { headers: Record<string, string> }) => {},
    ),
    abort: vi.fn(async (_code?: string) => {}),
  };
}

function response(url: string, status: number, method = 'GET') {
  return {
    url: () => url,
    status: () => status,
    request: () => ({ method: () => method }),
  };
}

describe("boxel test's requests on an OAuth profile", () => {
  it('reads the access token on each request, so a long run gets renewed ones', async () => {
    let tokens = ['access-1', 'access-2'];
    let pm = { getOAuthAccessToken: vi.fn(async () => tokens.shift()!) };
    let handlers = oauthRealmRequestHandlers(pm, REALM_ORIGIN, {
      onAuthorizationError: () => {},
    });
    let first = route();
    let second = route();

    await handlers.route(first);
    await handlers.route(second);

    expect(first.continue).toHaveBeenCalledWith({
      headers: { accept: '*/*', Authorization: 'Bearer access-1' },
    });
    expect(second.continue).toHaveBeenCalledWith({
      headers: { accept: '*/*', Authorization: 'Bearer access-2' },
    });
  });

  it('aborts a request whose token the connection can no longer give, and reports why', async () => {
    let ended = new OAuthConnectionEndedError('The OAuth connection has ended');
    let pm = {
      getOAuthAccessToken: vi.fn(async () => {
        throw ended;
      }),
    };
    let onAuthorizationError = vi.fn();
    let handlers = oauthRealmRequestHandlers(pm, REALM_ORIGIN, {
      onAuthorizationError,
    });
    let request = route();

    await handlers.route(request);

    expect(request.abort).toHaveBeenCalledWith('failed');
    expect(request.continue).not.toHaveBeenCalled();
    expect(onAuthorizationError).toHaveBeenCalledWith(ended);
  });

  it("names the realm's routes that refused the token", () => {
    let handlers = oauthRealmRequestHandlers(
      { getOAuthAccessToken: async () => 'access-1' },
      REALM_ORIGIN,
      { onAuthorizationError: () => {} },
    );

    handlers.response(response(`${REALM_ORIGIN}/_run-command`, 401, 'POST'));
    handlers.response(response(`${REALM_ORIGIN}/_run-command`, 401, 'POST'));
    handlers.response(response(`${REALM_ORIGIN}/example-realm/card`, 200));
    handlers.response(response('https://elsewhere.example.test/x', 401));

    expect([...handlers.refused]).toEqual(['POST /_run-command']);
    expect(describeRefusedForOAuth([...handlers.refused])).toBe(
      "The realm server refused this profile's OAuth token on POST /_run-command. " +
        "An OAuth token doesn't reach every route the app uses; run this suite with a profile signed in with Matrix.",
    );
  });
});
