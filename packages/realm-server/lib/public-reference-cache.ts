import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  isPublicReferenceRead,
  parsePublicReferenceURLs,
} from '@cardstack/runtime-common/public-reference-fetch';

const maximumBodyBytes = 10 * 1024 * 1024;
const maximumQueryBytes = 64 * 1024;
const responseHeaders = [
  'content-type',
  'etag',
  'last-modified',
  'x-boxel-realm-url',
  'x-boxel-realm-public-readable',
];

interface CacheEntry {
  storedAt: number;
  headers: [string, string][];
  body: string;
}

export async function createPublicReferenceCache(options: {
  directory: string;
  realmURLs: readonly string[];
  fetch?: typeof globalThis.fetch;
  freshnessMs?: number;
  savePublicSnapshots?: boolean;
}) {
  if (!path.isAbsolute(options.directory))
    throw new Error('Cache directory must be absolute');
  let realms = parsePublicReferenceURLs(options.realmURLs);
  let [upstreamOrigin] = realms;
  if (realms.some((realm) => realm.origin !== upstreamOrigin.origin)) {
    throw new Error('Public cache realms must share one upstream origin');
  }
  let fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  let freshnessMs = options.freshnessMs ?? 60_000;
  let pending = new Map<string, Promise<CacheEntry | null>>();
  let controllers = new Set<AbortController>();
  let closed = false;
  await mkdir(options.directory, { recursive: true, mode: 0o700 });

  function hasPublicAssertion(response: Response, realmURL: string) {
    return (
      response.status === 200 &&
      !response.headers.has('set-cookie') &&
      !/private|authorization|cookie/i.test(
        `${response.headers.get('cache-control') ?? ''},${response.headers.get('vary') ?? ''}`,
      ) &&
      response.headers.get('x-boxel-realm-public-readable') === 'true' &&
      response.headers.get('x-boxel-realm-url') === realmURL
    );
  }

  async function publicSnapshotAllowed(
    response: Response,
    request: Request,
    body: string,
    signal: AbortSignal,
  ) {
    if (options.savePublicSnapshots !== true) return false;
    if (request.method !== 'QUERY')
      return realms.some((realm) => hasPublicAssertion(response, realm.href));
    let query: unknown = JSON.parse(body);
    if (
      typeof query !== 'object' ||
      query === null ||
      !('realms' in query) ||
      !Array.isArray(query.realms)
    )
      return false;
    for (let servedRealmURL of query.realms) {
      let realm = realms.find((allowed) => allowed.href === servedRealmURL);
      if (!realm) return false;
      let info = await fetchImplementation(new URL('_info', realm), {
        headers: { Accept: 'application/vnd.api+json' },
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal,
      });
      let isPublic = hasPublicAssertion(info, realm.href);
      await info.body?.cancel();
      if (!isPublic) return false;
    }
    return query.realms.length > 0;
  }

  async function load(key: string): Promise<CacheEntry | null> {
    let file = path.join(options.directory, key);
    try {
      if ((await stat(file)).size > maximumBodyBytes * 1.5) return null;
      let data: unknown = JSON.parse(await readFile(file, 'utf8'));
      if (
        typeof data !== 'object' ||
        data === null ||
        !('storedAt' in data) ||
        typeof data.storedAt !== 'number' ||
        !('headers' in data) ||
        !Array.isArray(data.headers) ||
        !('body' in data) ||
        typeof data.body !== 'string'
      )
        return null;
      let headers: [string, string][] = [];
      for (let item of data.headers) {
        if (
          !Array.isArray(item) ||
          item.length !== 2 ||
          typeof item[0] !== 'string' ||
          typeof item[1] !== 'string' ||
          !responseHeaders.includes(item[0])
        )
          return null;
        headers.push([item[0], item[1]]);
      }
      return { storedAt: data.storedAt, headers, body: data.body };
    } catch {
      return null;
    }
  }

  async function download(
    key: string,
    url: URL,
    request: Request,
    body: string,
  ) {
    let existing = pending.get(key);
    if (existing) return existing;
    let controller = new AbortController();
    controllers.add(controller);
    let timer = setTimeout(() => controller.abort(), 15_000);
    let task = (async (): Promise<CacheEntry | null> => {
      let temporary = path.join(
        options.directory,
        `${key}.${randomUUID()}.tmp`,
      );
      try {
        if (closed) return null;
        let headers = new Headers();
        for (let name of ['accept', 'content-type', 'x-boxel-link-shape']) {
          let value = request.headers.get(name);
          if (value !== null) headers.set(name, value);
        }
        let response = await fetchImplementation(url, {
          method: request.method === 'HEAD' ? 'GET' : request.method,
          headers,
          ...(request.method === 'QUERY' ? { body } : {}),
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        });
        if (
          response.status !== 200 ||
          response.headers.has('set-cookie') ||
          /private/i.test(response.headers.get('cache-control') ?? '') ||
          (/no-store/i.test(response.headers.get('cache-control') ?? '') &&
            !(await publicSnapshotAllowed(
              response,
              request,
              body,
              controller.signal,
            ))) ||
          /authorization|cookie/i.test(response.headers.get('vary') ?? '')
        ) {
          await response.body?.cancel();
          return null;
        }
        let bytes = await readLimitedBody(response, maximumBodyBytes);
        let entry: CacheEntry = {
          storedAt: Date.now(),
          headers: [...response.headers].filter(([name]) =>
            responseHeaders.includes(name),
          ),
          body: Buffer.from(bytes).toString('base64'),
        };
        await writeFile(temporary, JSON.stringify(entry), {
          mode: 0o600,
          flag: 'wx',
        });
        await rename(temporary, path.join(options.directory, key));
        return entry;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
        await unlink(temporary).catch(() => {});
      }
    })();
    pending.set(key, task);
    void task.finally(() => pending.delete(key));
    return task;
  }

  function serve(entry: CacheEntry, method: string, state: string) {
    let headers = new Headers(entry.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set(
      'Access-Control-Expose-Headers',
      'X-Boxel-Realm-Url, X-Boxel-Realm-Public-Readable, X-Boxel-Reference-Cache',
    );
    headers.set('X-Boxel-Reference-Cache', state);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(
      method === 'HEAD' ? null : Buffer.from(entry.body, 'base64'),
      { headers },
    );
  }

  return {
    async fetch(request: Request): Promise<Response> {
      if (closed)
        return new Response('Reference cache stopped', { status: 503 });
      let requestURL = new URL(request.url);
      if (requestURL.pathname === '/_health') return new Response('ready');
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, QUERY',
            'Access-Control-Allow-Headers':
              'Accept, Content-Type, X-Boxel-Link-Shape',
          },
        });
      }
      if (
        request.headers.has('authorization') ||
        request.headers.has('cookie')
      ) {
        return new Response('Public reads only', { status: 400 });
      }
      let url = new URL(
        requestURL.pathname + requestURL.search,
        upstreamOrigin,
      );
      let body: string;
      try {
        body =
          request.method === 'QUERY'
            ? new TextDecoder().decode(
                await readLimitedBody(request, maximumQueryBytes),
              )
            : '';
      } catch {
        return new Response('Reference query too large', { status: 413 });
      }
      if (!isPublicReferenceRead(url, request.method, realms, body)) {
        return new Response('Reference read not allowed', { status: 403 });
      }
      let key = createHash('sha256')
        .update(
          JSON.stringify([
            url.href,
            request.method === 'HEAD' ? 'GET' : request.method,
            request.headers.get('accept'),
            request.headers.get('content-type'),
            request.headers.get('x-boxel-link-shape'),
            body,
          ]),
        )
        .digest('hex');
      let cached = await load(key);
      if (cached) {
        if (Date.now() - cached.storedAt >= freshnessMs) {
          void download(key, url, request, body);
        }
        return serve(cached, request.method, 'hit');
      }
      let entry = await download(key, url, request, body);
      return entry
        ? serve(entry, request.method, 'miss')
        : new Response(
            'Public reference unavailable; open it once while online to cache it.',
            { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
          );
    },
    async close() {
      closed = true;
      for (let controller of controllers) controller.abort();
      await Promise.all(pending.values());
    },
  };
}

async function readLimitedBody(message: Request | Response, limit: number) {
  let reader = message.body?.getReader();
  if (!reader) return new Uint8Array();
  let chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      let { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      size += value.byteLength;
      if (size > limit) throw new Error('Reference response too large');
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
