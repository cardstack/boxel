// Which state the authorize page's error page shows, for each reason the
// realm server gives a refused or ended authorization request (its
// `AUTHORIZATION_REFUSAL_REASONS`). The page picks its state by the reason,
// never by the OAuth error code, which doesn't tell the states apart:
// `invalid_target` is both a resource Boxel doesn't have and one the app may
// not use. This module is plain values, so the realm server's tests check
// that every reason it can give has a state here.

export const ERROR_STATE_BY_REASON = Object.freeze({
  'unknown-client': 'invalid-client',
  'bad-redirect-uri': 'bad-redirect',
  library: 'cant-continue',
  'unsupported-response-type': 'unsupported',
  'unsupported-parameter': 'unsupported',
  'pkce-required': 'unsupported',
  'prompt-none': 'unsupported',
  malformed: 'unsupported',
  'unknown-resource': 'not-offered',
  'no-resource-for-scopes': 'not-offered',
  'client-not-allowed': 'not-allowed',
  'confirmation-code': 'unsupported',
  'unknown-scope': 'not-offered',
  'unregistered-scope': 'unsupported',
  'missing-scope': 'not-offered',
  openid: 'not-offered',
  'unreadable-decision': 'cant-continue',
});

// The state for a reason this build doesn't know, from a newer server.
export const UNKNOWN_REASON_STATE = 'cant-continue';

// The `error` values the realm server sends the browser with that need no
// lookup: a request over the rate limit, which stores nothing, and a
// reference that is spent, expired or was never issued.
export const FIXED_ERRORS = Object.freeze({
  expired: 'expired',
  rate_limited: 'rate-limited',
});

// An error reference as the realm server issues one: 32 random bytes in
// base64url. Only a value of this shape is ever looked up, so nothing else
// from the address reaches a request path or a link.
export const ERROR_REFERENCE = /^[A-Za-z0-9_-]{43}$/;
