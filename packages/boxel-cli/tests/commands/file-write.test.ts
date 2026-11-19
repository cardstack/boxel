import { describe, it, expect } from 'vitest';

import { write } from '../../src/commands/file/write.ts';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator.ts';

const REALM_URL = 'http://localhost:4201/test/';

function authenticatorAnswering(
  respond: () => Promise<Response>,
): RealmAuthenticator {
  return {
    authedRealmFetch: () => respond(),
  };
}

describe('file write result', () => {
  it('reports the reason a request that got no response failed', async () => {
    let result = await write(REALM_URL, 'hello.gts', 'export {};', {
      authenticator: authenticatorAnswering(() =>
        Promise.reject(
          new TypeError('fetch failed', {
            cause: new Error('other side closed'),
          }),
        ),
      ),
    });

    expect(result).toEqual({
      ok: false,
      error: 'fetch failed (caused by: other side closed)',
    });
  });

  it('reports the status and body of a refused write', async () => {
    let result = await write(REALM_URL, 'hello.gts', 'export {};', {
      authenticator: authenticatorAnswering(
        async () => new Response('realm is not ready', { status: 503 }),
      ),
    });

    expect(result).toEqual({
      ok: false,
      error: 'HTTP 503: realm is not ready',
    });
  });
});
