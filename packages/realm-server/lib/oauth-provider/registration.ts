// Dynamic client registration (RFC 7591), checked by Boxel before the library
// sees it (ADR 021 §1.4). Boxel counts the attempt against the new-client
// limit, reads the request, refuses what its rules don't allow, and hands the
// library a registration rewritten to hold only what Boxel allows. The library
// then validates and stores the client as usual.

import type Koa from 'koa';
import {
  CLIENT_IP_HEADER,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import {
  NewClientAlert,
  takeNewClient,
  type NewClientLimit,
} from './new-client-limit.ts';
import {
  applicationTypeFor,
  redirectURIsRefusal,
  type BoxelHosts,
} from './redirect-uris.ts';

// A registration is a few hundred bytes. Every stored client counts against
// the overall new-client limit, which is sized from what storing them costs,
// so each one is kept small.
const MAX_BODY_BYTES = 8 * 1024;

// A client registers the redirect URIs it uses, which is a handful at most.
const MAX_REDIRECT_URIS = 10;

// A client's name is kept as text a page can show as it is: short, on one
// line, and without control or formatting characters, which can make one name
// display as another (a right-to-left override, say) or hide characters in it.
const MAX_NAME_LENGTH = 256;
const UNSHOWABLE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

const MAX_SCOPE_LENGTH = 1024;

// The fields a registration may set. Anything else is dropped: `logo_uri` and
// `client_uri`, since consent never shows a client's logo or website, every
// field that would make the library fetch a URL (`jwks_uri`,
// `sector_identifier_uri`, `request_uris`) or sign or encrypt anything, and
// fields the library doesn't store, such as `software_id`.
// `application_type` and `token_endpoint_auth_method` are Boxel's to set.
const ALLOWED_FIELDS = [
  'redirect_uris',
  'client_name',
  'grant_types',
  'response_types',
  'scope',
] as const;

export type RegistrationCheck =
  | { allowed: true; registration: Record<string, unknown> }
  | {
      allowed: false;
      error: 'invalid_redirect_uri' | 'invalid_client_metadata';
      description: string;
    };

// The registration Boxel hands the library, or why it is refused. `scopes`
// are the scopes the provider offers: a registration may name others, as
// clients often name `openid`, and they are dropped rather than refused.
export function checkRegistration(
  body: unknown,
  { hosts, scopes }: { hosts: BoxelHosts; scopes: readonly string[] },
): RegistrationCheck {
  if (!isRecord(body)) {
    return refuse(
      'invalid_client_metadata',
      'a registration must be a JSON object',
    );
  }
  if ('client_secret' in body || 'client_secret_expires_at' in body) {
    return refuse(
      'invalid_client_metadata',
      'this provider issues no client secrets',
    );
  }
  let authMethod = body.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== 'none') {
    return refuse(
      'invalid_client_metadata',
      'token_endpoint_auth_method must be none: this provider registers only public clients',
    );
  }
  let redirectURIs = body.redirect_uris;
  if (!Array.isArray(redirectURIs) || redirectURIs.length === 0) {
    return refuse(
      'invalid_redirect_uri',
      'a registration must list its redirect URIs',
    );
  }
  if (redirectURIs.length > MAX_REDIRECT_URIS) {
    return refuse(
      'invalid_redirect_uri',
      `a registration may list at most ${MAX_REDIRECT_URIS} redirect URIs`,
    );
  }
  let refusal = redirectURIsRefusal(redirectURIs, hosts);
  if (refusal) {
    return refuse('invalid_redirect_uri', refusal);
  }
  if (body.scope !== undefined && typeof body.scope !== 'string') {
    return refuse('invalid_client_metadata', 'scope must be a string');
  }
  if (typeof body.scope === 'string' && body.scope.length > MAX_SCOPE_LENGTH) {
    return refuse(
      'invalid_client_metadata',
      `scope must be at most ${MAX_SCOPE_LENGTH} characters`,
    );
  }
  let name = body.client_name;
  if (
    name !== undefined &&
    (typeof name !== 'string' ||
      name.length > MAX_NAME_LENGTH ||
      UNSHOWABLE_CHARACTER.test(name))
  ) {
    return refuse(
      'invalid_client_metadata',
      `client_name must be text of at most ${MAX_NAME_LENGTH} characters, on one line, with no control or formatting characters`,
    );
  }

  let registration: Record<string, unknown> = {};
  for (let field of ALLOWED_FIELDS) {
    if (body[field] !== undefined) {
      registration[field] = body[field];
    }
  }
  if (typeof body.scope === 'string') {
    let offered = body.scope
      .split(' ')
      .filter((scope) => scopes.includes(scope));
    if (offered.length > 0) {
      registration.scope = [...new Set(offered)].join(' ');
    } else {
      delete registration.scope;
    }
  }
  // Written in, not left to the library's defaults: the library decides
  // whether to issue a client secret from the registration as sent, before
  // its defaults apply, and issues one when this is missing.
  registration.token_endpoint_auth_method = 'none';
  registration.application_type = applicationTypeFor(redirectURIs as string[]);
  return { allowed: true, registration };
}

// The handler for `POST` on the registration endpoint. `next` hands the
// request to the library, which reads the registration Boxel left on
// `req.body` once the body itself has been read.
export function registrationHandler({
  hosts,
  scopes,
  rateLimitStore,
  newClientLimit,
}: {
  hosts: BoxelHosts;
  scopes: readonly string[];
  rateLimitStore: RateLimitStore;
  newClientLimit: NewClientLimit;
}) {
  let alert = new NewClientAlert(newClientLimit);
  return async function handleRegistration(ctxt: Koa.Context, next: Koa.Next) {
    let address = ctxt.req.headers[CLIENT_IP_HEADER];
    let admitted = await takeNewClient(
      rateLimitStore,
      typeof address === 'string' ? address : undefined,
      newClientLimit,
    );
    alert.note(admitted);
    if (!admitted.admitted) {
      switch (admitted.reason) {
        case 'limited':
          ctxt.set('Retry-After', String(admitted.retryAfterSeconds));
          return respond(ctxt, 429, {
            error: 'temporarily_unavailable',
            error_description: 'too many registrations; try again later',
          });
        case 'unavailable':
          return respond(ctxt, 503, {
            error: 'temporarily_unavailable',
            error_description: 'registration is unavailable; try again later',
          });
        case 'unknown-address':
          return respond(ctxt, 403, {
            error: 'access_denied',
            error_description: 'registration is refused from this address',
          });
      }
    }

    if (!ctxt.is('application/json')) {
      return respond(ctxt, 400, {
        error: 'invalid_client_metadata',
        error_description: 'a registration must be sent as application/json',
      });
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(ctxt.req));
    } catch {
      return respond(ctxt, 400, {
        error: 'invalid_client_metadata',
        error_description: `a registration must be a JSON object of at most ${MAX_BODY_BYTES} bytes`,
      });
    }
    let check = checkRegistration(body, { hosts, scopes });
    if (!check.allowed) {
      return respond(ctxt, 400, {
        error: check.error,
        error_description: check.description,
      });
    }
    // The library reads `req.body` when the request stream has been read, as
    // it now has. It prints one warning per process the first time, which
    // this path expects.
    (ctxt.req as typeof ctxt.req & { body?: unknown }).body =
      check.registration;
    await next();
  };
}

async function readBody(req: Koa.Context['req']): Promise<string> {
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_BYTES) {
      throw new Error('registration too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function respond(
  ctxt: Koa.Context,
  status: number,
  body: { error: string; error_description: string },
) {
  ctxt.status = status;
  ctxt.set('Cache-Control', 'no-store');
  ctxt.body = body;
}

function refuse(
  error: 'invalid_redirect_uri' | 'invalid_client_metadata',
  description: string,
): RegistrationCheck {
  return { allowed: false, error, description };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
