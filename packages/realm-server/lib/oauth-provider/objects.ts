// The provider's short-lived objects, in `oauth_provider_objects`: the
// library's interactions, sessions and authorization codes, the error
// references Boxel's error page reads (ADR 021 §1.8), and each flow's consent
// decision and the ticket that finishes it (§1.7).
//
// Each object's value is a bearer secret: an interaction's ID is in the
// browser's URL, a session's ID is its cookie, and an authorization code, an
// error reference and a ticket are values a browser carries too. A decision is
// stored under its flow's interaction ID. A row is stored and found only
// by the SHA-256 of that value, and never holds the value itself (ADR 021
// §1.2). The library copies each object's value into its payload as `jti`,
// and an interaction's ID a second time in `returnTo`, the URL the flow
// resumes at. The adapters leave these out and rebuild them when they find
// the row. A payload that still holds the value anywhere else is refused,
// never stored.
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

// An object's payload as stored, once it is known not to hold the object's
// own value. Rows that have expired are deleted first, so abandoned flows
// don't pile up.
async function prepareStore(
  dbAdapter: DBAdapter,
  kind: string,
  value: string,
  payload: Record<string, unknown>,
): Promise<string> {
  let stored = JSON.stringify(payload);
  if (stored.includes(jsonEscaped(value))) {
    throw new OAuthProviderObjectError(
      `the OAuth provider's ${kind} holds its own value, so it can't be stored`,
    );
  }
  await dbAdapter.execute(
    `DELETE FROM oauth_provider_objects WHERE expires_at <= now()`,
  );
  return stored;
}

async function storeObject(
  dbAdapter: DBAdapter,
  kind: string,
  value: string,
  payload: Record<string, unknown>,
  expiresInSeconds: number,
): Promise<void> {
  let stored = await prepareStore(dbAdapter, kind, value, payload);
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

// The library's adapter for a kind of object it stores, finds and deletes by
// the object's own value, which is a bearer secret. The value is the row's
// key, hashed, and the library's copy of it in the payload (`jti`) is left
// out and put back when the row is found. The library looks up nothing else
// for these kinds, so every other lookup throws.
class BearerKeyedAdapter implements Adapter {
  #dbAdapter: DBAdapter;
  #kind: string;

  constructor(dbAdapter: DBAdapter, kind: string) {
    this.#dbAdapter = dbAdapter;
    this.#kind = kind;
  }

  // The payload as stored: without `jti`, and without anything else that
  // holds a bearer value or that `restore` rebuilds.
  protected stored(payload: AdapterPayload): Record<string, unknown> {
    let { jti: _jti, ...rest } = payload;
    return rest;
  }

  // The payload as the library stored it, from what the row holds.
  protected restore(
    id: string,
    stored: Record<string, unknown>,
  ): AdapterPayload {
    return { ...stored, jti: id } as AdapterPayload;
  }

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void> {
    await storeObject(
      this.#dbAdapter,
      this.#kind,
      id,
      this.stored(payload),
      expiresIn,
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    let payload = await findObject(this.#dbAdapter, this.#kind, id);
    return payload ? this.restore(id, payload) : undefined;
  }

  async destroy(id: string): Promise<void> {
    await destroyObject(this.#dbAdapter, this.#kind, id);
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
    return new OAuthProviderObjectError(
      `the OAuth provider's ${this.#kind} has no ${method}`,
    );
  }
}

// The library's adapter for its interactions, stored by their IDs. The library
// copies the ID into the payload a second time, in `returnTo`, the URL the
// flow resumes at, which `resumeURL` rebuilds from the issuer and the ID,
// never from the request that started the flow. An interaction started under
// a signed-in library session would also hold that session's ID
// (`session.cookie`), the value of its cookie. Boxel drops the session at the
// start of every flow, so none does, and the field is left out all the same:
// the library never reads it back.
export class InteractionAdapter extends BearerKeyedAdapter {
  #resumeURL: (id: string) => string;

  constructor(dbAdapter: DBAdapter, resumeURL: (id: string) => string) {
    super(dbAdapter, 'Interaction');
    this.#resumeURL = resumeURL;
  }

  protected stored(payload: AdapterPayload): Record<string, unknown> {
    let { returnTo: _returnTo, session, ...rest } = super.stored(payload);
    if (isRecord(session)) {
      let { cookie: _cookie, ...kept } = session;
      return { ...rest, session: kept };
    }
    return rest;
  }

  protected restore(
    id: string,
    stored: Record<string, unknown>,
  ): AdapterPayload {
    return { ...super.restore(id, stored), returnTo: this.#resumeURL(id) };
  }
}

// The library's adapter for its sessions, stored by their IDs, which are the
// values of its session cookie. A session lives only through the end of one
// flow (ADR 021 §1.7): nothing the library issues outlives it, so it never
// looks a session up by anything but its cookie.
export class SessionAdapter extends BearerKeyedAdapter {
  constructor(dbAdapter: DBAdapter) {
    super(dbAdapter, 'Session');
  }
}

// The library's adapter for its authorization codes, stored by their values.
export class AuthorizationCodeAdapter extends BearerKeyedAdapter {
  constructor(dbAdapter: DBAdapter) {
    super(dbAdapter, 'AuthorizationCode');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

const CONSENT_DECISION_KIND = 'ConsentDecision';
const CONSENT_TICKET_KIND = 'ConsentTicket';

// How long a consent ticket lasts, at most: long enough for the authorize
// page to send the browser on to finish the flow, and short enough that a
// ticket copied out of a URL is already spent or useless.
export const CONSENT_TICKET_TTL_SECONDS = 60;

// The user's answer on a flow's consent (ADR 021 §1.7), stored under the
// flow's interaction ID until the interaction expires. It always covers
// exactly the scopes the flow asked for at each resource.
export interface ConsentDecisionRecord {
  // The secure session's user: a Matrix user ID.
  user: string;
  allowed: boolean;
  // Whether the grant renews (ADR 021 §1.9). Never true when the client
  // can't use the refresh grant.
  renew: boolean;
  clientId: string;
  // Resource identifier to the scopes asked for there.
  scopes: Record<string, string[]>;
}

// What a consent ticket names: the SHA-256 of the interaction ID it finishes,
// never the ID itself.
export interface ConsentTicketRecord {
  interaction: string;
}

// Records a flow's decision and stores the ticket that finishes it, both or
// neither, and answers the ticket: a long random value that finishes the
// flow once, in the browser that started it. Answers undefined when the flow
// already has a decision: a flow is decided once, and has at most one
// ticket. One statement writes both rows, so a ticket that can't be stored
// leaves the flow undecided.
export async function decideFlow(
  dbAdapter: DBAdapter,
  interactionId: string,
  record: ConsentDecisionRecord,
  {
    decisionExpiresIn,
    ticketExpiresIn,
  }: { decisionExpiresIn: number; ticketExpiresIn: number },
): Promise<string | undefined> {
  let ticket = randomBytes(32).toString('base64url');
  let ticketRecord: ConsentTicketRecord = {
    interaction: sha256Hex(interactionId),
  };
  let decision = await prepareStore(
    dbAdapter,
    CONSENT_DECISION_KIND,
    interactionId,
    { ...record },
  );
  let stored = await prepareStore(dbAdapter, CONSENT_TICKET_KIND, ticket, {
    ...ticketRecord,
  });
  let rows = await dbAdapter.execute(
    `WITH decision AS (
       INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
         VALUES ($1, decode($2, 'hex'), $3::jsonb, now() + make_interval(secs => $4))
         ON CONFLICT (kind, id_hash) DO NOTHING
         RETURNING kind
     )
     INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
       SELECT $5, decode($6, 'hex'), $7::jsonb, now() + make_interval(secs => $8)
         FROM decision
       RETURNING kind`,
    {
      bind: [
        CONSENT_DECISION_KIND,
        sha256Hex(interactionId),
        decision,
        decisionExpiresIn,
        CONSENT_TICKET_KIND,
        sha256Hex(ticket),
        stored,
        ticketExpiresIn,
      ],
    },
  );
  return rows.length > 0 ? ticket : undefined;
}

export async function findConsentDecision(
  dbAdapter: DBAdapter,
  interactionId: string,
): Promise<ConsentDecisionRecord | undefined> {
  return (await findObject(dbAdapter, CONSENT_DECISION_KIND, interactionId)) as
    | ConsentDecisionRecord
    | undefined;
}

// Finds a ticket and deletes it, so it is spent on its first presentation.
export async function takeConsentTicket(
  dbAdapter: DBAdapter,
  ticket: string,
): Promise<ConsentTicketRecord | undefined> {
  return (await takeObject(dbAdapter, CONSENT_TICKET_KIND, ticket)) as
    | ConsentTicketRecord
    | undefined;
}

// Deletes a flow's decision once the flow has finished or been cancelled.
export async function destroyConsentDecision(
  dbAdapter: DBAdapter,
  interactionId: string,
): Promise<void> {
  await destroyObject(dbAdapter, CONSENT_DECISION_KIND, interactionId);
}
