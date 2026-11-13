// The provider's OAuth grants, in `oauth_provider_grants` (ADR 021 §1.3): one
// for each consent, never merged into, widened or replaced by a later one.
//
// Boxel creates every grant itself, when a flow finishes (`finish.ts`), with
// the renewal choice its consent recorded and the expiry that choice sets
// (§1.9), in one statement. The library only ever reads a grant, through
// `GrantAdapter` (`adapter.ts`).

import { randomBytes } from 'crypto';
import type { DBAdapter } from '@cardstack/runtime-common';

// How long a grant lasts from its consent: 30 days when the user chose to
// keep the connection, 60 minutes when not (ADR 021 §1.9).
export const RENEWING_GRANT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const NON_RENEWING_GRANT_TTL_SECONDS = 60 * 60;

export interface NewGrant {
  // The user's internal ID (`users.id`), never their Matrix ID.
  userId: string;
  clientId: string;
  // Resource identifier to the scopes approved there.
  resources: Record<string, string[]>;
  renewing: boolean;
}

// Stores a new grant and answers its ID.
export async function createGrant(
  dbAdapter: DBAdapter,
  { userId, clientId, resources, renewing }: NewGrant,
): Promise<string> {
  let id = randomBytes(32).toString('base64url');
  await dbAdapter.execute(
    `INSERT INTO oauth_provider_grants
       (id, user_id, client_id, resources, renewing, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, now() + make_interval(secs => $6))`,
    {
      bind: [
        id,
        userId,
        clientId,
        JSON.stringify(resources),
        renewing,
        renewing ? RENEWING_GRANT_TTL_SECONDS : NON_RENEWING_GRANT_TTL_SECONDS,
      ],
    },
  );
  return id;
}
