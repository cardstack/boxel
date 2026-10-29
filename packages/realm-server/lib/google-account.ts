// How a Google identity with no account linked to its subject resolves to a
// Matrix account, in the realm server's Google sign-in on the secure origin.
// The rules are the ones the accounts already linked to Google were made by,
// so a Google account always lands in the same Matrix account: link by
// verified email, refuse an email more than one account holds, and otherwise
// make an account whose localpart comes from the email.
//
// `tests/google-sign-in-vectors.json` holds the cases.

// The identity Google's ID token describes.
export interface GoogleIdentity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
}

// The refusals, in the words the app's sign-in shows: the mapping provider's
// messages, which Synapse shows on its error page.
export const GOOGLE_REFUSALS = {
  unverifiedEmail: 'Google sign-in requires a verified email address.',
  ambiguousEmail:
    'Multiple Matrix accounts already use this email address; please contact support to resolve before signing in with Google.',
} as const;

export class GoogleAccountRefusal extends Error {
  readonly code: 'unverified-email' | 'ambiguous-email';
  constructor(code: GoogleAccountRefusal['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export type GoogleAccountResolution =
  // The one account that holds the verified email: the Google identity is
  // linked to it.
  | { kind: 'existing'; user: string; email: string; displayName?: string }
  // No account holds the email: a new one is made with this localpart, or the
  // first free one after it (see `localpartCandidates`).
  | { kind: 'new'; localpart: string; email: string; displayName?: string };

export interface GoogleAccountLookups {
  // The Matrix ids of the accounts holding the email address as a third-party
  // id, compared without case.
  usersByEmail(email: string): Promise<string[]>;
  // Whether an account already has the localpart. Synapse's registration and
  // `check_user_exists` compare without case; a lookup that can only match
  // exactly (the secure origin's admin GET) must also count a localpart the
  // create refused, so the next resolve moves past it.
  localpartTaken(localpart: string): Promise<boolean>;
}

// Characters Matrix forbids in a user id's localpart. An email address's
// local part allows plenty Matrix doesn't (`'`, `!`, `#`…). Matched by code
// point, as Python's `re` does, so a character outside the Basic Multilingual
// Plane becomes one `-`, not two.
const DISALLOWED_LOCALPART_CHARS = /[^a-z0-9._=\-/+]/gu;

// Synapse's registration refuses an all-digit localpart, which it reserves for
// guest users.
const ALL_DIGITS = /^[0-9]+$/;

// The localpart a new account takes from its email address: the address's
// local part, lowercased, with each character Matrix forbids replaced by `-`.
// Leading `-`s and `_`s go (Synapse reserves a leading `_` for application
// services), as do trailing `-`s; an all-digit result is prefixed with
// `user-`, and `user` stands in when nothing is left.
export function localpartFromEmail(email: string): string {
  let local = email.trim().toLowerCase().split('@', 1)[0];
  let sanitized = local
    .replace(DISALLOWED_LOCALPART_CHARS, '-')
    .replace(/^[_-]+|-+$/g, '');
  if (!sanitized) {
    return 'user';
  }
  return ALL_DIGITS.test(sanitized) ? `user-${sanitized}` : sanitized;
}

// The localparts a new account tries in order: the base, then `base1`,
// `base2`… An account whose localpart is taken is never linked to the Google
// identity; only an account holding the verified email is.
export function* localpartCandidates(base: string): Generator<string> {
  yield base;
  for (let suffix = 1; ; suffix++) {
    yield `${base}${suffix}`;
  }
}

// The verified email address Google vouches for, lowercased. Linking by email
// rests entirely on it, so an unverified address refuses the sign-in.
export function verifiedEmail(identity: GoogleIdentity): string {
  if (!identity.email || identity.emailVerified !== true) {
    throw new GoogleAccountRefusal(
      'unverified-email',
      GOOGLE_REFUSALS.unverifiedEmail,
    );
  }
  return identity.email.trim().toLowerCase();
}

// Resolves a Google identity that no account is linked to yet. More than one
// account holding the email refuses the sign-in, since picking one would hand
// the Google account to whichever was picked.
export async function resolveGoogleAccount(
  identity: GoogleIdentity,
  lookups: GoogleAccountLookups,
): Promise<GoogleAccountResolution> {
  let email = verifiedEmail(identity);
  let displayName = identity.name || undefined;
  let users = [...new Set(await lookups.usersByEmail(email))];
  if (users.length > 1) {
    throw new GoogleAccountRefusal(
      'ambiguous-email',
      GOOGLE_REFUSALS.ambiguousEmail,
    );
  }
  if (users.length === 1) {
    return { kind: 'existing', user: users[0], email, displayName };
  }
  for (let localpart of localpartCandidates(localpartFromEmail(email))) {
    if (!(await lookups.localpartTaken(localpart))) {
      return { kind: 'new', localpart, email, displayName };
    }
  }
  throw new Error('unreachable: the localpart candidates never end');
}
