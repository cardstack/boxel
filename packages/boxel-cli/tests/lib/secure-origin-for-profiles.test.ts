import { describe, it, expect } from 'vitest';

import { secureOriginForProfiles } from '../../src/lib/secure-session.ts';

const REALM_SERVER = 'https://realms.example.test/';
const SECURE_ORIGIN = 'https://secure.example.test/';

function answering(attributes: Record<string, unknown>, status = 200) {
  return (async () =>
    new Response(JSON.stringify({ data: { attributes } }), {
      status,
      headers: { 'Content-Type': 'application/vnd.api+json' },
    })) as unknown as typeof fetch;
}

describe('secureOriginForProfiles', () => {
  it('is the secure origin when the realm server says its pages sign a profile in', async () => {
    expect(
      await secureOriginForProfiles(
        REALM_SERVER,
        answering({ url: SECURE_ORIGIN, cliAuth: true }),
      ),
    ).toBe(SECURE_ORIGIN);
  });

  it('is none when the realm server says they can’t, or says nothing', async () => {
    expect(
      await secureOriginForProfiles(
        REALM_SERVER,
        answering({ url: SECURE_ORIGIN, cliAuth: false }),
      ),
    ).toBeUndefined();
    expect(
      await secureOriginForProfiles(
        REALM_SERVER,
        answering({ url: SECURE_ORIGIN }),
      ),
    ).toBeUndefined();
  });

  it('is none for a realm server without a secure origin', async () => {
    expect(
      await secureOriginForProfiles(REALM_SERVER, answering({}, 404)),
    ).toBeUndefined();
  });

  it('is none, without waiting long, for a realm server that never answers', async () => {
    let silent = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal!.reason),
        ),
      )) as unknown as typeof fetch;
    let started = Date.now();
    expect(
      await secureOriginForProfiles(REALM_SERVER, silent, 50),
    ).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
