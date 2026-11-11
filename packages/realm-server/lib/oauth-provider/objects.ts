// The provider's short-lived objects, in `oauth_provider_objects`: the
// library's interactions, and the error references Boxel's error page reads
// (ADR 021 §1.8).
//
// Each object's value is a bearer secret: an interaction's ID is in the
// browser's URL, and an error reference is too. A row is stored and found only
// by the SHA-256 of that value, and never holds the value itself (ADR 021
// §1.2). The library copies an interaction's ID into its payload twice, as
// `jti` and in `returnTo`, the URL the flow resumes at. The interaction
// adapter leaves both out and rebuilds them when it finds the row. A payload
// that still holds the value anywhere else is refused, never stored.
//
// A row past its expiry reads as missing, whether or not it has been deleted.
// Each store first deletes rows that have expired, so abandoned flows and
// error pages nobody opened don't pile up.

import { createHash, randomBytes } from 'crypto';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { DBAdapter } from '@cardstack/runtime-common';

const ERROR_REFERENCE_KIND = 'ErrorReference';

// How long an error reference lasts: as long as the flow it ends could have
// taken (`INTERACTION_TTL_SECONDS`).
export const ERROR_REFERENCE_TTL_SECONDS = 10 * 60;

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export class OAuthProviderObjectError extends Error {
  name = 'OAuthProviderObjectError';
}

async function storeObject(
  dbAdapter: DBAdapter,
  kind: string,
  value: string,
  payload: Record<string, unknown>,
  expiresInSeconds: number,
): Promise<void> {
  let stored = JSON.stringify(payload);
  if (stored.includes(jsonEscaped(value))) {
    throw new OAuthProviderObjectError(
      `the OAuth provider's ${kind} holds its own value, so it can't be stored`,
    );
  }
  await dbAdapter.execute(
    `DELETE FROM oauth_provider_objects WHERE expires_at <= now()`,
  );
  await dbAdapter.execute(
    `INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
       VALUES ($1, decode($2, 'hex'), $3::jsonb, now() + make_interval(secs => $4))
       ON CONFLICT (kind, id_hash) DO UPDATE
         SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at`,
    {
      bind: [kind, sha256Hex(value), stored, expiresInSeconds],
    },
  );
}

async function findObject(
  dbAdapter: DBAdapter,
  kind: string,
  value: string,
): Promise<Record<string, unknown> | undefined> {
  let [row] = (await dbAdapter.execute(
    `SELECT payload FROM oauth_provider_objects
       WHERE kind = $1 AND id_hash = decode($2, 'hex') AND expires_at > now()`,
    { bind: [kind, sha256Hex(value)] },
  )) as { payload: unknown }[];
  return row ? asRecord(row.payload) : undefined;
}

// Deletes the object and answers what it held, if it was there and current.
// Two requests taking the same object can't both get it.
async function takeObject(
  dbAdapter: DBAdapter,
  kind: string,
  value: string,
): Promise<Record<string, unknown> | undefined> {
  let [row] = (await dbAdapter.execute(
    `DELETE FROM oauth_provider_objects
       WHERE kind = $1 AND id_hash = decode($2, 'hex')
       RETURNING payload, expires_at > now() AS current`,
    { bind: [kind, sha256Hex(value)] },
  )) as { payload: unknown; current: boolean }[];
  return row?.current ? asRecord(row.payload) : undefined;
}

async function destroyObject(
  dbAdapter: DBAdapter,
  kind: string,
  value: string,
): Promise<void> {
  await dbAdapter.execute(
    `DELETE FROM oauth_provider_objects
       WHERE kind = $1 AND id_hash = decode($2, 'hex')`,
    { bind: [kind, sha256Hex(value)] },
  );
}

function asRecord(stored: unknown): Record<string, unknown> {
  return (typeof stored === 'string' ? JSON.parse(stored) : stored) as Record<
    string,
    unknown
  >;
}

// The value as it appears inside a JSON string.
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

const INTERACTION_KIND = 'Interaction';

// The library's adapter for its interactions. An interaction is stored, found
// and deleted by its ID; the library looks up nothing else for one.
// `resumeURL` builds the URL the flow resumes at from the issuer and the ID,
// never from the request that started the flow.
export class InteractionAdapter implements Adapter {
  #dbAdapter: DBAdapter;
  #resumeURL: (id: string) => string;

  constructor(dbAdapter: DBAdapter, resumeURL: (id: string) => string) {
    this.#dbAdapter = dbAdapter;
    this.#resumeURL = resumeURL;
  }

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void> {
    let { jti: _jti, returnTo: _returnTo, ...rest } = payload;
    await storeObject(
      this.#dbAdapter,
      INTERACTION_KIND,
      id,
      rest as Record<string, unknown>,
      expiresIn,
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    let payload = await findObject(this.#dbAdapter, INTERACTION_KIND, id);
    return payload
      ? ({
          ...payload,
          jti: id,
          returnTo: this.#resumeURL(id),
        } as AdapterPayload)
      : undefined;
  }

  async destroy(id: string): Promise<void> {
    await destroyObject(this.#dbAdapter, INTERACTION_KIND, id);
  }

  async findByUserCode(): Promise<never> {
    throw this.#unused('findByUserCode');
  }

  async findByUid(): Promise<never> {
    throw this.#unused('findByUid');
  }

  async consume(): Promise<never> {
    throw this.#unused('consume');
  }

  async revokeByGrantId(): Promise<never> {
    throw this.#unused('revokeByGrantId');
  }

  #unused(method: string) {
    return new Error(
      `the OAuth provider's ${INTERACTION_KIND} has no ${method}`,
    );
  }
}

// Why an authorization request didn't reach consent. Each is a fixed label
// for telemetry, and tells the error page which of its states to show.
export type AuthorizationRefusalReason =
  // The library's own refusals, before Boxel could check the client.
  | 'unknown-client'
  | 'bad-redirect-uri'
  | 'library'
  // Boxel's checks before the library (`checkAuthorizationRequest`).
  | 'unsupported-response-type'
  | 'pkce-required'
  | 'prompt-none'
  | 'malformed'
  | 'unknown-resource'
  | 'no-resource-for-scopes'
  | 'client-not-allowed'
  | 'unknown-scope'
  | 'missing-scope'
  | 'openid';

// An authorization error, as Boxel's error page and its "Return" route read
// it. `redirectUri` and `state` are kept only when the client and the redirect
// URI were valid, which is when "Return" is offered.
export interface AuthorizationErrorRecord {
  // The OAuth error code the client gets on "Return".
  error: string;
  reason: AuthorizationRefusalReason;
  clientId?: string;
  redirectUri?: string;
  state?: string;
}

// Stores an error and answers its reference, a long random value that is
// useless once it has expired or been used to return.
export async function storeAuthorizationError(
  dbAdapter: DBAdapter,
  record: AuthorizationErrorRecord,
): Promise<string> {
  let reference = randomBytes(32).toString('base64url');
  await storeObject(
    dbAdapter,
    ERROR_REFERENCE_KIND,
    reference,
    { ...record },
    ERROR_REFERENCE_TTL_SECONDS,
  );
  return reference;
}

export async function findAuthorizationError(
  dbAdapter: DBAdapter,
  reference: string,
): Promise<AuthorizationErrorRecord | undefined> {
  return (await findObject(dbAdapter, ERROR_REFERENCE_KIND, reference)) as
    | AuthorizationErrorRecord
    | undefined;
}

// Finds an error and deletes it, so its "Return" works once.
export async function takeAuthorizationError(
  dbAdapter: DBAdapter,
  reference: string,
): Promise<AuthorizationErrorRecord | undefined> {
  return (await takeObject(dbAdapter, ERROR_REFERENCE_KIND, reference)) as
    | AuthorizationErrorRecord
    | undefined;
}
