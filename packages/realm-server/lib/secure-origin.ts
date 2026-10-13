import type Koa from 'koa';
import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '@cardstack/runtime-common';
import { registerSecureOriginHost } from './secure-origin-telemetry.ts';

// The secure origin is where a user types a credential: a page on an origin
// that card code can't reach, so the same-origin policy keeps what is typed
// there out of the app page and every card evaluated in it. It is only as
// isolated as what else it serves, so it serves the page shell in
// `secure-origin/` and nothing else. No realm, card module, realm asset or
// host app bundle is ever reachable on it: every request on the origin is
// answered here, ahead of all other routing, and anything that isn't the
// shell is a 404.
//
// Deployed, the origin is its own hostname routed to the realm-server, and
// requests are told apart by their Host. In development it is a dedicated
// port the realm-server listens on, which serves this and nothing else.

const SHELL_DIR = join(import.meta.dirname, '..', 'secure-origin');
const SHELL_BASE_PLACEHOLDER = /%SHELL_BASE%/g;

// The shell's static files, by the path they are served at beneath the shell.
const SHELL_ASSETS: Record<string, { file: string; contentType: string }> = {
  'shell.js': {
    file: 'shell.js',
    contentType: 'text/javascript; charset=utf-8',
  },
  'shell.css': { file: 'shell.css', contentType: 'text/css; charset=utf-8' },
};

const log = logger('realm:secure-origin');

export interface SecureOriginHeaderOptions {
  // Origins allowed to frame the response. Empty — the default — means none
  // may.
  frameAncestors?: string[];
}

// Headers on every response the secure origin sends, error responses
// included. A document the app frames is served at a path of its own, never
// the shell's, and that route alone passes the app's origin in
// `frameAncestors`; `X-Frame-Options` can't name an origin, so it is sent only
// when no framing is allowed.
//
// `Cross-Origin-Opener-Policy` severs the handle the page that opened a
// secure window keeps to it. Same-origin policy already stops that page
// reading the window, but not navigating it: without this, card code in the
// app could swap the window for a look-alike partway through a credential
// flow. It also cuts `postMessage` back to the opener, which no mode uses —
// a mode never takes input from the page that opened it.
export function secureOriginHeaders({
  frameAncestors = [],
}: SecureOriginHeaderOptions = {}): Record<string, string> {
  let headers: Record<string, string> = {
    'Content-Security-Policy': [
      `default-src 'self'`,
      `object-src 'none'`,
      `base-uri 'none'`,
      `form-action 'self'`,
      `frame-ancestors ${
        frameAncestors.length > 0 ? frameAncestors.join(' ') : `'none'`
      }`,
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  };
  if (frameAncestors.length === 0) {
    headers['X-Frame-Options'] = 'DENY';
  }
  return headers;
}

interface SecureOriginRoute {
  body: string | Buffer;
  contentType: string;
  // Unset, the locked-down defaults.
  headers?: SecureOriginHeaderOptions;
}

export interface SecureOrigin {
  url: URL;
  // Whether a request on the realm-server's shared listener is addressed to
  // the secure origin.
  matches(ctx: Koa.Context): boolean;
  // Answers any request on the secure origin. Never reads a request body and
  // never passes control on.
  handle(ctx: Koa.Context): Promise<void>;
}

// `url` is where the shell is served: its host is the secure origin and its
// path is the shell's (`https://secure.boxel.ai/`, or
// `https://localhost:4208/secure` in development).
export function createSecureOrigin(url: URL): SecureOrigin {
  let shellBase = url.pathname.replace(/\/+$/, '');
  let indexHTML = readFileSync(join(SHELL_DIR, 'index.html'), 'utf8').replace(
    SHELL_BASE_PLACEHOLDER,
    shellBase,
  );
  // Everything the origin serves, by path, each with the headers its
  // response carries.
  let routes = new Map<string, SecureOriginRoute>();
  let shell: SecureOriginRoute = {
    body: indexHTML,
    contentType: 'text/html; charset=utf-8',
  };
  routes.set(shellBase, shell);
  routes.set(`${shellBase}/`, shell);
  for (let [name, { file, contentType }] of Object.entries(SHELL_ASSETS)) {
    routes.set(`${shellBase}/${name}`, {
      body: readFileSync(join(SHELL_DIR, file)),
      contentType,
    });
  }
  let expectedHost = url.host.toLowerCase();
  registerSecureOriginHost(expectedHost);

  function respond(
    ctx: Koa.Context,
    status: number,
    body: string | Buffer,
    contentType: string,
    headerOptions?: SecureOriginHeaderOptions,
  ) {
    ctx.set(secureOriginHeaders(headerOptions));
    ctx.status = status;
    // Koa sends a HEAD response's headers and leaves out the body.
    ctx.body = body;
    ctx.type = contentType;
  }

  function route(ctx: Koa.Context) {
    let match = routes.get(ctx.path);
    if (!match) {
      respond(ctx, 404, 'Not Found', 'text/plain; charset=utf-8');
      return;
    }
    if (ctx.method !== 'GET' && ctx.method !== 'HEAD') {
      ctx.set('Allow', 'GET, HEAD');
      respond(ctx, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
      return;
    }
    respond(ctx, 200, match.body, match.contentType, match.headers);
  }

  return {
    url,
    matches(ctx) {
      let host = ctx.host.toLowerCase();
      if (host === expectedHost) {
        return true;
      }
      // A Host header may carry the scheme's default port explicitly.
      try {
        return new URL(`${url.protocol}//${host}`).host === expectedHost;
      } catch {
        return false;
      }
    },
    async handle(ctx) {
      // Logged by path alone: the query string, headers and body of a request
      // here can carry a credential or the ticket that authorizes one. The
      // shipped log line doesn't carry the logger's name, so the line names
      // the origin itself, which is what a log search filters on.
      let startedAt = Date.now();
      try {
        route(ctx);
      } catch (e: any) {
        // Handled here rather than rethrown so the app's error handler, which
        // reports the request to Sentry, never sees a secure-origin request.
        log.error(`secure origin failed to answer: ${e?.message ?? e}`);
        respond(ctx, 500, 'Internal Server Error', 'text/plain; charset=utf-8');
      }
      log.info(
        `secure-origin ${ctx.method} ${ctx.path}: ${ctx.status} dur=${Date.now() - startedAt}ms`,
      );
    },
  };
}

// First in the realm-server's middleware chain: a request addressed to the
// secure origin is answered by it and goes no further — not to CORS, request
// logging, the routes table, or any realm.
export function secureOriginGate(
  secureOrigin: SecureOrigin | undefined,
): Koa.Middleware {
  return async (ctx, next) => {
    if (secureOrigin?.matches(ctx)) {
      await secureOrigin.handle(ctx);
      return;
    }
    await next();
  };
}
