// One request to the GitHub REST API, shared by the queue sampler and the App
// client so that both send the same headers and report failures the same way.

export const API = 'https://api.github.com';

// A request that never settles would stop the sample loop for good, with no
// line to show it. With a timeout it fails that sample, and the next one
// tries again.
const TIMEOUT_MS = 30_000;

export async function githubRequest(
  method: string,
  url: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'boxel-actions-queue-collector',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

// GitHub distinguishes its refusals only in the response body: a rejected
// credential, a token whose repository access omits this one, and an exhausted
// rate limit are all 403. Carrying the body and the remaining budget into the
// error means the emitted collector-error line says which, rather than leaving
// it to be inferred.
export async function githubError(
  method: string,
  url: string,
  res: Response,
): Promise<Error & { status: number }> {
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300).replace(/\s+/g, ' ').trim();
  } catch {
    // A body that cannot be read is not worth failing over; the status still
    // carries most of the signal.
  }
  const err = new Error(
    `${method} ${url} → ${res.status} ${res.statusText}` +
      (detail ? ` — ${detail}` : '') +
      ` (rate limit remaining: ${res.headers.get('x-ratelimit-remaining') ?? 'unknown'})`,
  ) as Error & { status: number };
  err.status = res.status;
  return err;
}
