import type Koa from 'koa';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { logger } from '@cardstack/runtime-common';
import { registerSecureOriginHost } from './secure-origin-telemetry.ts';

// The secure origin is where a user types a credential: a page on an origin
// that card code can't reach, so the same-origin policy keeps what is typed
// there out of the app page and every card evaluated in it. It is only as
// isolated as what else it serves, so it serves the pages in `secure-origin/`
// — the shell, and the credential fields the app frames — and nothing else.
// No realm, card module, realm asset or host app bundle is ever reachable on
// it: every request on the origin is answered here, ahead of all other
// routing, and anything that isn't one of those pages or their files is a
// 404.
//
// Deployed, the origin is its own hostname routed to the realm-server, and
// requests are told apart by their Host. In development it is a dedicated
// port the realm-server listens on, which serves this and nothing else.

const SHELL_DIR = join(import.meta.dirname, '..', 'secure-origin');
const SHELL_BASE_PLACEHOLDER = /%SHELL_BASE%/g;
const MATRIX_URL_PLACEHOLDER = /%MATRIX_URL%/g;
const APP_ORIGINS_PLACEHOLDER = /%APP_ORIGINS%/g;

// The typeface the app's forms are set in, served by the secure origin itself
// so the credential fields it frames match the page around them. It comes from
// boxel-ui, where the app gets it, so the two can't drift apart.
const BOXEL_UI_STYLES_DIR = dirname(
  createRequire(import.meta.url).resolve(
    '@cardstack/boxel-ui/styles/fonts.css',
  ),
);

// The shell's static files, by the path they are served at beneath the shell.
const SHELL_ASSETS: Record<string, { file: string; contentType: string }> = {
  'shell.js': {
    file: 'shell.js',
    contentType: 'text/javascript; charset=utf-8',
  },
  'shell.css': { file: 'shell.css', contentType: 'text/css; charset=utf-8' },
};

// The credential fields the app frames (see `credentials.js`): the page, by
// the path beneath the shell it is served at, and its static files.
const CREDENTIALS_PATH = 'credentials';
const CREDENTIALS_ASSETS: Record<
  string,
  { file: string; contentType: string }
> = {
  'credentials.js': {
    file: join(SHELL_DIR, 'credentials.js'),
    contentType: 'text/javascript; charset=utf-8',
  },
  'app-origins.js': {
    file: join(SHELL_DIR, 'app-origins.js'),
    contentType: 'text/javascript; charset=utf-8',
  },
  'credentials.css': {
    file: join(SHELL_DIR, 'credentials.css'),
    contentType: 'text/css; charset=utf-8',
  },
  'IBMPlexSansVar-Roman.woff2': {
    file: join(BOXEL_UI_STYLES_DIR, 'IBMPlexSansVar-Roman.woff2'),
    contentType: 'font/woff2',
  },
};

const log = logger('realm:secure-origin');

export interface SecureOriginHeaderOptions {
  // Origins allowed to frame the response. Empty — the default — means none
  // may.
  frameAncestors?: string[];
  // Origins a document may send requests to besides its own. Empty — the
  // default — means only its own.
  connectSrc?: string[];
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
  connectSrc = [],
}: SecureOriginHeaderOptions = {}): Record<string, string> {
  let headers: Record<string, string> = {
    'Content-Security-Policy': [
      `default-src 'self'`,
      ...(connectSrc.length > 0
        ? [`connect-src 'self' ${connectSrc.join(' ')}`]
        : []),
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

export interface CredentialFieldsOptions {
  // The Matrix server the credential fields sign in to and change passwords
  // on. It is the only server a password typed into them is ever sent to, so
  // it comes from the realm server's own configuration, never from the page
  // that frames them.
  matrixURL: URL;
  // Origins of the app pages that may frame the credential fields, and the
  // only ones the fields talk to.
  appOrigins: string[];
}

// `url` is where the shell is served: its host is the secure origin and its
// path is the shell's (`https://secure.boxel.ai/`, or
// `https://localhost:4208/secure` in development). With `credentialFields`,
// the origin also serves the credential fields the app frames, at
// `credentials` beneath the shell.
export function createSecureOrigin(
  url: URL,
  credentialFields?: CredentialFieldsOptions,
): SecureOrigin {
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
  if (credentialFields) {
    addCredentialFieldRoutes(routes, shellBase, credentialFields);
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

// The credential fields are the one document the app frames, so their page
// alone names the app's origins in `frame-ancestors`, and names the Matrix
// server in `connect-src`. Their script, stylesheet and font are loaded by
// that page, never framed, and keep the locked-down defaults.
function addCredentialFieldRoutes(
  routes: Map<string, SecureOriginRoute>,
  shellBase: string,
  { matrixURL, appOrigins }: CredentialFieldsOptions,
) {
  let origins = appOrigins.map((origin) => {
    let parsed = new URL(origin).origin;
    if (parsed === 'null') {
      throw new Error(`secure origin: ${origin} is not an app origin`);
    }
    return parsed;
  });
  if (origins.length === 0) {
    throw new Error(`secure origin: credential fields need an app origin`);
  }
  let base = `${shellBase}/${CREDENTIALS_PATH}`;
  let html = readFileSync(join(SHELL_DIR, 'credentials.html'), 'utf8')
    .replace(SHELL_BASE_PLACEHOLDER, escapeAttribute(shellBase))
    .replace(MATRIX_URL_PLACEHOLDER, escapeAttribute(matrixURL.href))
    .replace(APP_ORIGINS_PLACEHOLDER, escapeAttribute(origins.join(' ')));
  routes.set(base, {
    body: html,
    contentType: 'text/html; charset=utf-8',
    headers: {
      frameAncestors: origins,
      connectSrc: [matrixURL.origin],
    },
  });
  for (let [name, { file, contentType }] of Object.entries(
    CREDENTIALS_ASSETS,
  )) {
    routes.set(`${shellBase}/${name}`, {
      body: readFileSync(file),
      contentType,
    });
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
