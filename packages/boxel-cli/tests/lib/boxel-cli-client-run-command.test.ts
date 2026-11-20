import { describe, it, expect } from 'vitest';

import { BoxelCLIClient } from '../../src/lib/boxel-cli-client.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';

const REALM_SERVER_URL = 'http://localhost:4201/';
const REALM_URL = 'http://localhost:4201/test/';
const COMMAND = '@cardstack/boxel-host/commands/get-card-type-schema/default';

function clientAnswering(respond: () => Promise<Response>): BoxelCLIClient {
  return new BoxelCLIClient({
    authedRealmServerFetch: () => respond(),
  } as unknown as ProfileManager);
}

describe('BoxelCLIClient.runCommand result', () => {
  it('reports the reason a request that got no response failed', async () => {
    let client = clientAnswering(() =>
      Promise.reject(
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('read ECONNRESET'), {
            code: 'ECONNRESET',
          }),
        }),
      ),
    );

    let result = await client.runCommand(REALM_SERVER_URL, REALM_URL, COMMAND);

    expect(result).toEqual({
      status: 'error',
      error:
        'run-command fetch failed: fetch failed (caused by: read ECONNRESET)',
    });
  });

  it('reports the status and body of a refused request', async () => {
    let client = clientAnswering(
      async () => new Response('realm is not ready', { status: 503 }),
    );

    let result = await client.runCommand(REALM_SERVER_URL, REALM_URL, COMMAND);

    expect(result).toEqual({
      status: 'error',
      error: 'run-command HTTP 503: realm is not ready',
    });
  });
});
