// Example AI app: a stand-in for an AI app that connects to Boxel by OAuth,
// for the realm server's tests and for screenshots of a whole flow. It is
// never shipped: nothing outside the realm server's tests imports it. Its
// name is generic, so no screenshot shows a page that looks like a real
// product's.
//
// It plays an app's part of the flow the way a real one does. It reads the
// provider's discovery document, registers, starts each flow with a fresh
// PKCE verifier and `state`, checks what the provider sends back, and
// exchanges the code at the token endpoint for the resource it asked for.
// What it reports is the code's first few characters, then the scopes and
// expiry the token came with. The tokens stay inside this object.

import { createHash, randomBytes } from 'crypto';

export const EXAMPLE_AI_APP_NAME = 'Example AI app';

// How the app identifies itself to the provider:
// - `loopback`: dynamic client registration with a plain HTTP loopback
//   redirect, as a native app on the user's computer registers. Its pages name
//   it as an app on this computer.
// - `unverified`: dynamic client registration with an HTTPS redirect, as a
//   hosted app registers. Its pages name it by the redirect's domain, beside
//   the name it gave itself, marked unverified.
// - `cimd`: a client ID metadata document, served by the app at an `https://`
//   client ID. Its pages name it by that URL's domain.
export type RegistrationMode = 'loopback' | 'unverified' | 'cimd';
export const REGISTRATION_MODES: readonly RegistrationMode[] = [
  'loopback',
  'unverified',
  'cimd',
];

// The app's public web origin, on a domain reserved for examples (RFC 2606).
// Nothing answers there: the unverified mode's redirect lands on it, and the
// metadata document is served from the app's own loopback server, which tests
// map this origin to.
export const EXAMPLE_AI_APP_WEB_ORIGIN = 'https://ai-app.example.com';
export const EXAMPLE_AI_APP_WEB_REDIRECT_URI = `${EXAMPLE_AI_APP_WEB_ORIGIN}/callback`;
export const EXAMPLE_AI_APP_METADATA_DOCUMENT_PATH = '/client.json';
export const EXAMPLE_AI_APP_CLIENT_ID_URL = `${EXAMPLE_AI_APP_WEB_ORIGIN}${EXAMPLE_AI_APP_METADATA_DOCUMENT_PATH}`;

// A loopback redirect registered without a port, as native apps register one:
// the provider matches it on any port (RFC 8252 §7.3), and each flow names
// the port the app's server listens on.
const LOOPBACK_REGISTERED_REDIRECT_URI = 'http://127.0.0.1/callback';

// How many of the code's characters the result page shows.
export const CODE_PREVIEW_LENGTH = 6;

// What the app sends its requests to the provider through: `fetch` against a
// running stack, or a test's in-process server. URLs are absolute, as the
// discovery document gives them.
export interface ProviderTransport {
  get(url: string): Promise<ProviderResponse>;
  post(
    url: string,
    contentType: 'application/json' | 'application/x-www-form-urlencoded',
    body: string,
  ): Promise<ProviderResponse>;
}

export interface ProviderResponse {
  status: number;
  // The parsed JSON body, or undefined when the body isn't JSON.
  body: unknown;
}

export function fetchTransport(): ProviderTransport {
  async function send(url: string, init: RequestInit) {
    let response = await fetch(url, { ...init, redirect: 'manual' });
    let text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  }
  return {
    get: (url) => send(url, { headers: { Accept: 'application/json' } }),
    post: (url, contentType, body) =>
      send(url, {
        method: 'POST',
        headers: { 'Content-Type': contentType, Accept: 'application/json' },
        body,
      }),
  };
}

// The parts of the provider's discovery document (RFC 8414) the app uses.
export interface ProviderMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  authorization_response_iss_parameter_supported?: boolean;
}

// What a flow ended with, as the result page shows it.
export type FlowOutcome =
  | {
      kind: 'connected';
      codePreview: string;
      scopes: string[];
      expiresInSeconds: number;
      refreshTokenIssued: boolean;
    }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

export interface ExampleAIAppOptions {
  mode: RegistrationMode;
  // The realm server's origin, which serves the provider's discovery document.
  issuer: string;
  // The origin of the app's own server, on loopback. Its `/callback` is the
  // redirect for the loopback and metadata-document modes.
  appOrigin: string;
  transport: ProviderTransport;
  // The resource the app asks for. Defaults to the issuer's `/mcp`.
  resource?: string;
  scope?: string;
}

export class ExampleAIApp {
  readonly mode: RegistrationMode;
  readonly resource: string;
  readonly scope: string;
  readonly redirectUri: string;
  #issuer: string;
  #transport: ProviderTransport;
  #metadata: ProviderMetadata | undefined;
  #clientId: string | undefined;
  // Each flow's verifier, by the `state` it was started with. A response is
  // accepted once, for a flow this app started.
  #pending = new Map<string, string>();
  #tokens: { accessToken: string; refreshToken?: string } | undefined;

  constructor({
    mode,
    issuer,
    appOrigin,
    transport,
    resource,
    scope = 'boxel:read',
  }: ExampleAIAppOptions) {
    this.mode = mode;
    this.#issuer = new URL(issuer).origin;
    this.#transport = transport;
    this.resource = resource ?? `${this.#issuer}/mcp`;
    this.scope = scope;
    this.redirectUri =
      mode === 'unverified'
        ? EXAMPLE_AI_APP_WEB_REDIRECT_URI
        : `${new URL(appOrigin).origin}/callback`;
  }

  get clientId(): string {
    if (!this.#clientId) {
      throw new Error(`${EXAMPLE_AI_APP_NAME} hasn't registered yet`);
    }
    return this.#clientId;
  }

  // The tokens the last exchange returned. Only for a test that checks the
  // app's pages never show them; no page reads this.
  get heldTokensForTests():
    | { accessToken: string; refreshToken?: string }
    | undefined {
    return this.#tokens;
  }

  // The client ID metadata document the app serves in the `cimd` mode. Its
  // redirect is loopback with no port, as native apps publish one.
  metadataDocument(): Record<string, unknown> {
    return {
      client_id: EXAMPLE_AI_APP_CLIENT_ID_URL,
      client_name: EXAMPLE_AI_APP_NAME,
      client_uri: EXAMPLE_AI_APP_WEB_ORIGIN,
      redirect_uris: [LOOPBACK_REGISTERED_REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  // Reads the discovery document, then registers by the app's mode. A
  // metadata-document client has nothing to register: its client ID is the
  // document's URL, which the provider downloads when a flow starts.
  async register(): Promise<void> {
    let metadata = await this.#discover();
    if (this.mode === 'cimd') {
      this.#clientId = EXAMPLE_AI_APP_CLIENT_ID_URL;
      return;
    }
    if (!metadata.registration_endpoint) {
      throw new Error(
        "the provider's discovery document lists no registration endpoint",
      );
    }
    let response = await this.#transport.post(
      metadata.registration_endpoint,
      'application/json',
      JSON.stringify({
        client_name: EXAMPLE_AI_APP_NAME,
        redirect_uris: [
          this.mode === 'loopback'
            ? LOOPBACK_REGISTERED_REDIRECT_URI
            : EXAMPLE_AI_APP_WEB_REDIRECT_URI,
        ],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    );
    let clientId = field(response.body, 'client_id');
    if (response.status !== 201 || !clientId) {
      throw new Error(
        `registration was refused (${response.status}): ${describeError(response.body)}`,
      );
    }
    this.#clientId = clientId;
  }

  // Starts a flow: a fresh verifier and `state`, and the authorization URL the
  // browser is sent to.
  startFlow(): URL {
    let metadata = this.#requireMetadata();
    let verifier = randomBytes(32).toString('base64url');
    let state = randomBytes(16).toString('base64url');
    this.#pending.set(state, verifier);
    let url = new URL(metadata.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: this.scope,
      resource: this.resource,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return url;
  }

  // Handles the provider's response at the redirect URI: checks it answers a
  // flow this app started, at this issuer, then exchanges the code.
  async finishFlow(params: URLSearchParams): Promise<FlowOutcome> {
    let state = params.get('state');
    let verifier = state ? this.#pending.get(state) : undefined;
    if (!state || !verifier) {
      return {
        kind: 'error',
        message: `This response doesn't answer a connection ${EXAMPLE_AI_APP_NAME} started.`,
      };
    }
    this.#pending.delete(state);
    let metadata = this.#requireMetadata();
    // A provider whose discovery document says it names itself in every
    // response (RFC 9207 §2.4) is answered only by a response that does.
    let iss = params.get('iss');
    if (
      iss === null &&
      metadata.authorization_response_iss_parameter_supported === true
    ) {
      return {
        kind: 'error',
        message: "Boxel's response didn't name its issuer.",
      };
    }
    if (iss !== null && iss !== metadata.issuer) {
      return {
        kind: 'error',
        message: 'The response came from a different authorization server.',
      };
    }
    let error = params.get('error');
    if (error === 'access_denied') {
      return { kind: 'denied' };
    }
    if (error) {
      return { kind: 'error', message: `Boxel answered "${error}".` };
    }
    let code = params.get('code');
    if (!code) {
      return { kind: 'error', message: 'Boxel sent no code.' };
    }
    let response = await this.#transport.post(
      metadata.token_endpoint,
      'application/x-www-form-urlencoded',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        code,
        code_verifier: verifier,
        redirect_uri: this.redirectUri,
        resource: this.resource,
      }).toString(),
    );
    let accessToken = field(response.body, 'access_token');
    let expiresIn = (response.body as Record<string, unknown> | undefined)
      ?.expires_in;
    if (
      response.status !== 200 ||
      !accessToken ||
      typeof expiresIn !== 'number'
    ) {
      return {
        kind: 'error',
        message: `The code exchange was refused (${response.status}): ${describeError(response.body)}`,
      };
    }
    let refreshToken = field(response.body, 'refresh_token');
    this.#tokens = { accessToken, ...(refreshToken ? { refreshToken } : {}) };
    return {
      kind: 'connected',
      codePreview: code.slice(0, CODE_PREVIEW_LENGTH),
      // A response without `scope` granted the scope asked for (RFC 6749 §5.1).
      scopes: (field(response.body, 'scope') ?? this.scope)
        .split(' ')
        .filter(Boolean),
      expiresInSeconds: expiresIn,
      refreshTokenIssued: refreshToken !== undefined,
    };
  }

  async #discover(): Promise<ProviderMetadata> {
    let response = await this.#transport.get(
      `${this.#issuer}/.well-known/oauth-authorization-server`,
    );
    let body = response.body as Partial<ProviderMetadata> | undefined;
    if (
      response.status !== 200 ||
      !body?.issuer ||
      !body.authorization_endpoint ||
      !body.token_endpoint
    ) {
      throw new Error(
        `no OAuth discovery document at ${this.#issuer} (${response.status}); is the provider on?`,
      );
    }
    // The document must name the issuer it was fetched from (RFC 8414 §3.3):
    // every later check of `iss` compares against it.
    if (body.issuer.replace(/\/+$/, '') !== this.#issuer) {
      throw new Error(
        `the discovery document at ${this.#issuer} names the issuer ${body.issuer}`,
      );
    }
    this.#metadata = body as ProviderMetadata;
    return this.#metadata;
  }

  #requireMetadata(): ProviderMetadata {
    if (!this.#metadata) {
      throw new Error(`${EXAMPLE_AI_APP_NAME} hasn't registered yet`);
    }
    return this.#metadata;
  }
}

function field(body: unknown, name: string): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  let value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

// An OAuth error response's code and description, never anything else it
// carries.
function describeError(body: unknown): string {
  let error = field(body, 'error') ?? 'no error code';
  let description = field(body, 'error_description');
  return description ? `${error}: ${description}` : error;
}
