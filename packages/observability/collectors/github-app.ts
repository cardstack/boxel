// Reads and writes a repository's Actions variable as a GitHub App.
//
// The collector's own token only reads the Actions queue. Writing the spill
// variable takes an App installed on the one repository with the "Variables:
// read and write" permission, so that the credential in the task can change
// nothing else. An App's key never expires, and its installation tokens last
// an hour, so the collector mints a new one when the cached one nears expiry.

import { createPrivateKey, sign, type KeyObject } from 'node:crypto';

import { API, githubError, githubRequest } from './github-api.ts';

export interface GithubAppConfig {
  appId: string;
  installationId: string;
  // PEM, as GitHub issues it. Either PKCS#1 or PKCS#8.
  privateKey: string;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

// GitHub accepts an App JWT for at most ten minutes, and checks `iat` against
// its own clock, so `iat` is set a minute back to allow for drift.
export function appJwt(
  appId: string,
  key: KeyObject,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }),
  );
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(`${header}.${payload}`),
    key,
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

// Throws for any status except success and, when `allow404`, a 404.
async function request(
  method: string,
  path: string,
  token: string,
  body?: unknown,
  allow404 = false,
): Promise<Response> {
  const url = `${API}${path}`;
  const res = await githubRequest(method, url, token, body);
  if (!res.ok && !(allow404 && res.status === 404)) {
    throw await githubError(method, url, res);
  }
  return res;
}

export class RepoVariable {
  #config: GithubAppConfig;
  #key: KeyObject;
  #repo: string;
  #name: string;
  #token: { value: string; expiresAt: number } | null = null;

  constructor(config: GithubAppConfig, repo: string, name: string) {
    this.#config = config;
    // Parsed once, so that a malformed key fails at startup rather than on the
    // first write.
    this.#key = createPrivateKey(config.privateKey);
    this.#repo = repo;
    this.#name = name;
  }

  get repo(): string {
    return this.#repo;
  }

  get name(): string {
    return this.#name;
  }

  async #installationToken(): Promise<string> {
    // Renewed five minutes early, so a token never expires between this
    // check and the request that uses it.
    if (this.#token && this.#token.expiresAt - Date.now() > 5 * 60_000) {
      return this.#token.value;
    }
    const path = `/app/installations/${this.#config.installationId}/access_tokens`;
    const res = await request(
      'POST',
      path,
      appJwt(this.#config.appId, this.#key),
    );
    const body = (await res.json()) as { token: string; expires_at: string };
    this.#token = { value: body.token, expiresAt: Date.parse(body.expires_at) };
    return body.token;
  }

  // The variable's value, or null when it does not exist.
  async read(): Promise<string | null> {
    const path = `/repos/${this.#repo}/actions/variables/${this.#name}`;
    const res = await request(
      'GET',
      path,
      await this.#installationToken(),
      undefined,
      true,
    );
    if (res.status === 404) return null;
    return ((await res.json()) as { value: string }).value;
  }

  // `exists` comes from the read that preceded this write: GitHub updates a
  // variable with PATCH and creates one with POST.
  async write(value: string, exists: boolean): Promise<void> {
    const token = await this.#installationToken();
    const path = exists
      ? `/repos/${this.#repo}/actions/variables/${this.#name}`
      : `/repos/${this.#repo}/actions/variables`;
    const method = exists ? 'PATCH' : 'POST';
    await request(method, path, token, { name: this.#name, value });
  }
}

// The App's settings come from the task environment. All three or none: a
// partial set is a misconfiguration, not a request for dry-run mode.
export function githubAppFromEnv(
  env: Record<string, string | undefined>,
): GithubAppConfig | null {
  const appId = env.SPILL_APP_ID || '';
  const installationId = env.SPILL_APP_INSTALLATION_ID || '';
  const privateKey = env.SPILL_APP_PRIVATE_KEY || '';
  const set = [appId, installationId, privateKey].filter(Boolean).length;
  if (set === 0) return null;
  if (set < 3) {
    throw new Error(
      'set all of SPILL_APP_ID, SPILL_APP_INSTALLATION_ID and SPILL_APP_PRIVATE_KEY, or none of them',
    );
  }
  // A PEM pasted into a single-line field arrives with its newlines escaped.
  return {
    appId,
    installationId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
  };
}
