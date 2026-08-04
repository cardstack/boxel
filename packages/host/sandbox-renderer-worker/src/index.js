const nonceHostnamePattern = /^[a-f0-9]{32}\.boxelusercontent\.dev$/;
const bootstrapPath = '/_realm-sandbox-frame';

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

function sanitizedAssetRequest(request) {
  let headers = new Headers(request.headers);
  for (let name of [
    'authorization',
    'cookie',
    'proxy-authorization',
    'x-boxel-token',
  ]) {
    headers.delete(name);
  }
  return new Request(request.url, {
    method: request.method,
    headers,
    redirect: 'manual',
  });
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
    }

    let response = await env.ASSETS.fetch(sanitizedAssetRequest(request));
    if (response.status >= 300 && response.status < 400) {
      return json({ error: 'renderer asset redirects are unavailable' }, 502);
    }
    let contentType = response.headers.get('content-type') ?? '';
    let isHTML = contentType.toLowerCase().startsWith('text/html');
    if (isHTML && !isBootstrap) {
      return json({ error: 'renderer documents are bootstrap-only' }, 404);
    }
    return secureResponse(response, env.ALLOWED_PARENT_ORIGINS, isHTML);
  },
};
