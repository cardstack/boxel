import type { LoginToken, MatrixAuth } from './auth.ts';

export async function requestNativeLoginToken(
  auth: MatrixAuth,
  realmServerUrl: string,
  fetchFn: typeof fetch,
): Promise<LoginToken> {
  const realm = new URL(realmServerUrl);
  if (
    !['http:', 'https:'].includes(realm.protocol) ||
    !(
      realm.hostname === '127.0.0.1' ||
      realm.hostname === 'localhost' ||
      realm.hostname.endsWith('.localhost')
    ) ||
    realm.username ||
    realm.password ||
    realm.search ||
    realm.hash
  )
    throw new Error('Native browser sign-in is unavailable for this profile');
  const discovery = await fetchFn(new URL('.well-known/boxel-runtime', realm), {
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  if (!discovery.ok) throw new Error('Native browser sign-in is unavailable');
  const metadata: unknown = await discovery.json();
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Object.keys(metadata).length !== 3 ||
    !('schemaVersion' in metadata) ||
    metadata.schemaVersion !== 1 ||
    !('controlURL' in metadata) ||
    typeof metadata.controlURL !== 'string' ||
    !('matrixURL' in metadata) ||
    typeof metadata.matrixURL !== 'string'
  )
    throw new Error('Invalid native sign-in discovery');
  const control = new URL(metadata.controlURL);
  if (
    control.protocol !== 'http:' ||
    control.hostname !== '127.0.0.1' ||
    control.pathname !== '/' ||
    control.username ||
    control.password ||
    control.search ||
    control.hash ||
    new URL(metadata.matrixURL).href !== new URL(auth.matrixUrl).href
  )
    throw new Error('Native sign-in discovery does not match this profile');
  const response = await fetchFn(new URL('v1/browser-login-token', control), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.accessToken}`,
    },
    body: JSON.stringify({ userId: auth.userId }),
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Native browser sign-in rejected');
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    Object.keys(result).length !== 3 ||
    !('ok' in result) ||
    result.ok !== true ||
    !('loginToken' in result) ||
    typeof result.loginToken !== 'string' ||
    !result.loginToken ||
    !('expiresInMs' in result) ||
    typeof result.expiresInMs !== 'number' ||
    !Number.isSafeInteger(result.expiresInMs) ||
    result.expiresInMs <= 0 ||
    result.expiresInMs > 300_000
  )
    throw new Error('Invalid native browser sign-in response');
  return { loginToken: result.loginToken, expiresInMs: result.expiresInMs };
}
