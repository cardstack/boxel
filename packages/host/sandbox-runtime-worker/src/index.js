const noncePattern = /^[a-f0-9]{32}$/;
const bootstrapIdPattern =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const bootstrapPaths = new Map([
  ['/_realm-sandbox-frame', 'bootstrapID'],
  ['/_boxel-sandbox-runtime', 'bootstrapId'],
]);
const parentAssetPrefix = '/_boxel-parent/';
const maxBootstrapBytes = 2 * 1024 * 1024;

export function isSandboxHostname(hostname, baseHostname) {
  let suffix = `.${String(baseHostname).toLowerCase()}`;
  let candidate = hostname.toLowerCase();
  if (!candidate.endsWith(suffix)) {
    return false;
  }
  return noncePattern.test(candidate.slice(0, -suffix.length));
}

function splitAllowedOrigins(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isAllowedParentOrigin(origin, configuredOrigins) {
  let candidate;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }
  if (candidate.origin !== origin || candidate.username || candidate.password) {
    return false;
  }
  return splitAllowedOrigins(configuredOrigins).some((entry) => {
    if (entry === origin) {
      return true;
    }
    let wildcard = entry.match(/^(https?):\/\/\*\.([^/:]+)(?::(\*))?$/);
    if (wildcard) {
      let [, protocol, suffix, wildcardPort] = wildcard;
      return (
        candidate.protocol === `${protocol}:` &&
        candidate.hostname.endsWith(`.${suffix}`) &&
        candidate.hostname !== suffix &&
        (!wildcardPort || candidate.port.length > 0)
      );
    }
    let localhost = entry.match(/^(https?):\/\/localhost:\*$/);
    return Boolean(
      localhost &&
      candidate.protocol === `${localhost[1]}:` &&
      candidate.hostname === 'localhost' &&
      candidate.port,
    );
  });
}

function rendererCSP(configuredOrigins, inlineScriptHashes = []) {
  let frameAncestors = splitAllowedOrigins(configuredOrigins).join(' ');
  let scriptHashes = inlineScriptHashes.join(' ');
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    "manifest-src 'none'",
    `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:${
      scriptHashes ? ` ${scriptHashes}` : ''
    }`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `frame-ancestors ${frameAncestors || "'none'"}`,
  ].join('; ');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function inlineScriptHashes(html) {
  let hashes = [];
  let scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let match of html.matchAll(scriptPattern)) {
    let [, attributes, source] = match;
    if (/\bsrc\s*=/i.test(attributes) || source.length === 0) {
      continue;
    }
    let digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(source),
    );
    hashes.push(`'sha256-${bytesToBase64(new Uint8Array(digest))}'`);
  }
  return hashes;
}

async function readBoundedText(response, maxBytes) {
  let declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('response exceeds the renderer bootstrap limit');
  }
  if (!response.body) {
    return '';
  }
  let reader = response.body.getReader();
  let decoder = new TextDecoder();
  let total = 0;
  let result = '';
  let done = false;
  try {
    while (!done) {
      let chunk = await reader.read();
      done = chunk.done;
      if (done) {
        break;
      }
      let value = chunk.value;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('renderer bootstrap limit exceeded');
        throw new Error('response exceeds the renderer bootstrap limit');
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export async function secureResponse(response, configuredOrigins, isHTML) {
  let headers = new Headers(response.headers);
  let body = response.body;
  let scriptHashes = [];
  if (isHTML) {
    let html = await readBoundedText(response, maxBootstrapBytes);
    body = html;
    scriptHashes = await inlineScriptHashes(html);
    headers.delete('content-length');
  }
  headers.delete('set-cookie');
  headers.set(
    'Content-Security-Policy',
    rendererCSP(configuredOrigins, scriptHashes),
  );
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  );
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.delete('X-Frame-Options');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set(
    'Cache-Control',
    isHTML ? 'no-store' : 'public, max-age=31536000, immutable',
  );
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function sanitizedParentRequest(request, targetURL) {
  let headers = new Headers(request.headers);
  for (let name of [
    'authorization',
    'cookie',
    'proxy-authorization',
    'x-boxel-token',
  ]) {
    headers.delete(name);
  }
  return new Request(targetURL, {
    method: request.method,
    headers,
    redirect: 'manual',
  });
}

function encodeParentOrigin(origin) {
  return bytesToBase64(new TextEncoder().encode(origin))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function decodeParentOrigin(value) {
  try {
    let padded = value.replaceAll('-', '+').replaceAll('_', '/');
    padded += '='.repeat((4 - (padded.length % 4)) % 4);
    let binary = atob(padded);
    return new TextDecoder().decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    return undefined;
  }
}

export function parentAssetPath(parentOrigin, assetPath) {
  return `${parentAssetPrefix}${encodeParentOrigin(parentOrigin)}${assetPath}`;
}

export function rewriteBootstrapAssetURLs(html, parentOrigin) {
  let prefix = `${parentAssetPrefix}${encodeParentOrigin(parentOrigin)}`;
  let rewritten = html.replace(/(["'])\/assets\//g, `$1${prefix}/assets/`);
  let assetsBootstrap = `<script>globalThis.__boxelAssetsURL=${JSON.stringify(
    `${prefix}/`,
  )}</script>`;
  return rewritten.includes('</head>')
    ? rewritten.replace('</head>', `${assetsBootstrap}</head>`)
    : `${assetsBootstrap}${rewritten}`;
}

function parentAssetRequest(url, configuredOrigins) {
  if (!url.pathname.startsWith(parentAssetPrefix)) {
    return undefined;
  }
  let remainder = url.pathname.slice(parentAssetPrefix.length);
  let assetMarker = remainder.indexOf('/assets/');
  if (assetMarker <= 0) {
    return undefined;
  }
  let parentOrigin = decodeParentOrigin(remainder.slice(0, assetMarker));
  let assetPath = remainder.slice(assetMarker);
  let decodedAssetPath;
  try {
    decodedAssetPath = decodeURIComponent(assetPath);
  } catch {
    return undefined;
  }
  if (
    !parentOrigin ||
    !isAllowedParentOrigin(parentOrigin, configuredOrigins) ||
    !decodedAssetPath.startsWith('/assets/') ||
    decodedAssetPath.includes('..')
  ) {
    return undefined;
  }
  let target = new URL(assetPath + url.search, parentOrigin);
  return { target };
}

async function fetchParent(request, target, parentFetch) {
  let response = await parentFetch(sanitizedParentRequest(request, target));
  if (response.status >= 300 && response.status < 400) {
    return {
      error: json({ error: 'renderer redirects are unavailable' }, 502),
    };
  }
  return { response };
}

async function handleRequest(request, env) {
  let url = new URL(request.url);
  let baseHostname = String(env.SANDBOX_BASE_HOSTNAME ?? '').toLowerCase();
  if (!baseHostname) {
    return json({ error: 'renderer base hostname is not configured' }, 500);
  }
  if (url.hostname === baseHostname) {
    return url.pathname === '/healthz'
      ? json({ service: 'boxel-sandbox-renderer', status: 'ok' })
      : json({ error: 'not found' }, 404);
  }
  if (!isSandboxHostname(url.hostname, baseHostname)) {
    return json({ error: 'invalid sandbox hostname' }, 421);
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    return json({ error: 'method not allowed' }, 405);
  }
  if (
    url.pathname === '/auth-service-worker.js' ||
    url.pathname.endsWith('/service-worker.js') ||
    url.pathname.startsWith('/api/')
  ) {
    return json({ error: 'endpoint unavailable on renderer origin' }, 404);
  }

  let parentFetch = env.PARENT_ASSETS?.fetch
    ? env.PARENT_ASSETS.fetch.bind(env.PARENT_ASSETS)
    : globalThis.fetch;

  let parentAsset = parentAssetRequest(url, env.ALLOWED_PARENT_ORIGINS);
  if (parentAsset) {
    let fetched = await fetchParent(request, parentAsset.target, parentFetch);
    if (fetched.error) {
      return fetched.error;
    }
    let contentType = fetched.response.headers.get('content-type') ?? '';
    if (contentType.toLowerCase().startsWith('text/html')) {
      return json({ error: 'renderer asset returned a document' }, 502);
    }
    return await secureResponse(
      fetched.response,
      env.ALLOWED_PARENT_ORIGINS,
      false,
    );
  }

  let bootstrapParameter = bootstrapPaths.get(url.pathname);
  if (bootstrapParameter) {
    let parentOrigin = url.searchParams.get('parentOrigin') ?? '';
    let bootstrapId = url.searchParams.get(bootstrapParameter) ?? '';
    if (
      !isAllowedParentOrigin(parentOrigin, env.ALLOWED_PARENT_ORIGINS) ||
      !bootstrapIdPattern.test(bootstrapId)
    ) {
      return json({ error: 'invalid renderer bootstrap' }, 400);
    }
    let upstreamURL = new URL(url.pathname + url.search, parentOrigin);
    let fetched = await fetchParent(request, upstreamURL, parentFetch);
    if (fetched.error) {
      return fetched.error;
    }
    let contentType = fetched.response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('text/html')) {
      return json({ error: 'renderer bootstrap is not a document' }, 502);
    }
    let html;
    try {
      html = await readBoundedText(fetched.response, maxBootstrapBytes);
    } catch {
      return json({ error: 'renderer bootstrap is too large' }, 502);
    }
    html = rewriteBootstrapAssetURLs(html, parentOrigin);
    let headers = new Headers(fetched.response.headers);
    headers.delete('content-length');
    return await secureResponse(
      new Response(html, {
        status: fetched.response.status,
        statusText: fetched.response.statusText,
        headers,
      }),
      env.ALLOWED_PARENT_ORIGINS,
      true,
    );
  }
  return json({ error: 'renderer documents are bootstrap-only' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: 'sandbox renderer request failed',
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json({ error: 'sandbox renderer unavailable' }, 500);
    }
  },
};
