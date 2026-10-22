import { Agent } from 'undici';

// fetch gives up on a response whose headers haven't arrived within five
// minutes. A realm answers a write only once it has written every file in it,
// so a large /_atomic request can take longer than that.
const HEADERS_TIMEOUT_MS = 15 * 60_000;

let dispatcher: Agent | undefined;

/** fetch for a realm request, waiting up to 15 minutes for the response. */
export function realmFetch(
  input: string | URL | Request,
  init: RequestInit,
): Promise<Response> {
  dispatcher ??= new Agent({ headersTimeout: HEADERS_TIMEOUT_MS });
  const withDispatcher: RequestInit & { dispatcher: Agent } = {
    ...init,
    dispatcher,
  };
  return fetch(input, withDispatcher);
}
