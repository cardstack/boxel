// What the authorize page's error page reads, and the one address it links
// to (ADR 021 §1.8).
//
// The realm server sends the browser to `authorize?error=<value>` when a flow
// can't go ahead. The value is one of two fixed words, or a reference to the
// error the server stored. The page looks a reference up on the realm server
// and shows only what that answers: which state to show, the app's name, and
// whether "Return" is offered. "Return" links to the realm-server route that
// sends the browser back to the app, built from the realm server's address
// and the reference alone. Nothing else in the page's address is read, shown
// or followed, so a hand-made error-page address can send the browser nowhere.

import {
  ERROR_REFERENCE,
  ERROR_STATE_BY_REASON,
  FIXED_ERRORS,
  UNKNOWN_REASON_STATE,
} from './oauth-error-states.js';
import { timedFetch } from './session.js';

export type ErrorState =
  | 'invalid-client'
  | 'bad-redirect'
  | 'expired'
  | 'not-offered'
  | 'not-allowed'
  | 'unsupported'
  | 'cant-continue'
  | 'rate-limited';

// What the page's address asks for.
export type ErrorParam =
  // A state that needs no lookup.
  | { kind: 'fixed'; state: ErrorState }
  // A reference to look up.
  | { kind: 'ref'; ref: string }
  // Anything else: no `error`, more than one, or a value the server never
  // sends. Shown as an expired request, with nothing looked up.
  | { kind: 'invalid' };

// The app, as the page names it: by the name Boxel can check, which is all
// that is kept of the server's answer. A name a self-registered app gave
// itself is never shown here, so the page has nothing to mark unverified.
export interface ErrorApp {
  shown: string;
}

export interface ErrorDetails {
  state: ErrorState;
  app?: ErrorApp;
  returnOffered: boolean;
}

// A lookup that didn't answer. `status` is 0 when no response came.
export class ErrorDetailsFailure extends Error {
  status: number;
  retryable: boolean;
  constructor(status: number, retryable: boolean) {
    super(status === 0 ? 'No response from the server' : `Status ${status}`);
    this.status = status;
    this.retryable = retryable;
  }
}

// How long a lookup may take before the page says it couldn't load.
export const ERROR_DETAILS_TIMEOUT_MS = 15_000;

// What the realm server names an app it can't name, which the page words as
// it words no app at all.
const UNKNOWN_APP_NAME = 'an unknown app';

// The states "Return" may be shown in. The realm server never offers it for
// the others, and the page doesn't draw it there whatever it's told.
const RETURNABLE_STATES: ReadonlySet<ErrorState> = new Set([
  'not-offered',
  'not-allowed',
  'unsupported',
]);

export function parseErrorParam(search: string | URLSearchParams): ErrorParam {
  let params =
    typeof search === 'string' ? new URLSearchParams(search) : search;
  let values = params.getAll('error');
  if (values.length !== 1) {
    return { kind: 'invalid' };
  }
  let [value] = values as [string];
  if (Object.hasOwn(FIXED_ERRORS, value)) {
    return {
      kind: 'fixed',
      state: FIXED_ERRORS[value as keyof typeof FIXED_ERRORS] as ErrorState,
    };
  }
  if (ERROR_REFERENCE.test(value)) {
    return { kind: 'ref', ref: value };
  }
  return { kind: 'invalid' };
}

// The state for a reason the realm server gives.
export function errorStateForReason(reason: string): ErrorState {
  return Object.hasOwn(ERROR_STATE_BY_REASON, reason)
    ? (ERROR_STATE_BY_REASON[
        reason as keyof typeof ERROR_STATE_BY_REASON
      ] as ErrorState)
    : UNKNOWN_REASON_STATE;
}

function errorURL(realmServerURL: URL, ref: string, suffix = ''): URL {
  if (!ERROR_REFERENCE.test(ref)) {
    throw new Error('Not an error reference');
  }
  return new URL(`_oauth-provider/error/${ref}${suffix}`, realmServerURL);
}

// The address "Return" links to: the realm-server route that sends the
// browser back to the app, once, when the app and its address are valid.
export function errorReturnURL(realmServerURL: URL, ref: string): string {
  return errorURL(realmServerURL, ref, '/return').href;
}

// Looks an error up by its reference. A reference the server doesn't know
// (spent, expired or never issued) reads as an expired request. Throws an
// `ErrorDetailsFailure` for anything else that isn't a usable answer.
export async function readAuthorizationError(
  realmServerURL: URL,
  ref: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<ErrorDetails> {
  let url = errorURL(realmServerURL, ref);
  let timeout = AbortSignal.timeout(ERROR_DETAILS_TIMEOUT_MS);
  let response: Response;
  try {
    response = await timedFetch(
      url,
      {
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
      'realm-server',
    );
  } catch {
    throw new ErrorDetailsFailure(0, true);
  }
  if (response.status === 404) {
    return { state: 'expired', returnOffered: false };
  }
  if (!response.ok) {
    throw new ErrorDetailsFailure(
      response.status,
      response.status >= 500 ||
        response.status === 408 ||
        response.status === 429,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ErrorDetailsFailure(response.status, true);
  }
  return toErrorDetails(body, response.status);
}

function toErrorDetails(body: unknown, status: number): ErrorDetails {
  if (!isRecord(body) || typeof body.reason !== 'string') {
    throw new ErrorDetailsFailure(status, true);
  }
  let state = errorStateForReason(body.reason);
  let app: ErrorApp | undefined;
  if (
    isRecord(body.app) &&
    typeof body.app.shown === 'string' &&
    body.app.shown !== '' &&
    body.app.shown !== UNKNOWN_APP_NAME
  ) {
    app = { shown: body.app.shown };
  }
  return {
    state,
    ...(app ? { app } : {}),
    returnOffered:
      body.returnOffered === true &&
      app !== undefined &&
      RETURNABLE_STATES.has(state),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
