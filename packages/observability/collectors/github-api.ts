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
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'boxel-actions-queue-collector',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
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

type GetRequest = (
  method: 'GET',
  url: string,
  token: string,
  body: undefined,
  headers?: Record<string, string>,
) => Promise<Response>;

// GitHub does not count a 304 Not Modified against the rate limit. A GET sent
// with the ETag of the last response for its URL therefore costs a request
// only when the resource changed since then, and a 304 gives back the body
// kept from that response.
export class ConditionalGets {
  #request: GetRequest;
  #entries = new Map<string, { etag: string; body: unknown; used: boolean }>();

  constructor(request: GetRequest = githubRequest) {
    this.#request = request;
  }

  async get(url: string, token: string): Promise<unknown> {
    const entry = this.#entries.get(url);
    const res = await this.#request(
      'GET',
      url,
      token,
      undefined,
      entry ? { 'if-none-match': entry.etag } : undefined,
    );
    if (res.status === 304 && entry) {
      entry.used = true;
      return entry.body;
    }
    if (!res.ok) {
      this.#entries.delete(url);
      throw await githubError('GET', url, res);
    }
    const body: unknown = await res.json();
    const etag = res.headers.get('etag');
    if (etag) this.#entries.set(url, { etag, body, used: true });
    else this.#entries.delete(url);
    return body;
  }

  // Forgets each URL that no get() asked for since the last sweep. A run that
  // finished is not asked for again, so without this its job list would stay
  // in memory for the life of the process.
  sweep(): void {
    for (const [url, entry] of this.#entries) {
      if (entry.used) entry.used = false;
      else this.#entries.delete(url);
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}
