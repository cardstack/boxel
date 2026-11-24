// What the authorize page asks of Boxel's OAuth provider on the realm server
// (ADR 021 §1.7), and the addresses it sends the browser to.
//
// The provider sends the browser to `authorize?interaction=<id>` to show a
// flow's consent, and to `authorize?error=<reference>` when the flow can't go
// ahead. The page reads the flow's details and records the user's answer
// under the window's own session, never with the provider's cookies, so card
// code on the app's origin can do neither. The answer is a ticket, and the
// browser carries it to the finish route by a top-level navigation, where the
// provider's interaction cookie proves it is the browser that started the
// flow.
//
// The interaction ID comes from the address, so anyone can link to the page
// with any value in it. It is used only when it has the shape the library
// gives an ID, and is encoded wherever it goes into a path, so it can never
// name another of the realm server's routes. It is never put in an error's
// message, which telemetry records.

import { CONFIRMATION_CODE } from './confirmation-code.js';
import { ERROR_REFERENCE } from './oauth-error-states.js';
import { SecureSessionError, timedFetch } from './session.js';
import type { Session } from './session.js';

type Config = { realmServerURL: URL };

// The shape of the library's interaction IDs, with room to spare.
const INTERACTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isInteractionId(value: unknown): value is string {
  return typeof value === 'string' && INTERACTION_ID.test(value);
}

// What an `authorize` address asks the page to show. An error the provider
// sends the browser to wins over anything else in the address: a flow that
// failed never shows consent.
export type AuthorizeRequest =
  | { kind: 'error' }
  | { kind: 'consent'; interaction: string }
  | { kind: 'none' };

export function authorizeRequest(search: string): AuthorizeRequest {
  let params = new URLSearchParams(search);
  if (params.has('error')) {
    return { kind: 'error' };
  }
  let interaction = params.get('interaction');
  return isInteractionId(interaction)
    ? { kind: 'consent', interaction }
    : { kind: 'none' };
}

// How the provider names an app (`app-name.ts` on the realm server).
export interface AppName {
  kind: 'pre-registered' | 'metadata-document' | 'dynamic';
  shown: string;
  verified: boolean;
  claimedName?: string;
  // Set when `shown` is a phrase standing in for a name Boxel doesn't have
  // ("an app on this computer", "an unknown app"), rather than a name. A
  // page words the app by this, never by comparing the phrase.
  standIn?: 'loopback' | 'unknown';
  // Where a pre-registered app runs: on the user's own computer.
  place?: 'this-computer';
}

export interface ConsentScope {
  name: string;
  description: string;
  label: string;
  caution: boolean;
}

export interface ConsentResource {
  id: string;
  name: string;
  description: string;
  coverage: string;
  scopes: ConsentScope[];
}

export type AccountContact = { email: string } | { displayName: string };

// A flow's consent, as the provider describes it. What the access means comes
// from Boxel's registry; only `app` comes from the client, and the provider
// has already reduced it to a name Boxel can check.
export interface ConsentDetails {
  app: AppName;
  outsideApp: boolean;
  resources: ConsentResource[];
  account: AccountContact;
  renewalOffered: boolean;
  // The code the app showed where the user started signing in, for the user
  // to check against. Only a pre-registered app on this computer sends one.
  confirmationCode?: string;
}

// The provider's refusals, as fixed codes. Anything else is `failed`.
const REFUSALS = new Set([
  'bad-request',
  'signed-out',
  'forbidden',
  'expired',
  'decided',
  'unavailable',
]);

// A refusal from the consent routes. `reference` is set when the provider
// ended the flow and stored an error the error page can look up: only a value
// of a reference's shape is kept, so nothing else from the answer reaches a
// request path or a link.
export class ConsentRefusal extends SecureSessionError {
  reference: string | undefined;
  constructor(
    status: number,
    code: string,
    message: string,
    reference?: string,
  ) {
    super(status, code, message);
    this.reference = reference;
  }
}

const MESSAGES: Record<number, string> = {
  401: 'Sign in to continue.',
  404: 'This request has expired.',
  409: 'This request was already answered.',
};

function consentPath(interaction: string): string {
  if (!isInteractionId(interaction)) {
    throw new SecureSessionError(400, 'bad-request', 'This link is not valid.');
  }
  return `_oauth-provider/consent/${encodeURIComponent(interaction)}`;
}

async function consentRequest(
  config: Config,
  session: Session,
  interaction: string,
  init: { method: 'GET' } | { method: 'POST'; body: unknown },
): Promise<unknown> {
  let headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${session.token}`,
  };
  if (init.method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await timedFetch(
      new URL(consentPath(interaction), config.realmServerURL),
      {
        method: init.method,
        headers,
        body: init.method === 'POST' ? JSON.stringify(init.body) : undefined,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      },
      'realm-server',
    );
  } catch (e) {
    if (e instanceof SecureSessionError) {
      throw e;
    }
    throw new SecureSessionError(0, 'network', 'Boxel could not be reached.');
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    let { error, reference } =
      (json as { error?: unknown; reference?: unknown } | undefined) ?? {};
    throw new ConsentRefusal(
      response.status,
      typeof error === 'string' && REFUSALS.has(error) ? error : 'failed',
      MESSAGES[response.status] ?? 'Something went wrong. Try again.',
      typeof reference === 'string' && ERROR_REFERENCE.test(reference)
        ? reference
        : undefined,
    );
  }
  return json;
}

function malformed(): SecureSessionError {
  return new SecureSessionError(
    502,
    'failed',
    'Something went wrong. Try again.',
  );
}

function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw malformed();
  }
  return value;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw malformed();
  }
  return value;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw malformed();
  }
  return value as Record<string, unknown>;
}

// The details as the page shows them: only the fields it knows, each of the
// type it expects, so nothing else in a response ever reaches the page.
export function readConsentDetails(json: unknown): ConsentDetails {
  let body = record(json);
  let app = record(body.app);
  let kind = text(app.kind);
  if (
    kind !== 'pre-registered' &&
    kind !== 'metadata-document' &&
    kind !== 'dynamic'
  ) {
    throw malformed();
  }
  let account = record(body.account);
  let resources = list(body.resources).map((entry) => {
    let resource = record(entry);
    return {
      id: text(resource.id),
      name: text(resource.name),
      description: text(resource.description),
      coverage: text(resource.coverage),
      scopes: list(resource.scopes).map((item) => {
        let scope = record(item);
        return {
          name: text(scope.name),
          description: text(scope.description),
          label: text(scope.label),
          caution: scope.caution === true,
        };
      }),
    };
  });
  if (resources.length === 0) {
    throw malformed();
  }
  return {
    app: {
      kind,
      shown: text(app.shown),
      verified: app.verified === true,
      ...(typeof app.claimedName === 'string' && app.claimedName
        ? { claimedName: app.claimedName }
        : {}),
      ...(kind === 'pre-registered' && app.place === 'this-computer'
        ? { place: 'this-computer' as const }
        : {}),
    },
    outsideApp: body.outsideApp === true,
    resources,
    account:
      typeof account.email === 'string'
        ? { email: account.email }
        : { displayName: text(account.displayName) },
    renewalOffered: body.renewalOffered === true,
    ...(typeof body.confirmationCode === 'string' &&
    CONFIRMATION_CODE.test(body.confirmationCode)
      ? { confirmationCode: body.confirmationCode }
      : {}),
  };
}

// `GET /_oauth-provider/consent/:id`.
export async function consentDetails(
  config: Config,
  session: Session,
  interaction: string,
): Promise<ConsentDetails> {
  return readConsentDetails(
    await consentRequest(config, session, interaction, { method: 'GET' }),
  );
}

// `POST /_oauth-provider/consent/:id`: Allow or Deny, and whether to keep the
// connection for 30 days. Answers the ticket that finishes the flow.
export async function decideConsent(
  config: Config,
  session: Session,
  interaction: string,
  decision: { decision: 'allow' | 'deny'; renew: boolean },
): Promise<string> {
  let json = await consentRequest(config, session, interaction, {
    method: 'POST',
    body: { decision: decision.decision, renew: decision.renew === true },
  });
  let ticket = (json as { ticket?: unknown } | undefined)?.ticket;
  if (typeof ticket !== 'string' || !ticket) {
    throw malformed();
  }
  return ticket;
}

function finishPath(interaction: string): string {
  if (!isInteractionId(interaction)) {
    throw new SecureSessionError(400, 'bad-request', 'This link is not valid.');
  }
  return `_oauth-provider/interaction/${encodeURIComponent(interaction)}/finish`;
}

// Where the browser goes to finish a decided flow, with its ticket.
export function finishURL(
  config: Config,
  interaction: string,
  ticket: string,
): string {
  let url = new URL(finishPath(interaction), config.realmServerURL);
  url.searchParams.set('ticket', ticket);
  return url.href;
}

// Where the browser goes to cancel a flow it has no session to decide with:
// the app is told `access_denied`.
export function cancelURL(config: Config, interaction: string): string {
  let url = new URL(finishPath(interaction), config.realmServerURL);
  url.searchParams.set('cancel', '1');
  return url.href;
}
