import { createHash, createPrivateKey, sign } from 'node:crypto';
import { logger } from '@cardstack/runtime-common';
import {
  OutboundRefusedError,
  OutboundSendError,
  OutboundTimeoutError,
  describeOutboundError,
  outboundFetch,
  sendContext,
} from './client.ts';
import { CredentialScrubber } from './scrubber.ts';
import { scrubError } from './scrub-error.ts';

const log = logger('google-service-account');

// Google service-account keys. The owner holds a JSON key file; what reaches
// a Google API is a short-lived access token the platform mints from it. The
// platform signs a JWT with the key's private key and exchanges it at Google's
// token endpoint, then sends the access token it gets back in the slot the
// operation declared. The private key goes to the token endpoint, never to a
// vendor, and the token endpoint is called only by the platform.
//
// A token is kept in memory only, until shortly before Google says it expires,
// and is minted once per key however many calls want one at the same moment.

export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

// Google never issues a service-account token for longer than an hour, and
// the assertion asks for exactly that.
const ASSERTION_LIFETIME_SECONDS = 60 * 60;

// A token is minted again this long before it expires, so a call that takes
// it never sends one that expires on the way.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const MAX_SCOPES = 20;
const MAX_SCOPE_LENGTH = 200;
const MAX_SUBJECT_LENGTH = 320;

// What a `google-service-account` key holds, sealed as one value: the parts
// of the key file that minting uses, the subject it acts as (for domain-wide
// delegation) and the scopes it asks for.
export interface GoogleServiceAccountCredential {
  clientEmail: string;
  privateKeyId: string | null;
  privateKey: string;
  subject: string | null;
  scopes: string[];
}

// A key file, subject or scope list the owner can't use. The message names
// what is wrong and never quotes the file.
export class GoogleServiceAccountKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleServiceAccountKeyError';
  }
}

// Reads what the owner entered: the JSON key file Google issued, the subject
// to act as (optional) and the scopes. Only a service-account key file with
// an RSA private key is accepted. The file's own `token_uri` is not used: the
// token endpoint is the platform's to choose.
export function parseGoogleServiceAccountKey({
  keyFile,
  subject,
  scopes,
}: {
  keyFile: unknown;
  subject?: unknown;
  scopes: unknown;
}): GoogleServiceAccountCredential {
  if (typeof keyFile !== 'string' || keyFile.trim().length === 0) {
    throw new GoogleServiceAccountKeyError(
      'a service account key needs its JSON key file',
    );
  }
  let file: unknown;
  try {
    file = JSON.parse(keyFile);
  } catch {
    // The parser's message quotes the input, so it is never passed on.
    throw new GoogleServiceAccountKeyError(
      'the key file is not valid JSON: use the JSON key file Google issued for the service account',
    );
  }
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    throw new GoogleServiceAccountKeyError(
      'the key file is not a service account key file',
    );
  }
  let { type, client_email, private_key, private_key_id } = file as Record<
    string,
    unknown
  >;
  if (type !== 'service_account') {
    throw new GoogleServiceAccountKeyError(
      'the key file is not a service account key file: its "type" is not "service_account"',
    );
  }
  if (typeof client_email !== 'string' || !isEmailAddress(client_email)) {
    throw new GoogleServiceAccountKeyError(
      'the key file has no service account email ("client_email")',
    );
  }
  if (typeof private_key !== 'string' || private_key.length === 0) {
    throw new GoogleServiceAccountKeyError(
      'the key file has no private key ("private_key")',
    );
  }
  let keyType: string | undefined;
  try {
    keyType = createPrivateKey(private_key).asymmetricKeyType;
  } catch {
    keyType = undefined;
  }
  if (keyType !== 'rsa') {
    throw new GoogleServiceAccountKeyError(
      `the key file's private key is not an RSA private key in PEM form`,
    );
  }
  if (private_key_id !== undefined && typeof private_key_id !== 'string') {
    throw new GoogleServiceAccountKeyError(
      `the key file's "private_key_id" is not text`,
    );
  }
  return {
    clientEmail: client_email,
    privateKeyId: private_key_id || null,
    privateKey: private_key,
    subject: validSubject(subject),
    scopes: validScopes(scopes),
  };
}

// Whether `value` is a Google service account's JSON key file. Such a file
// mints tokens; sent as it is, it would hand the private key to the API, so
// it is only ever entered as a `google-service-account` key.
export function isGoogleServiceAccountKeyFile(value: string): boolean {
  if (!value.trimStart().startsWith('{')) {
    return false;
  }
  try {
    let parsed = JSON.parse(value);
    return Boolean(parsed) && parsed.type === 'service_account';
  } catch {
    return false;
  }
}

function validSubject(subject: unknown): string | null {
  if (subject === undefined || subject === null) {
    return null;
  }
  if (typeof subject !== 'string') {
    throw new GoogleServiceAccountKeyError(
      'the subject is the email address of the user to act as',
    );
  }
  let trimmed = subject.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_SUBJECT_LENGTH || !isEmailAddress(trimmed)) {
    throw new GoogleServiceAccountKeyError(
      'the subject is the email address of the user to act as',
    );
  }
  return trimmed;
}

function validScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new GoogleServiceAccountKeyError(
      'a service account key needs at least one scope',
    );
  }
  if (scopes.length > MAX_SCOPES) {
    throw new GoogleServiceAccountKeyError(
      `a service account key has at most ${MAX_SCOPES} scopes`,
    );
  }
  let valid: string[] = [];
  for (let scope of scopes) {
    if (
      typeof scope !== 'string' ||
      scope.length === 0 ||
      scope.length > MAX_SCOPE_LENGTH ||
      // A scope list is sent space-separated, so a scope can't hold a space,
      // and no scope holds a control character.
      // eslint-disable-next-line no-control-regex
      /[\s\u0000-\u001f\u007f]/.test(scope)
    ) {
      throw new GoogleServiceAccountKeyError(
        `each scope is one scope name or URL, at most ${MAX_SCOPE_LENGTH} characters, with no spaces`,
      );
    }
    if (!valid.includes(scope)) {
      valid.push(scope);
    }
  }
  return valid;
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// The value a `google-service-account` key seals. Its members are written in
// one order, so the same key always seals the same text.
export function serializeGoogleServiceAccount(
  credential: GoogleServiceAccountCredential,
): string {
  return JSON.stringify({
    clientEmail: credential.clientEmail,
    privateKeyId: credential.privateKeyId,
    privateKey: credential.privateKey,
    subject: credential.subject,
    scopes: credential.scopes,
  });
}

export function deserializeGoogleServiceAccount(
  value: string,
): GoogleServiceAccountCredential {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('a stored service account key is not valid JSON');
  }
  let { clientEmail, privateKeyId, privateKey, subject, scopes } = (parsed ??
    {}) as Record<string, unknown>;
  if (
    typeof clientEmail !== 'string' ||
    typeof privateKey !== 'string' ||
    !Array.isArray(scopes) ||
    !scopes.every((s) => typeof s === 'string')
  ) {
    throw new Error('a stored service account key is missing a part');
  }
  return {
    clientEmail,
    privateKeyId: typeof privateKeyId === 'string' ? privateKeyId : null,
    privateKey,
    subject: typeof subject === 'string' ? subject : null,
    scopes: scopes as string[],
  };
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

// The signed JWT Google exchanges for an access token (RFC 7523): issued by
// the service account, for the token endpoint, asking for the key's scopes,
// and acting as the subject when the key names one.
export function signGoogleAssertion(
  credential: GoogleServiceAccountCredential,
  { tokenEndpoint, now }: { tokenEndpoint: string; now: number },
): string {
  let issuedAt = Math.floor(now / 1000);
  let header = {
    alg: 'RS256',
    typ: 'JWT',
    ...(credential.privateKeyId ? { kid: credential.privateKeyId } : {}),
  };
  let claims = {
    iss: credential.clientEmail,
    ...(credential.subject ? { sub: credential.subject } : {}),
    scope: credential.scopes.join(' '),
    aud: tokenEndpoint,
    iat: issuedAt,
    exp: issuedAt + ASSERTION_LIFETIME_SECONDS,
  };
  let signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(claims),
  )}`;
  let signature = sign(
    'RSA-SHA256',
    Buffer.from(signingInput, 'utf8'),
    createPrivateKey(credential.privateKey),
  );
  return `${signingInput}.${base64url(signature)}`;
}

// Google refused the key: it is revoked or deleted, the account is disabled,
// the subject can't be acted as, or a scope isn't allowed. Minting again won't
// help until the owner replaces the key. `error` is Google's OAuth error code,
// never its description, which can quote the request.
export class GoogleServiceAccountRejectedError extends Error {
  readonly error: string;
  constructor(error: string) {
    super(`Google refused the service account key (${error})`);
    this.name = 'GoogleServiceAccountRejectedError';
    this.error = error;
  }
}

// Google's token endpoint couldn't be reached, or kept failing, through every
// retry. The key itself may be fine.
export class GoogleTokenEndpointUnavailableError extends Error {
  constructor(detail: string) {
    super(`Google's token endpoint is unavailable: ${detail}`);
    this.name = 'GoogleTokenEndpointUnavailableError';
  }
}

// The OAuth error codes that mean the key, its subject or its scopes won't be
// accepted. Anything else from a 4xx is treated the same way, since a request
// Google won't take now it won't take on a retry either; only these are named
// in the log as they are.
const REJECTED_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'access_denied',
  'invalid_scope',
]);

export interface GoogleTokenSettings {
  tokenEndpoint: string;
  // Waits before each retry of a failed exchange, in order; their count is
  // the number of retries.
  retryDelaysMs: number[];
  now: () => number;
}

const DEFAULT_SETTINGS: GoogleTokenSettings = {
  tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
  retryDelaysMs: [250, 1000],
  now: () => Date.now(),
};

let settings: GoogleTokenSettings = { ...DEFAULT_SETTINGS };

// Tests point minting at a stub token endpoint and shorten the retries.
export function configureGoogleTokens(
  overrides: Partial<GoogleTokenSettings>,
): void {
  settings = { ...settings, ...overrides };
  cache.clear();
}

export function resetGoogleTokens(): void {
  settings = { ...DEFAULT_SETTINGS };
  cache.clear();
  inflight.clear();
}

export function googleTokenEndpoint(): string {
  return settings.tokenEndpoint;
}

interface CachedToken {
  token: string;
  refreshAt: number;
}

const cache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

// A token is cached under the key and the exact credential it was minted from,
// so replacing a key's value never serves a token minted from the old one.
function cacheKey(keyId: string, credential: GoogleServiceAccountCredential) {
  return `${keyId}:${createHash('sha256')
    .update(serializeGoogleServiceAccount(credential))
    .digest('hex')}`;
}

// The access token for a service-account key: the cached one while it has
// more than a few minutes left, otherwise a new one. Concurrent callers for
// one key share one exchange. Throws `GoogleServiceAccountRejectedError` when
// Google refuses the key and `GoogleTokenEndpointUnavailableError` when the
// endpoint fails through every retry.
export async function googleAccessToken(
  keyId: string,
  credential: GoogleServiceAccountCredential,
): Promise<string> {
  let key = cacheKey(keyId, credential);
  let cached = cache.get(key);
  if (cached && cached.refreshAt > settings.now()) {
    return cached.token;
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = mint(credential).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  let minted = await pending;
  evictExpired();
  cache.set(key, minted);
  return minted.token;
}

function evictExpired() {
  let now = settings.now();
  for (let [key, entry] of cache) {
    if (entry.refreshAt <= now) {
      cache.delete(key);
    }
  }
}

async function mint(
  credential: GoogleServiceAccountCredential,
): Promise<CachedToken> {
  let attempt = 0;
  for (;;) {
    try {
      return await exchange(credential);
    } catch (error) {
      if (
        error instanceof GoogleServiceAccountRejectedError ||
        attempt >= settings.retryDelaysMs.length
      ) {
        throw error instanceof GoogleServiceAccountRejectedError ||
          error instanceof GoogleTokenEndpointUnavailableError
          ? error
          : new GoogleTokenEndpointUnavailableError(describe(error));
      }
      await new Promise((resolve) =>
        setTimeout(resolve, settings.retryDelaysMs[attempt]),
      );
      attempt++;
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof OutboundTimeoutError) {
    return 'it did not answer in time';
  }
  if (error instanceof OutboundRefusedError) {
    return `the outbound guard refused it (${error.reason})`;
  }
  if (error instanceof OutboundSendError) {
    return 'the connection failed';
  }
  return error instanceof Error ? error.message : String(error);
}

// One exchange of a freshly signed assertion for an access token. A 5xx, a
// 429, a `temporarily_unavailable` answer, a timeout or a broken connection
// is thrown as retryable; any other refusal is `GoogleServiceAccountRejectedError`.
async function exchange(
  credential: GoogleServiceAccountCredential,
): Promise<CachedToken> {
  let tokenEndpoint = settings.tokenEndpoint;
  let assertion = signGoogleAssertion(credential, {
    tokenEndpoint,
    now: settings.now(),
  });
  let scrubber = new CredentialScrubber();
  scrubber.register(pemBody(credential.privateKey));
  scrubber.register(assertion);
  let context = sendContext(undefined, tokenEndpoint);
  let sentAt = settings.now();
  let response: Response;
  let text: string;
  try {
    response = await outboundFetch({
      url: tokenEndpoint,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: JWT_BEARER_GRANT,
        assertion,
      }).toString(),
      sizePath: 'call-api',
      scrubber,
    });
    text = await response.text();
  } catch (error) {
    scrubError(error, scrubber);
    log.warn(
      `minting a service account token failed (${describeOutboundError(error, context)}): ${describe(error)}`,
    );
    throw error;
  }
  let body = parseJSON(text);
  if (response.ok) {
    let token = body?.access_token;
    let expiresIn = body?.expires_in;
    if (typeof token !== 'string' || token.length === 0) {
      throw new GoogleTokenEndpointUnavailableError(
        'its answer carried no access token',
      );
    }
    let lifetimeMs =
      (typeof expiresIn === 'number' && expiresIn > 0
        ? expiresIn
        : ASSERTION_LIFETIME_SECONDS) * 1000;
    // A token too short-lived for the usual margin is kept for half its life.
    let margin = Math.min(REFRESH_MARGIN_MS, lifetimeMs / 2);
    return { token, refreshAt: sentAt + lifetimeMs - margin };
  }
  let oauthError =
    typeof body?.error === 'string' ? (body.error as string) : undefined;
  if (
    response.status >= 500 ||
    response.status === 429 ||
    oauthError === 'temporarily_unavailable'
  ) {
    log.warn(
      `minting a service account token: the token endpoint answered ${response.status}${oauthError ? ` (${oauthError})` : ''}`,
    );
    throw new GoogleTokenEndpointUnavailableError(
      `it answered ${response.status}`,
    );
  }
  let code =
    oauthError && REJECTED_ERRORS.has(oauthError)
      ? oauthError
      : `status ${response.status}`;
  log.warn(
    `minting a service account token: Google refused the key for ${credential.clientEmail} (${code})`,
  );
  throw new GoogleServiceAccountRejectedError(code);
}

function parseJSON(text: string): Record<string, unknown> | undefined {
  try {
    let parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// The base64 body of a PEM key, without its armor lines or line breaks: the
// part an echo of the key would carry.
function pemBody(pem: string): string {
  return pem.replace(/-----(BEGIN|END)[^-]*-----/g, '').replace(/\s+/g, '');
}
