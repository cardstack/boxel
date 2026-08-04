const nonceHostnamePattern = /^[a-f0-9]{32}\.boxelusercontent\.dev$/;
const bootstrapPath = '/_realm-sandbox-frame';
const parentAssetPrefix = '/_boxel-parent/';

export function isSandboxHostname(hostname) {
  return nonceHostnamePattern.test(hostname.toLowerCase());
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
    // The bundled content-tag runtime loads its WASM with fetch(). Restrict
    // that boot-time request to this nonce origin; the Worker exposes only
    // immutable renderer assets here and rejects API/auth endpoints.
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob:${scriptHashes ? ` ${scriptHashes}` : ''}`,
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

export async function secureResponse(response, configuredOrigins, isHTML) {
  let headers = new Headers(response.headers);
  let body = response.body;
  let scriptHashes = [];
  if (isHTML) {
    let html = await response.text();
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
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function sanitizedAssetRequest(request, targetURL = request.url) {
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
  let bytes = new TextEncoder().encode(origin);
  return bytesToBase64(bytes)
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
  // Vite's production entrypoint, module preloads, stylesheets, and all of
  // their relative imports now stay on the nonce origin while being fetched
  // from the exact build that served the parent. This prevents a branch
  // preview parent from speaking a newer protocol to a stale renderer bundle.
  let rewritten = html.replace(/(["'])\/assets\//g, `$1${prefix}/assets/`);
  let assetsBootstrap = `<script>globalThis.__boxelAssetsURL=${JSON.stringify(`${prefix}/`)}</script>`;
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
  if (
    !parentOrigin ||
    !isAllowedParentOrigin(parentOrigin, configuredOrigins) ||
    !assetPath.startsWith('/assets/') ||
    assetPath.includes('..')
  ) {
    return undefined;
  }
  let target = new URL(assetPath + url.search, parentOrigin);
  return { parentOrigin, target };
}

export default {
  async fetch(request, env) {
    let url = new URL(request.url);
    if (url.hostname === 'boxelusercontent.dev') {
      return url.pathname === '/healthz'
        ? json({ service: 'boxel-sandbox-renderer', status: 'ok' })
        : json({ error: 'not found' }, 404);
    }
    if (!isSandboxHostname(url.hostname)) {
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
      let response = await parentFetch(
        sanitizedAssetRequest(request, parentAsset.target),
      );
      if (response.status >= 300 && response.status < 400) {
        return json({ error: 'renderer asset redirects are unavailable' }, 502);
      }
      let contentType = response.headers.get('content-type') ?? '';
      if (contentType.toLowerCase().startsWith('text/html')) {
        return json({ error: 'renderer asset returned a document' }, 502);
      }
      return secureResponse(response, env.ALLOWED_PARENT_ORIGINS, false);
    }

    let isBootstrap = url.pathname === bootstrapPath;
    if (isBootstrap) {
      let parentOrigin = url.searchParams.get('parentOrigin') ?? '';
      let bootstrapID = url.searchParams.get('bootstrapID') ?? '';
      if (
        !isAllowedParentOrigin(parentOrigin, env.ALLOWED_PARENT_ORIGINS) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          bootstrapID,
        )
      ) {
        return json({ error: 'invalid renderer bootstrap' }, 400);
      }
      let upstreamURL = new URL(url.pathname + url.search, parentOrigin);
      let response = await parentFetch(
        sanitizedAssetRequest(request, upstreamURL),
      );
      if (response.status >= 300 && response.status < 400) {
        return json(
          { error: 'renderer bootstrap redirects are unavailable' },
          502,
        );
      }
      let contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().startsWith('text/html')) {
        return json({ error: 'renderer bootstrap is not a document' }, 502);
      }
      let html = rewriteBootstrapAssetURLs(await response.text(), parentOrigin);
      let headers = new Headers(response.headers);
      headers.delete('content-length');
      return secureResponse(
        new Response(html, {
          status: response.status,
          statusText: response.statusText,
          headers,
        }),
        env.ALLOWED_PARENT_ORIGINS,
        true,
      );
    }
    return json({ error: 'renderer documents are bootstrap-only' }, 404);
  },
};
