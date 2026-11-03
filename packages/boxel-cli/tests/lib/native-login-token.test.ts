import { describe, expect, it } from 'vitest';
import { requestNativeLoginToken } from '../../src/lib/native-login-token.ts';
import { createLocalBrowserLogin } from '../../../realm-server/lib/local-browser-login.ts';
import { createLocalRuntimeDiscovery } from '../../../realm-server/lib/local-runtime-discovery.ts';
import jsonwebtoken from 'jsonwebtoken';

const auth = {
  userId: '@alice:default.boxel.localhost',
  accessToken: 'fixture-access',
  deviceId: 'fixture-device',
  matrixUrl: 'http://matrix.default.boxel.localhost:4242/',
};
const metadata = {
  schemaVersion: 1,
  matrixURL: auth.matrixUrl,
  controlURL: 'http://127.0.0.1:4243/',
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('native CLI browser login', () => {
  it('binds discovery to the Matrix profile before sending its session to the loopback controller', async () => {
    const calls: { url: string; authorization: string | null }[] = [];
    const request: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      return calls.length === 1
        ? json(metadata)
        : json({
            ok: true,
            loginToken: 'fixture-browser',
            expiresInMs: 120_000,
          });
    };
    expect(
      await requestNativeLoginToken(
        auth,
        'http://realm.default.boxel.localhost:4242/',
        request,
      ),
    ).toEqual({ loginToken: 'fixture-browser', expiresInMs: 120_000 });
    expect(calls).toEqual([
      {
        url: 'http://realm.default.boxel.localhost:4242/.well-known/boxel-runtime',
        authorization: null,
      },
      {
        url: 'http://127.0.0.1:4243/v1/browser-login-token',
        authorization: 'Bearer fixture-access',
      },
    ]);
  });

  it('refuses a different Matrix server or an external controller without forwarding the session', async () => {
    for (const value of [
      { ...metadata, matrixURL: 'https://matrix.example.com/' },
      { ...metadata, controlURL: 'https://external.example.com/' },
    ]) {
      let count = 0;
      const request: typeof fetch = async () => {
        count++;
        return json(value);
      };
      await expect(
        requestNativeLoginToken(
          auth,
          'http://realm.default.boxel.localhost:4242/',
          request,
        ),
      ).rejects.toThrow('does not match');
      expect(count).toBe(1);
    }
  });

  it('attests only the Matrix account proven by the existing CLI session', async () => {
    const key = 'a'.repeat(64);
    let proof: string | null = null;
    const request: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/whoami'))
        return json({ user_id: auth.userId });
      const body = JSON.parse(String(init?.body));
      proof = body.auth.token;
      const claims = jsonwebtoken.verify(body.auth.token, key, {
        algorithms: ['HS256'],
        issuer: 'boxel-local',
        audience: 'boxel-local-matrix',
      });
      expect(claims).toMatchObject({ sub: 'alice' });
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer fixture-access',
      );
      return json({ login_token: 'fixture-browser', expires_in_ms: 120_000 });
    };
    const login = createLocalBrowserLogin({
      matrixURL: 'http://127.0.0.1:1234/',
      matrixServerName: 'default.boxel.localhost',
      matrixJwtSecret: key,
      fetch: request,
    });
    expect(
      await login({ userId: auth.userId, accessToken: auth.accessToken }),
    ).toEqual({ loginToken: 'fixture-browser', expiresInMs: 120_000 });
    expect(proof).not.toBeNull();
    let count = 0;
    const wrong = createLocalBrowserLogin({
      matrixURL: 'http://127.0.0.1:1234/',
      matrixServerName: 'default.boxel.localhost',
      matrixJwtSecret: key,
      fetch: async () => {
        count++;
        return json({ user_id: '@other:default.boxel.localhost' });
      },
    });
    await expect(
      wrong({ userId: auth.userId, accessToken: auth.accessToken }),
    ).rejects.toThrow('rejected');
    expect(count).toBe(1);
  });

  it('keeps native discovery disabled in hosted configurations', () => {
    expect(createLocalRuntimeDiscovery({})).toBeNull();
    expect(() =>
      createLocalRuntimeDiscovery({
        BOXEL_NATIVE_RUNTIME_URL: 'https://external.example.com/',
        BOXEL_NATIVE_MATRIX_PUBLIC_URL: auth.matrixUrl,
      }),
    ).toThrow('Invalid');
  });
});
