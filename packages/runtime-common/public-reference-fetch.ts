export interface PublicReferenceFetchConfiguration {
  proxyURL: string;
  realmURLs: readonly string[];
}

export function publicReferenceFetchFromEnv(
  env: Record<string, string | undefined>,
  fetchImplementation: typeof globalThis.fetch,
): typeof globalThis.fetch {
  let proxyURL = env.BOXEL_PUBLIC_REFERENCE_CACHE_URL;
  let rawRealms = env.BOXEL_PUBLIC_REFERENCE_REALMS;
  if (proxyURL === undefined && rawRealms === undefined)
    return fetchImplementation;
  if (!proxyURL || !rawRealms)
    throw new Error('Incomplete public reference cache configuration');
  let input: unknown = JSON.parse(rawRealms);
  let realmURLs = parsePublicReferenceURLs(input).map((url) => url.href);
  return createPublicReferenceFetch(
    { proxyURL, realmURLs },
    fetchImplementation,
  );
}

export function parsePublicReferenceURLs(input: unknown): URL[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Public reference realms must be a nonempty URL list');
  }
  return input.map((value: unknown) => {
    if (typeof value !== 'string') {
      throw new Error('Invalid public reference realm URL');
    }
    let url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname === '/' ||
      !url.pathname.endsWith('/')
    ) {
      throw new Error('Invalid public reference realm URL');
    }
    return url;
  });
}

export function isPublicReferenceRead(
  url: URL,
  method: string,
  realms: readonly URL[],
  body: string,
): boolean {
  if (url.username || url.password || url.search || url.hash) return false;
  try {
    if (
      url.pathname.split('/').some((segment) => {
        let decoded = decodeURIComponent(segment);
        return decoded === '.' || decoded === '..' || /[/\\]/.test(decoded);
      })
    )
      return false;
  } catch {
    return false;
  }
  if (method === 'GET' || method === 'HEAD') {
    return realms.some(
      (realm) =>
        url.origin === realm.origin && url.pathname.startsWith(realm.pathname),
    );
  }
  if (
    method !== 'QUERY' ||
    url.pathname !== '/_federated-search' ||
    !realms.some((realm) => realm.origin === url.origin)
  )
    return false;
  try {
    let query: unknown = JSON.parse(body);
    return (
      typeof query === 'object' &&
      query !== null &&
      'realms' in query &&
      Array.isArray(query.realms) &&
      query.realms.length > 0 &&
      query.realms.every(
        (realm: unknown) =>
          typeof realm === 'string' &&
          realms.some((allowed) => allowed.href === realm),
      )
    );
  } catch {
    return false;
  }
}

export function createPublicReferenceFetch(
  configuration: PublicReferenceFetchConfiguration | null,
  fetchImplementation: typeof globalThis.fetch = globalThis.fetch.bind(
    globalThis,
  ),
): typeof globalThis.fetch {
  if (!configuration) return fetchImplementation;
  let realms = parsePublicReferenceURLs(configuration.realmURLs);
  let proxy = new URL(configuration.proxyURL);
  if (
    !['http:', 'https:'].includes(proxy.protocol) ||
    proxy.username ||
    proxy.password ||
    proxy.search ||
    proxy.hash ||
    !proxy.pathname.endsWith('/')
  )
    throw new Error('Invalid public reference cache URL');
  return async (input, init) => {
    let request = new Request(input, init);
    let url = new URL(request.url);
    let body = request.method === 'QUERY' ? await request.clone().text() : '';
    if (!isPublicReferenceRead(url, request.method, realms, body)) {
      return fetchImplementation(request);
    }
    let target = new URL(url.pathname.slice(1), proxy);
    let headers = new Headers();
    for (let name of ['accept', 'content-type', 'x-boxel-link-shape']) {
      let value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    let response = await fetchImplementation(target, {
      method: request.method,
      headers,
      ...(request.method === 'QUERY' ? { body } : {}),
      signal: request.signal,
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    Object.defineProperty(response, 'url', { value: url.href });
    return response;
  };
}
