import { createHmac } from 'node:crypto';
import { passwordFromSeed } from '@cardstack/runtime-common/matrix-client';

// Native provisioning, before realm-server and ai-bot start. Passwords and
// shared-secret MACs stay in HTTPS or loopback request bodies, never URLs.
export async function ensureLocalMatrixAccounts({
  matrixURL,
  serverName,
  registrationSecret,
  realmSecretSeed,
  systemUsernames,
  aiBotPassword,
}: {
  matrixURL: string;
  serverName: string;
  registrationSecret: string;
  realmSecretSeed: string;
  systemUsernames: string[];
  aiBotPassword: string;
}): Promise<void> {
  let base = new URL(matrixURL);
  if (
    base.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/'
  )
    throw new Error('Local Matrix provisioning requires a loopback origin');
  async function request(route: string, init: RequestInit = {}) {
    try {
      return await fetch(new URL(route, base), {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Local Matrix provisioning transport failed');
    }
  }
  async function exists(username: string): Promise<boolean> {
    let result = await request(
      `_matrix/client/v3/profile/${encodeURIComponent(`@${username}:${serverName}`)}`,
    );
    await result.body?.cancel();
    if (result.status !== 200 && result.status !== 404)
      throw new Error('Local Matrix account lookup failed');
    return result.status === 200;
  }
  const accounts = new Map<string, string>();
  for (const username of systemUsernames) {
    if (!/^[a-z0-9_-]+$/.test(username) || username === 'aibot')
      throw new Error('Invalid local system account name');
    accounts.set(username, await passwordFromSeed(username, realmSecretSeed));
  }
  accounts.set('aibot', aiBotPassword);
  for (const [username, password] of accounts) {
    if (await exists(username)) continue;
    let nonceResponse = await request('_synapse/admin/v1/register');
    let payload: unknown;
    try {
      payload = await nonceResponse.json();
    } catch {
      throw new Error('Local Matrix registration nonce is invalid');
    }
    if (
      !nonceResponse.ok ||
      !payload ||
      typeof payload !== 'object' ||
      !('nonce' in payload) ||
      typeof payload.nonce !== 'string'
    )
      throw new Error('Local Matrix registration nonce is invalid');
    let nonce = payload.nonce;
    let mac = createHmac('sha1', registrationSecret)
      .update([nonce, username, password, 'notadmin'].join('\0'))
      .digest('hex');
    let response = await request('_synapse/admin/v1/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nonce, username, password, mac, admin: false }),
    });
    await response.body?.cancel();
    if (!response.ok && !(await exists(username)))
      throw new Error('Local Matrix system account registration failed');
  }
}
