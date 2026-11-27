// The provider's short-lived objects, in `oauth_provider_objects`: the
// library's interactions, sessions, authorization codes and device codes (with
// a row for each device code's user code), the error references Boxel's error
// page reads (ADR 021 §1.8), each flow's consent decision and the ticket that
// finishes it (§1.7), and the network of the browser that finished a flow of a
// pre-registered app on the user's computer, kept for its code exchange
// (`network-binding.ts`).
//
// Each object's value is a bearer secret: an interaction's ID is in the
// browser's URL, a session's ID is its cookie, and an authorization code, an
// error reference and a ticket are values a browser carries too. A decision is
// stored under its flow's interaction ID, and a finish's network under the
// ID of the grant the flow created. A row is stored and found only
// by the SHA-256 of that value, and never holds the value itself (ADR 021
// §1.2). The library copies each object's value into its payload as `jti`,
// and an interaction's ID a second time in `returnTo`, the URL the flow
// resumes at. The adapters leave these out and rebuild them when they find
// the row. A payload that still holds the value anywhere else is refused,
// never stored.
//
// A row past its expiry reads as missing, whether or not it has been deleted.
// Each store first deletes rows that have expired, so abandoned flows and
// error pages nobody opened don't pile up, and the daily cleanup deletes any
// left while nothing is being stored (`cleanup.ts`).

import { createHash, randomBytes } from 'crypto';
import { errors, type Adapter, type AdapterPayload } from 'oidc-provider';
import type { DBAdapter } from '@cardstack/runtime-common';
import { logOAuthEvent, pseudonym } from './events.ts';
import { endGrant } from './grants.ts';
import type { CallerNetwork } from './network-binding.ts';

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

export function asRecord(stored: unknown): Record<string, unknown> {
  return (typeof stored === 'string' ? JSON.parse(stored) : stored) as Record<
    string,
    unknown
  >;
}

// The value as it appears inside a JSON string.
function jsonEscaped(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

// The part of the library's adapter interface it uses for few of Boxel's
// kinds: finding by user code (the library's own device pages, which are never
// served), by UID, consuming and revoking by grant. Each throws, naming the
// kind, unless a kind's adapter supplies it.
export abstract class OAuthProviderAdapter implements Adapter {
  readonly #kind: string;

  constructor(kind: string) {
    this.#kind = kind;
  }

  abstract upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void>;
  abstract find(id: string): Promise<AdapterPayload | undefined>;
  abstract destroy(id: string): Promise<void>;

  async findByUserCode(): Promise<never> {
    throw this.unused('findByUserCode');
  }

  async findByUid(): Promise<never> {
    throw this.unused('findByUid');
  }

  async consume(_id: string): Promise<void> {
    throw this.unused('consume');
  }

  async revokeByGrantId(_grantId: string): Promise<void> {
    throw this.unused('revokeByGrantId');
  }

  protected unused(method: string): OAuthProviderObjectError {
    return new OAuthProviderObjectError(
      `the OAuth provider's ${this.#kind} has no ${method}`,
    );
  }
}

// The library's adapter for a kind of object it stores, finds and deletes by
// the object's own value, which is a bearer secret. The value is the row's
// key, hashed, and the library's copy of it in the payload (`jti`) is left
// out and put back when the row is found. The library looks up nothing else
// for these kinds, so every other lookup throws.
class BearerKeyedAdapter extends OAuthProviderAdapter {
  #dbAdapter: DBAdapter;
  #kind: string;

  constructor(dbAdapter: DBAdapter, kind: string) {
    super(kind);
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
// flow (ADR 021 §1.7). The library looks one up by its `uid` (`findByUid`) in
// two places, and neither is reached:
// - checking a code or token tied to its session, and none is, since
//   `expiresWithSession` is false (`provider.ts`);
// - reading an interaction started under a signed-in session
//   (`interactionDetails`, `interactionFinished`), and none is, since both
//   routes that start an interaction, the authorization endpoint and the
//   resume route, drop the session cookie first.
// So `findByUid` throws, which a change that reaches either would show.
export class SessionAdapter extends BearerKeyedAdapter {
  constructor(dbAdapter: DBAdapter) {
    super(dbAdapter, 'Session');
  }
}

// The library's adapter for its authorization codes, stored by their values.
// A code is exchanged once. The library checks that a code is unused and then
// marks it used, so two exchanges at once could both pass its check: marking
// it used here is atomic, and the exchange that loses ends the grant as reuse,
// as presenting a used code does (ADR 021 §1.9). A code that expired in
// between is refused without ending its grant.
export class AuthorizationCodeAdapter extends BearerKeyedAdapter {
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    super(dbAdapter, 'AuthorizationCode');
    this.#dbAdapter = dbAdapter;
  }

  async consume(id: string): Promise<void> {
    let hash = sha256Hex(id);
    let marked = await this.#dbAdapter.execute(
      `UPDATE oauth_provider_objects
          SET payload = payload || jsonb_build_object(
                'consumed', floor(extract(epoch FROM now()))::bigint
              )
        WHERE kind = 'AuthorizationCode' AND id_hash = decode($1, 'hex')
          AND payload->'consumed' IS NULL AND expires_at > now()
        RETURNING 1`,
      { bind: [hash] },
    );
    if (marked.length > 0) {
      return;
    }
    let [row] = (await this.#dbAdapter.execute(
      `SELECT payload->>'grantId' AS grant_id FROM oauth_provider_objects
        WHERE kind = 'AuthorizationCode' AND id_hash = decode($1, 'hex')
          AND payload->'consumed' IS NOT NULL`,
      { bind: [hash] },
    )) as { grant_id: string | null }[];
    if (!row) {
      throw new errors.InvalidGrant('authorization code is expired');
    }
    if (row.grant_id) {
      logOAuthEvent(
        'info',
        {
          event: 'reuse',
          what: 'authorization code',
          grant: pseudonym(row.grant_id),
        },
        'authorization code reused',
      );
      await endGrant(this.#dbAdapter, row.grant_id, 'reuse');
    }
    throw new errors.InvalidGrant('authorization code already consumed');
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.#dbAdapter.execute(
      `DELETE FROM oauth_provider_objects
        WHERE kind = 'AuthorizationCode' AND payload->>'grantId' = $1`,
      { bind: [grantId] },
    );
  }
}

const DEVICE_CODE_KIND = 'DeviceCode';
const DEVICE_USER_CODE_KIND = 'DeviceUserCode';

// How much longer a user code is remembered than its device code lasts, so the
// `device` page can tell someone who typed it late that it expired, rather
// than that it was never issued.
const EXPIRED_USER_CODE_REMEMBERED_SECONDS = 10 * 60;

// What a user code's row holds: which device code it names, by that code's
// row key, and when that code expires. Never the device code itself.
interface DeviceUserCodeRecord {
  deviceCode: string;
  expiresAt: number;
}

// The user code as the library stores it: upper case, with nothing but
// letters and digits (the library's `normalize`).
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/\W/g, '');
}

// The library's adapter for its device codes (RFC 8628), stored by their
// values, which the app polls the token endpoint with. Each also carries the
// user code the user types into the secure origin's `device` page. That is a
// bearer value too: whoever enters it decides the device code. It is never
// stored in the device code's row. A row of its own, keyed by the user code's
// hash, names the device code's row. The device code's `deviceInfo` (the app's
// address and user agent, by default) is never stored either: nothing reads
// it.
//
// Boxel decides a device code itself, from its own routes (`device.ts`), by
// writing the outcome into the row (`decideDeviceCode`): the library's own
// pages for entering and confirming a code are never served. The token
// endpoint then finds the outcome, as its own resume would have written it.
//
// A device code is exchanged once. Marking it used is atomic, and a second
// exchange of a code that was decided ends its grant as reuse, as an
// authorization code's does (ADR 021 §1.9).
export class DeviceCodeAdapter extends BearerKeyedAdapter {
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    super(dbAdapter, DEVICE_CODE_KIND);
    this.#dbAdapter = dbAdapter;
  }

  protected stored(payload: AdapterPayload): Record<string, unknown> {
    let {
      userCode: _userCode,
      deviceInfo: _deviceInfo,
      ...rest
    } = super.stored(payload);
    return rest;
  }

  // The user code's row is stored first, and only if no current row has
  // that user code: two live device codes can't share one, since entering it
  // would decide whichever it named. The library makes a code from 20^8, so a
  // clash among codes alive at once is vanishingly rare, and refused when it
  // happens: the app asks for another.
  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn: number,
  ): Promise<void> {
    let userCode = payload.userCode;
    if (typeof userCode === 'string') {
      let record: DeviceUserCodeRecord = {
        deviceCode: sha256Hex(id),
        expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      };
      let stored = await prepareStore(
        this.#dbAdapter,
        DEVICE_USER_CODE_KIND,
        userCode,
        { ...record },
      );
      let rows = await this.#dbAdapter.execute(
        `INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
           VALUES ($1, decode($2, 'hex'), $3::jsonb, now() + make_interval(secs => $4))
           ON CONFLICT (kind, id_hash) DO UPDATE
             SET payload = EXCLUDED.payload, expires_at = EXCLUDED.expires_at
             WHERE oauth_provider_objects.payload->>'deviceCode' = EXCLUDED.payload->>'deviceCode'
                OR oauth_provider_objects.expires_at <= now()
           RETURNING 1`,
        {
          bind: [
            DEVICE_USER_CODE_KIND,
            sha256Hex(normalizeUserCode(userCode)),
            stored,
            expiresIn + EXPIRED_USER_CODE_REMEMBERED_SECONDS,
          ],
        },
      );
      if (rows.length === 0) {
        throw new OAuthProviderObjectError(
          `the OAuth provider's DeviceCode has a user code another live code has`,
        );
      }
    }
    await super.upsert(id, payload, expiresIn);
  }

  // Found past its expiry too, until it is deleted: the library checks a
  // device code's expiry itself, and answers a poll for an expired one
  // `expired_token`, which tells the app to start over (RFC 8628 §3.5).
  async find(id: string): Promise<AdapterPayload | undefined> {
    let [row] = (await this.#dbAdapter.execute(
      `SELECT payload FROM oauth_provider_objects
         WHERE kind = $1 AND id_hash = decode($2, 'hex')`,
      { bind: [DEVICE_CODE_KIND, sha256Hex(id)] },
    )) as { payload: unknown }[];
    return row
      ? ({ ...asRecord(row.payload), jti: id } as AdapterPayload)
      : undefined;
  }

  async consume(id: string): Promise<void> {
    let hash = sha256Hex(id);
    let marked = await this.#dbAdapter.execute(
      `UPDATE oauth_provider_objects
          SET payload = payload || jsonb_build_object(
                'consumed', floor(extract(epoch FROM now()))::bigint
              )
        WHERE kind = $1 AND id_hash = decode($2, 'hex')
          AND payload->'consumed' IS NULL AND expires_at > now()
        RETURNING 1`,
      { bind: [DEVICE_CODE_KIND, hash] },
    );
    if (marked.length > 0) {
      return;
    }
    let [row] = (await this.#dbAdapter.execute(
      `SELECT payload->>'grantId' AS grant_id FROM oauth_provider_objects
        WHERE kind = $1 AND id_hash = decode($2, 'hex')
          AND payload->'consumed' IS NOT NULL`,
      { bind: [DEVICE_CODE_KIND, hash] },
    )) as { grant_id: string | null }[];
    if (!row) {
      throw new errors.ExpiredToken('device code is expired');
    }
    if (row.grant_id) {
      log.info('device code reused');
      await endGrant(this.#dbAdapter, row.grant_id, 'reuse');
    }
    throw new errors.InvalidGrant('device code already consumed');
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.#dbAdapter.execute(
      `DELETE FROM oauth_provider_objects
        WHERE kind = $1 AND payload->>'grantId' = $2`,
      { bind: [DEVICE_CODE_KIND, grantId] },
    );
  }
}

// A device code as the `device` page's routes see it, found by its user
// code. `key` is the device code's row key (its hash), never the code.
export type DeviceCodeLookup =
  | {
      state: 'pending';
      key: string;
      clientId: string;
      params: Record<string, unknown>;
      // Seconds until the device code expires.
      remainingSeconds: number;
    }
  // Allowed, denied or exchanged already.
  | { state: 'decided' }
  | { state: 'expired' }
  | { state: 'unknown' };

export async function findDeviceCodeByUserCode(
  dbAdapter: DBAdapter,
  userCode: string,
): Promise<DeviceCodeLookup> {
  let normalized = normalizeUserCode(userCode);
  if (normalized === '') {
    return { state: 'unknown' };
  }
  let [row] = (await dbAdapter.execute(
    `SELECT u.payload AS user_code,
            d.payload AS device_code,
            floor(extract(epoch FROM d.expires_at - now()))::bigint AS remaining
       FROM oauth_provider_objects AS u
       LEFT JOIN oauth_provider_objects AS d
         ON d.kind = $3
        AND d.id_hash = decode(u.payload->>'deviceCode', 'hex')
      WHERE u.kind = $1 AND u.id_hash = decode($2, 'hex')
        AND u.expires_at > now()`,
    {
      bind: [DEVICE_USER_CODE_KIND, sha256Hex(normalized), DEVICE_CODE_KIND],
    },
  )) as {
    user_code: unknown;
    device_code: unknown;
    remaining: number | string | null;
  }[];
  if (!row) {
    return { state: 'unknown' };
  }
  let named = asRecord(row.user_code) as unknown as DeviceUserCodeRecord;
  // A device code that is gone was deleted after it expired, or with its
  // grant when that ended.
  if (row.device_code === null || row.device_code === undefined) {
    return named.expiresAt <= Math.floor(Date.now() / 1000)
      ? { state: 'expired' }
      : { state: 'decided' };
  }
  if (Number(row.remaining) <= 0) {
    return { state: 'expired' };
  }
  let payload = asRecord(row.device_code);
  if (
    payload.accountId !== undefined ||
    payload.error !== undefined ||
    payload.consumed !== undefined ||
    typeof payload.clientId !== 'string' ||
    !isRecord(payload.params)
  ) {
    return { state: 'decided' };
  }
  return {
    state: 'pending',
    key: named.deviceCode,
    clientId: payload.clientId,
    params: payload.params,
    remainingSeconds: Number(row.remaining),
  };
}

// What deciding a device code writes into it, as the library's own device
// resume would: the user and grant it was allowed for, or the error a denial
// sends the app.
export type DeviceCodeOutcome =
  | {
      accountId: string;
      grantId: string;
      authTime: number;
      scope: string;
      resource: string;
    }
  | { error: 'access_denied'; errorDescription: string };

// Writes a device code's outcome, only while nobody has decided it and it
// hasn't expired. Answers whether it was written.
export async function decideDeviceCode(
  dbAdapter: DBAdapter,
  key: string,
  outcome: DeviceCodeOutcome,
): Promise<boolean> {
  let rows = await dbAdapter.execute(
    `UPDATE oauth_provider_objects
        SET payload = payload || $3::jsonb
      WHERE kind = $1 AND id_hash = decode($2, 'hex')
        AND expires_at > now()
        AND payload->'accountId' IS NULL
        AND payload->'error' IS NULL
        AND payload->'consumed' IS NULL
      RETURNING 1`,
    { bind: [DEVICE_CODE_KIND, key, JSON.stringify(outcome)] },
  );
  return rows.length > 0;
}

// What the token endpoint's limits need to know about a device code a poll
// names (`token-limit.ts`): its client, and its grant once it was allowed.
export async function deviceCodeForPoll(
  dbAdapter: DBAdapter,
  deviceCode: string,
): Promise<
  | {
      key: string;
      clientId: string | null;
      grantId: string | null;
      consumed: boolean;
    }
  | undefined
> {
  let key = sha256Hex(deviceCode);
  let [row] = (await dbAdapter.execute(
    `SELECT payload->>'clientId' AS client_id,
            payload->>'grantId' AS grant_id,
            payload->'consumed' IS NOT NULL AS consumed
       FROM oauth_provider_objects
      WHERE kind = $1 AND id_hash = decode($2, 'hex') AND expires_at > now()`,
    { bind: [DEVICE_CODE_KIND, key] },
  )) as {
    client_id: string | null;
    grant_id: string | null;
    consumed: boolean;
  }[];
  return row
    ? {
        key,
        clientId: row.client_id,
        grantId: row.grant_id,
        consumed: row.consumed,
      }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Why an authorization request didn't reach consent, or why Boxel ended a
// flow at consent. Each is a fixed label for telemetry, and tells the error
// page which of its states to show. The secure origin's
// `security/oauth-error-states.js` gives each one a state.
export const AUTHORIZATION_REFUSAL_REASONS = Object.freeze([
  // The library's own refusals, before Boxel could check the client.
  'unknown-client',
  'bad-redirect-uri',
  'library',
  // Boxel's checks before the library (`checkAuthorizationRequest`).
  'unsupported-response-type',
  'unsupported-parameter',
  'pkce-required',
  'prompt-none',
  'malformed',
  'unknown-resource',
  'no-resource-for-scopes',
  'client-not-allowed',
  'confirmation-code',
  'unknown-scope',
  'unregistered-scope',
  'missing-scope',
  'openid',
  // The consent route, for a flow it ended because the authorize page's
  // answer couldn't be read (`consent.ts`).
  'unreadable-decision',
] as const);

export type AuthorizationRefusalReason =
  (typeof AUTHORIZATION_REFUSAL_REASONS)[number];

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
  let reference = newErrorReference();
  await storeObject(
    dbAdapter,
    ERROR_REFERENCE_KIND,
    reference,
    { ...record },
    ERROR_REFERENCE_TTL_SECONDS,
  );
  return reference;
}

function newErrorReference(): string {
  return randomBytes(32).toString('base64url');
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
// flow once, in the browser that started it. One statement writes both rows,
// so a ticket that can't be stored leaves the flow undecided.
//
// A flow is decided once. Answers undefined when the flow already has a
// different decision, or one another user made. The same decision sent again
// is answered with a new ticket, so a page whose answer was recorded but
// whose reply never reached it can send it again and still finish the flow.
// Each ticket finishes the flow only with its decision, which the first one
// presented spends, so a flow still finishes at most once.
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
    `WITH recorded AS (
       INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
         VALUES ($1, decode($2, 'hex'), $3::jsonb, now() + make_interval(secs => $4))
         ON CONFLICT (kind, id_hash) DO NOTHING
         RETURNING kind
     ),
     decision AS (
       SELECT kind FROM recorded
       UNION ALL
       SELECT kind FROM oauth_provider_objects
         WHERE kind = $1 AND id_hash = decode($2, 'hex')
           AND payload = $3::jsonb AND expires_at > now()
     )
     INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
       SELECT $5, decode($6, 'hex'), $7::jsonb, now() + make_interval(secs => $8)
         FROM decision
         LIMIT 1
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

// What a flow's decision row holds once the flow can't be decided again:
// `finished` once the finish route took its decision, `cancelled` once the
// flow was cancelled, and `ended` once Boxel ended it undecided
// (`endUndecidedFlow`). The row stays until the flow's interaction would
// expire, so a decision, a cancel and an end of the same flow exclude each
// other: `decideFlow` never matches a closed row, and `endUndecidedFlow`
// never claims one.
interface ClosedFlowRecord {
  closed: 'finished' | 'cancelled' | 'ended';
}

function closedFlow(how: ClosedFlowRecord['closed']): ClosedFlowRecord {
  return { closed: how };
}

// A flow's decision, while it is there to take. A closed flow has none.
export async function findConsentDecision(
  dbAdapter: DBAdapter,
  interactionId: string,
): Promise<ConsentDecisionRecord | undefined> {
  let payload = await findObject(
    dbAdapter,
    CONSENT_DECISION_KIND,
    interactionId,
  );
  return payload && payload.closed === undefined
    ? (payload as unknown as ConsentDecisionRecord)
    : undefined;
}

// Whether a flow can't be decided any more: it has a decision, or is closed.
export async function isFlowDecided(
  dbAdapter: DBAdapter,
  interactionId: string,
): Promise<boolean> {
  return (
    (await findObject(dbAdapter, CONSENT_DECISION_KIND, interactionId)) !==
    undefined
  );
}

// Takes a flow's decision, closing its row as `finished` in the same
// statement, so only one request can finish the flow with it. `decidedAt` is
// when the decision was first stored, which a second decision never moves. A
// closed flow has no decision to take.
export async function takeConsentDecision(
  dbAdapter: DBAdapter,
  interactionId: string,
): Promise<(ConsentDecisionRecord & { decidedAt: Date }) | undefined> {
  let [row] = (await dbAdapter.execute(
    `WITH open AS (
       SELECT id_hash, payload, created_at FROM oauth_provider_objects
         WHERE kind = $1 AND id_hash = decode($2, 'hex')
           AND expires_at > now() AND payload->'closed' IS NULL
         FOR UPDATE
     )
     UPDATE oauth_provider_objects AS decision
        SET payload = $3::jsonb
       FROM open
      WHERE decision.kind = $1 AND decision.id_hash = open.id_hash
      RETURNING open.payload, open.created_at`,
    {
      bind: [
        CONSENT_DECISION_KIND,
        sha256Hex(interactionId),
        JSON.stringify(closedFlow('finished')),
      ],
    },
  )) as { payload: unknown; created_at: string | Date }[];
  if (!row) {
    return undefined;
  }
  return {
    ...(asRecord(row.payload) as unknown as ConsentDecisionRecord),
    decidedAt: new Date(row.created_at),
  };
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

// Deletes every ticket presented, in one statement, and answers those that
// were current, in no particular order.
export async function takeConsentTickets(
  dbAdapter: DBAdapter,
  tickets: readonly string[],
): Promise<ConsentTicketRecord[]> {
  if (tickets.length === 0) {
    return [];
  }
  let rows = (await dbAdapter.execute(
    `DELETE FROM oauth_provider_objects
       WHERE kind = $1
         AND id_hash IN (SELECT decode(hash, 'hex') FROM unnest($2::text[]) AS hash)
       RETURNING payload, expires_at > now() AS current`,
    { bind: [CONSENT_TICKET_KIND, tickets.map(sha256Hex)] },
  )) as { payload: unknown; current: boolean }[];
  return rows
    .filter(({ current }) => current)
    .map(({ payload }) => asRecord(payload) as unknown as ConsentTicketRecord);
}

// Closes a flow as cancelled, replacing any decision it has, for as long as
// its interaction could last.
export async function cancelConsentDecision(
  dbAdapter: DBAdapter,
  interactionId: string,
  expiresIn: number,
): Promise<void> {
  await storeObject(
    dbAdapter,
    CONSENT_DECISION_KIND,
    interactionId,
    { ...closedFlow('cancelled') },
    expiresIn,
  );
}

// Ends a flow nobody has decided, so it can never finish, and stores the
// error the authorize page shows for it, in one statement:
// - claims the flow's decision row as `ended`, so no decision can be recorded
//   after it;
// - deletes the flow's interaction, so neither the finish route nor the
//   library's resume can carry it on;
// - stores the error, answering its reference.
// Answers undefined, and changes nothing, when the flow already has a
// decision row: a decision the window that made it may still be finishing,
// or a flow already finished or cancelled.
export async function endUndecidedFlow(
  dbAdapter: DBAdapter,
  interactionId: string,
  expiresIn: number,
  error: AuthorizationErrorRecord,
): Promise<string | undefined> {
  let reference = newErrorReference();
  let decision = await prepareStore(
    dbAdapter,
    CONSENT_DECISION_KIND,
    interactionId,
    { ...closedFlow('ended') },
  );
  let stored = await prepareStore(dbAdapter, ERROR_REFERENCE_KIND, reference, {
    ...error,
  });
  let rows = await dbAdapter.execute(
    `WITH claimed AS (
       INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
         VALUES ($1, decode($2, 'hex'), $3::jsonb, now() + make_interval(secs => $4))
         ON CONFLICT (kind, id_hash) DO NOTHING
         RETURNING kind
     ),
     ended AS (
       DELETE FROM oauth_provider_objects
         WHERE kind = 'Interaction' AND id_hash = decode($2, 'hex')
           AND EXISTS (SELECT 1 FROM claimed)
     )
     INSERT INTO oauth_provider_objects (kind, id_hash, payload, expires_at)
       SELECT $5, decode($6, 'hex'), $7::jsonb, now() + make_interval(secs => $8)
         FROM claimed
       RETURNING kind`,
    {
      bind: [
        CONSENT_DECISION_KIND,
        sha256Hex(interactionId),
        decision,
        expiresIn,
        ERROR_REFERENCE_KIND,
        sha256Hex(reference),
        stored,
        ERROR_REFERENCE_TTL_SECONDS,
      ],
    },
  );
  return rows.length > 0 ? reference : undefined;
}

const FINISH_NETWORK_KIND = 'FinishNetwork';

// How long the network of the browser that finished a flow is kept: long
// enough for the browser to follow the library's resume and for the app to
// exchange the code it got there, which lasts 60 seconds.
export const FINISH_NETWORK_TTL_SECONDS = 2 * 60;

// Records the network of the browser that finished a flow, under the grant
// the flow created, for the code exchange to compare its own with
// (`network-binding.ts`). Stored, as every object here is, by the SHA-256 of
// the value it is found by.
export async function recordFinishNetwork(
  dbAdapter: DBAdapter,
  grantId: string,
  network: CallerNetwork,
): Promise<void> {
  await storeObject(
    dbAdapter,
    FINISH_NETWORK_KIND,
    grantId,
    { family: network.family, network: network.network },
    FINISH_NETWORK_TTL_SECONDS,
  );
}

// The network the flow that created a grant finished from. It is read, not
// taken: Boxel's check of a token request comes before the library's, which
// may still refuse the exchange without spending the code, and the exchange
// that follows must find the record as the first did. It goes when it
// expires.
export async function findFinishNetwork(
  dbAdapter: DBAdapter,
  grantId: string,
): Promise<CallerNetwork | undefined> {
  let payload = await findObject(dbAdapter, FINISH_NETWORK_KIND, grantId);
  if (
    !payload ||
    (payload.family !== 4 && payload.family !== 6) ||
    typeof payload.network !== 'string'
  ) {
    return undefined;
  }
  return { family: payload.family, network: payload.network };
}
