import { randomUUID } from 'crypto';
import type { DBAdapter } from '@cardstack/runtime-common';
import { createSecureSessionJWT } from '../../utils/jwt.ts';
import { SECURE_SESSION_TTL_SECONDS } from '../../lib/secure-session.ts';
import { realmSecretSeed } from './index.ts';

// An `Authorization` header for a session signed in on the secure origin,
// with its `secure_sessions` row written directly, for tests about what such
// a session may do rather than how one is signed in.
export async function secureSessionAuth(
  dbAdapter: DBAdapter,
  user: string,
  { client = 'window' }: { client?: 'window' | 'cli' } = {},
): Promise<string> {
  let id = randomUUID();
  await dbAdapter.execute(
    `INSERT INTO secure_sessions (id, user_id, client, sign_in_proof, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + interval '1 hour')`,
    { bind: [id, user, client, `test:${id}`] },
  );
  return `Bearer ${createSecureSessionJWT(
    { user, sessionRoom: 'test-session', secureSession: id },
    realmSecretSeed,
    SECURE_SESSION_TTL_SECONDS,
  )}`;
}
