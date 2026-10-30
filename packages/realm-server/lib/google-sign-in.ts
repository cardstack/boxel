import { logger } from '@cardstack/runtime-common';
import type { GoogleIdentity } from './google-account.ts';

// Google sign-in for the secure window, run by the realm server as its own
// OpenID Connect client. It uses the Google client the Matrix server's single
// sign-on used, so a user who signed in to Boxel with Google there sees no new
// consent. It finds the user's account by the Google account's subject
// (`sub`), the account's external id under `oidc-google` in the Matrix
// server, and otherwise by the rules in `google-account.ts`.
//
// What makes this a credential card code can't reach: Google sends the
// authorization code only to the redirect URI registered for the client — the
// secure origin's callback — and only this server, which holds the client
// secret, can exchange it. The window binds each sign-in to a PKCE verifier
// and a nonce kept in the secure origin's storage.

const log = logger('realm:secure-session');

export interface GoogleSignInConfig {
  clientId: string;
  clientSecret: string;
  // The OpenID Connect issuer: `https://accounts.google.com` unless a test
  // points it at a stand-in.
  issuer: string;
  // The Matrix server's name for the provider, which keys the accounts linked
  // to a Google identity.
  synapseIdpId?: string;
}

export const DEFAULT_GOOGLE_ISSUER = 'https://accounts.google.com';
const DEFAULT_SYNAPSE_IDP_ID = 'oidc-google';

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer: string;
}

const discoveries = new Map<string, Promise<Discovery>>();

// The provider's endpoints, fetched once per process.
export async function discover(config: GoogleSignInConfig): Promise<Discovery> {
  let issuer = config.issuer.replace(/\/+$/, '');
  let cached = discoveries.get(issuer);
  if (!cached) {
    cached = (async () => {
      let response = await fetch(`${issuer}/.well-known/openid-configuration`);
      if (!response.ok) {
        throw new Error(`OpenID discovery failed: HTTP ${response.status}`);
      }
      return (await response.json()) as Discovery;
    })();
    discoveries.set(issuer, cached);
    cached.catch(() => discoveries.delete(issuer));
  }
  return await cached;
}

export class GoogleSignInError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Google sometimes writes its issuer without the scheme.
function issuerMatches(
  iss: unknown,
  config: GoogleSignInConfig,
  discovered: Discovery,
) {
  if (typeof iss !== 'string') {
    return false;
  }
  let expected = [config.issuer, discovered.issuer].map((value) =>
    value.replace(/\/+$/, ''),
  );
  if (new URL(config.issuer).hostname === 'accounts.google.com') {
    expected.push('accounts.google.com');
  }
  return expected.includes(iss.replace(/\/+$/, ''));
}

function decodePayload(jwt: string): Record<string, unknown> {
  let [, payload] = jwt.split('.');
  if (!payload) {
    throw new GoogleSignInError('not-confirmed', 'Google sent no identity');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

// Exchanges an authorization code for the Google account it signs in, and
// returns that account's identity: its subject, email address and name. The
// ID token comes straight from the token
// endpoint over TLS in answer to this server's own authenticated request, so
// its claims are checked rather than its signature (OpenID Connect Core
// §3.1.3.7); the nonce ties it to the sign-in the window started.
export async function exchangeGoogleCode(
  config: GoogleSignInConfig,
  {
    code,
    codeVerifier,
    nonce,
    redirectURI,
  }: { code: string; codeVerifier: string; nonce: string; redirectURI: string },
): Promise<GoogleIdentity> {
  let discovered = await discover(config);
  let response = await fetch(discovered.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectURI,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier,
    }).toString(),
  });
  if (!response.ok) {
    // An expired, used or mismatched code; Google's answer names nothing
    // worth logging beyond its status.
    log.warn(`Google code exchange failed: HTTP ${response.status}`);
    throw new GoogleSignInError(
      'not-confirmed',
      'Google sign-in could not be confirmed; try again',
    );
  }
  let { id_token } = (await response.json()) as { id_token?: string };
  if (typeof id_token !== 'string') {
    throw new GoogleSignInError('not-confirmed', 'Google sent no identity');
  }
  let claims = decodePayload(id_token);
  let audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    !issuerMatches(claims.iss, config, discovered) ||
    !audience.includes(config.clientId) ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 <= Date.now() ||
    claims.nonce !== nonce ||
    typeof claims.sub !== 'string' ||
    !claims.sub
  ) {
    throw new GoogleSignInError(
      'not-confirmed',
      'Google sign-in could not be confirmed; try again',
    );
  }
  return {
    sub: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    emailVerified:
      typeof claims.email_verified === 'boolean'
        ? claims.email_verified
        : undefined,
    name: typeof claims.name === 'string' ? claims.name : undefined,
  };
}

export function synapseIdpId(config: GoogleSignInConfig): string {
  return config.synapseIdpId ?? DEFAULT_SYNAPSE_IDP_ID;
}
