import { isBinaryFilename } from '@cardstack/runtime-common/infer-content-type';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { searchEntryWireQueryFromQuery } from '@cardstack/runtime-common/search-entry';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { RealmRunnerError } from './errors.js';

function scopedUrl(base, path) {
  if (typeof path !== 'string' || path.length === 0 || path.includes('\\')) {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      'API path must be a non-empty Realm-relative path',
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
    throw new RealmRunnerError(
      'CAPABILITY_DENIED',
      'Realm API reads cannot target an absolute URL',
    );
  }
  let target = new URL(path.replace(/^\/+/, ''), base);
  let baseUrl = new URL(base);
  if (
    target.origin !== baseUrl.origin ||
    !target.pathname.startsWith(baseUrl.pathname)
  ) {
    throw new RealmRunnerError(
      'CAPABILITY_DENIED',
      'Realm API path escapes the authorized scope',
    );
  }
  return target.href;
}

async function readResponseBytes(
  response,
  maxBytes = Number.POSITIVE_INFINITY,
) {
  let declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RealmRunnerError(
      'BYTE_LIMIT',
      'Realm API response exceeds the configured byte limit',
    );
  }
  if (!response.body) return new Uint8Array();

  let reader = response.body.getReader();
  let chunks = [];
  let total = 0;
  try {
    for (;;) {
      let { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RealmRunnerError(
          'BYTE_LIMIT',
          'Realm API response exceeds the configured byte limit',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  let bytes = new Uint8Array(total);
  let offset = 0;
  for (let chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function responseValue(
  response,
  responseType = 'auto',
  maxBytes = Number.POSITIVE_INFINITY,
) {
  let headers = {};
  for (let name of ['content-type', 'etag', 'last-modified', 'location']) {
    let value = response.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  let bytes = await readResponseBytes(response, maxBytes);
  let body;
  if (responseType === 'base64') {
    body = bytesToBase64(bytes);
  } else {
    let contentType = response.headers.get('content-type') ?? '';
    let text = new TextDecoder().decode(bytes);
    body = text;
    if (
      responseType === 'auto' &&
      /\bjson\b|\+json\b/i.test(contentType) &&
      text.length > 0
    ) {
      try {
        body = JSON.parse(text);
      } catch {
        // Preserve malformed or non-standard JSON bodies as text.
      }
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    headers,
    body,
    bodyBytes: bytes.byteLength,
  };
}

async function jsonResponseBody(response, maxBytes) {
  let text = new TextDecoder().decode(
    await readResponseBytes(response, maxBytes),
  );
  return JSON.parse(text);
}

async function errorSnippet(response, maxBytes = 4 * 1024) {
  return new TextDecoder()
    .decode(await readResponseBytes(response, maxBytes))
    .slice(0, 300);
}

function jwtClaims(authorization) {
  try {
    let token = authorization.replace(/^Bearer\s+/i, '');
    let payload = token.split('.')[1];
    if (!payload) return {};
    let base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    base64 += '='.repeat((4 - (base64.length % 4)) % 4);
    let bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return {};
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  let chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new RealmRunnerError(
      'INVALID_ARGUMENT',
      'API base64 body is not valid base64',
    );
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const BLOCKED_RAW_ENDPOINTS = new Set([
  '_delegate-session',
  '_realm-auth',
  '_realm-program',
  '_server-session',
  '_session',
]);

function assertRawEndpointAllowed(url) {
  let endpoint = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  if (endpoint && BLOCKED_RAW_ENDPOINTS.has(endpoint)) {
    throw new RealmRunnerError(
      'CAPABILITY_DENIED',
      `Raw Realm API access to ${endpoint} is reserved by the capability host`,
    );
  }
}

function resourceIdentity(type, id) {
  return `${type}\u0000${id}`;
}

function itemsFromEntryDocument(document) {
  let included = new Map();
  for (let resource of document.included ?? []) {
    if (resource?.type && resource?.id) {
      included.set(resourceIdentity(resource.type, resource.id), resource);
    }
  }
  let items = [];
  for (let entry of document.data ?? []) {
    let ref = entry?.relationships?.item?.data;
    let item = ref && included.get(resourceIdentity(ref.type, ref.id));
    if (item) items.push(item);
  }
  return items;
}

export class BoxelHttpAdapter {
  constructor({
    fetch,
    authorization,
    realmServerUrl,
    requestTimeoutMs = 120_000,
    responseLimitBytes = 4 * 1024 * 1024,
  }) {
    if (typeof fetch !== 'function') throw new TypeError('fetch is required');
    if (typeof authorization !== 'string' || authorization.length === 0) {
      throw new RealmRunnerError(
        'AUTHORIZATION_REQUIRED',
        'Realm Program execution requires an Authorization header',
      );
    }
    this.fetch = fetch;
    this.authorization = authorization;
    this.realmServerUrl = ensureTrailingSlash(realmServerUrl);
    this.requestTimeoutMs = requestTimeoutMs;
    this.responseLimitBytes = responseLimitBytes;
  }

  setProgramSignal(signal) {
    this.programSignal = signal;
  }

  async request(url, init = {}) {
    let headers = new Headers(init.headers);
    headers.set('Authorization', this.authorization);
    try {
      let timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
      return await this.fetch(url, {
        ...init,
        headers,
        signal: this.programSignal
          ? AbortSignal.any([timeoutSignal, this.programSignal])
          : timeoutSignal,
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        if (this.programSignal?.aborted) {
          throw new RealmRunnerError(
            'TIME_LIMIT',
            'Realm Script wall-clock execution timed out',
          );
        }
        throw new RealmRunnerError(
          'REALM_API_TIMEOUT',
          `Realm API request timed out after ${this.requestTimeoutMs}ms`,
        );
      }
      throw error;
    }
  }

  async listFiles(realmUrl, maxBytes = this.responseLimitBytes) {
    realmUrl = ensureTrailingSlash(realmUrl);
    let response = await this.request(`${realmUrl}_mtimes`, {
      headers: { Accept: SupportedMimeType.Mtimes },
    });
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `_mtimes returned HTTP ${response.status}: ${await errorSnippet(response)}`,
      );
    }
    let document = await jsonResponseBody(response, maxBytes);
    let mtimes = document?.data?.attributes?.mtimes ?? document;
    return Object.keys(mtimes)
      .filter((url) => url.startsWith(realmUrl))
      .map((url) => url.slice(realmUrl.length))
      .filter((path) => path.length > 0 && !path.endsWith('/'))
      .sort();
  }

  async readText(realmUrl, filePath, maxBytes = this.responseLimitBytes) {
    if (isBinaryFilename(filePath)) {
      throw new RealmRunnerError('BINARY_FILE', `${filePath} is binary`);
    }
    let response = await this.request(
      new URL(filePath, ensureTrailingSlash(realmUrl)).href,
      { headers: { Accept: SupportedMimeType.CardSource } },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `Unable to read ${filePath}: HTTP ${response.status}`,
      );
    }
    return new TextDecoder().decode(
      await readResponseBytes(response, maxBytes),
    );
  }

  async readBase64(realmUrl, filePath, maxBytes = this.responseLimitBytes) {
    let response = await this.request(
      new URL(filePath, ensureTrailingSlash(realmUrl)).href,
      { headers: { Accept: SupportedMimeType.CardSource } },
    );
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `Unable to read ${filePath}: HTTP ${response.status}`,
      );
    }
    return bytesToBase64(await readResponseBytes(response, maxBytes));
  }

  async readTranspiled(realmUrl, filePath, maxBytes = this.responseLimitBytes) {
    let response = await this.request(
      new URL(filePath, ensureTrailingSlash(realmUrl)).href,
      { headers: { Accept: '*/*' } },
    );
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `Unable to read transpiled module ${filePath}: HTTP ${response.status}`,
      );
    }
    return new TextDecoder().decode(
      await readResponseBytes(response, maxBytes),
    );
  }

  async lint(realmUrl, filePath, source) {
    let response = await this.request(
      new URL('_lint', ensureTrailingSlash(realmUrl)).href,
      {
        method: 'QUERY',
        headers: {
          Accept: SupportedMimeType.JSON,
          'Content-Type': 'text/plain',
          'X-Filename': filePath,
        },
        body: source,
      },
    );
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `Unable to lint ${filePath}: HTTP ${response.status}`,
      );
    }
    return jsonResponseBody(response, this.responseLimitBytes);
  }

  async listRealms() {
    let response = await this.request(
      new URL('_realm-auth', this.realmServerUrl).href,
      {
        method: 'POST',
        headers: { Accept: SupportedMimeType.JSON },
      },
    );
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `Realm discovery failed: HTTP ${response.status}`,
      );
    }
    let sessions = await jsonResponseBody(response, this.responseLimitBytes);
    return Object.entries(sessions)
      .map(([url, token]) => {
        let permissions = jwtClaims(`Bearer ${token}`).permissions ?? [];
        return {
          id: ensureTrailingSlash(url),
          url: ensureTrailingSlash(url),
          canRead: permissions.includes('read'),
          canWrite:
            permissions.includes('read') && permissions.includes('write'),
        };
      })
      .sort((a, b) => a.url.localeCompare(b.url));
  }

  async search(realmUrls, query) {
    let { cardUrls, scope, ...cardQuery } = query;
    let body = {
      ...searchEntryWireQueryFromQuery(cardQuery, {
        fields: ['item'],
        ...(scope ? { scope } : {}),
      }),
      realms: realmUrls.map(ensureTrailingSlash),
      ...(cardUrls ? { cardUrls } : {}),
    };
    let response = await this.request(
      new URL('_federated-search', this.realmServerUrl).href,
      {
        method: 'QUERY',
        headers: {
          Accept: 'application/vnd.card+json',
          'Content-Type': SupportedMimeType.JSON,
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `Federated search failed: HTTP ${response.status}: ${await errorSnippet(response)}`,
      );
    }
    return itemsFromEntryDocument(
      await jsonResponseBody(response, this.responseLimitBytes),
    );
  }

  async indexingErrors(realmUrl) {
    let response = await this.request(
      new URL('_indexing-errors', ensureTrailingSlash(realmUrl)).href,
      { headers: { Accept: SupportedMimeType.JSONAPI } },
    );
    if (!response.ok) {
      throw new RealmRunnerError(
        'REALM_API_ERROR',
        `Unable to read indexing errors: HTTP ${response.status}`,
      );
    }
    return jsonResponseBody(response, this.responseLimitBytes);
  }

  realmGet(realmUrl, path, options = {}) {
    return this.realmRead(realmUrl, 'GET', path, undefined, options);
  }

  realmHead(realmUrl, path, options = {}) {
    return this.realmRead(realmUrl, 'HEAD', path, undefined, options);
  }

  realmQuery(realmUrl, path, body, options = {}) {
    return this.realmRead(realmUrl, 'QUERY', path, body, options);
  }

  async realmRead(realmUrl, method, path, body, options) {
    return this.readApi(
      scopedUrl(ensureTrailingSlash(realmUrl), path),
      method,
      body,
      options,
    );
  }

  serverGet(path, options = {}) {
    return this.serverRead('GET', path, undefined, options);
  }

  serverHead(path, options = {}) {
    return this.serverRead('HEAD', path, undefined, options);
  }

  serverQuery(path, body, options = {}) {
    return this.serverRead('QUERY', path, body, options);
  }

  async serverRead(method, path, body, options) {
    return this.readApi(
      scopedUrl(this.realmServerUrl, path),
      method,
      body,
      options,
    );
  }

  async readApi(url, method, body, options = {}) {
    let headers = { Accept: options.accept ?? SupportedMimeType.JSON };
    let init = { method, headers };
    if (method === 'QUERY') {
      headers['Content-Type'] = options.contentType ?? SupportedMimeType.JSON;
      init.body = JSON.stringify(body ?? null);
    }
    return responseValue(
      await this.request(url, init),
      'auto',
      this.responseLimitBytes,
    );
  }

  realmRequest(realmUrl, method, path, options = {}) {
    return this.rawApiRequest(
      scopedUrl(ensureTrailingSlash(realmUrl), path),
      method,
      options,
    );
  }

  serverRequest(method, path, options = {}) {
    return this.rawApiRequest(
      scopedUrl(this.realmServerUrl, path),
      method,
      options,
    );
  }

  async rawApiRequest(url, method, options = {}) {
    assertRawEndpointAllowed(url);
    let headers = new Headers(options.headers);
    if (options.accept !== undefined) headers.set('Accept', options.accept);

    let body;
    if (options.bodyType === 'base64') {
      body = base64ToBytes(options.body);
    } else if (options.bodyType === 'json') {
      body = JSON.stringify(options.body ?? null);
    } else if (options.bodyType === 'text') {
      body = options.body;
    }
    if (body !== undefined && options.contentType !== undefined) {
      headers.set('Content-Type', options.contentType);
    }

    return responseValue(
      await this.request(url, { method, headers, body }),
      options.responseType,
      options.maxResponseBytes ?? this.responseLimitBytes,
    );
  }

  async atomicWrite(realmUrl, changes) {
    let operations = changes.map((change) =>
      change.operation === 'remove'
        ? { op: 'remove', href: change.path }
        : {
            op: change.exists ? 'update' : 'add',
            href: change.path,
            data: {
              type: 'source',
              attributes: { content: change.content },
              meta: {},
            },
          },
    );
    let response = await this.request(
      new URL('_atomic', ensureTrailingSlash(realmUrl)).href,
      {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': SupportedMimeType.JSONAPI,
        },
        body: JSON.stringify({ 'atomic:operations': operations }),
      },
    );
    if (!response.ok) {
      throw new RealmRunnerError(
        'COMMIT_FAILED',
        `Atomic Realm write failed: HTTP ${response.status}: ${await errorSnippet(response)}`,
      );
    }
    return jsonResponseBody(response, this.responseLimitBytes);
  }
}
