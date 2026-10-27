import type Koa from 'koa';
import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, extname, join } from 'path';
import { logger } from '@cardstack/runtime-common';
import { registerSecureOriginHost } from './request-telemetry.ts';
import { parseListedOrigin } from '@cardstack/secure-origin/security/app-origins.js';
import {
  PAGE_PATHS,
  keyOfSharePath,
} from '@cardstack/secure-origin/shell/pages.js';

// The secure origin is where a user types a credential: a page on an origin
// that card code can't reach, so the same-origin policy keeps what is typed
// there out of the app page and every card evaluated in it. It is only as
// isolated as what else it serves, so it serves the pages `packages/secure-origin`
// builds — the shell, and the credential fields the app frames — and nothing
// else.
// No realm, card module, realm asset or host app bundle is ever reachable on
// it: every request on the origin is answered here, ahead of all other
// routing, and anything that isn't one of those pages or their files is a
// 404.
//
// Deployed, the origin is its own hostname routed to the realm-server, and
// requests are told apart by their Host. In development it is a dedicated
// port the realm-server listens on, which serves this and nothing else.

const MATRIX_URL_PLACEHOLDER = /%MATRIX_URL%/g;
const APP_ORIGINS_PLACEHOLDER = /%APP_ORIGINS%/g;
const REALM_SERVER_URL_PLACEHOLDER = /%REALM_SERVER_URL%/g;

// Where Google sends the secure window back to after a sign-in, beneath the
// shell: one of the shell's pages.
export const GOOGLE_CALLBACK_PATH = 'google-callback';

// Where the sign-in page hands a session to the CLI: a listener on this
// machine's loopback address, on whatever port the CLI chose.
const CLI_LOOPBACK_FORM_ACTION = 'http://127.0.0.1:*';

// The entry documents `packages/secure-origin` builds: the shell, and the
// credential fields the app frames, which are served at `credentials`
// beneath the shell.
const SHELL_DOCUMENT = 'index.html';
const CREDENTIALS_DOCUMENT = 'credentials.html';
const CREDENTIALS_PATH = 'credentials';

// The typeface the app's forms are set in, and boxel-ui's design tokens,
// served by the secure origin itself so its pages, and the credential fields
// it frames, match the app's. They come from boxel-ui, where the app gets
// them, so the two can't drift apart. They are the only files the origin
// serves that its build doesn't emit.
const BOXEL_UI_ASSETS = [
  'variables.css',
  'theme.css',
  'IBMPlexSansVar-Roman.woff2',
];

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
};

interface SecureOriginFile {
  body: string | Buffer;
  contentType: string;
}

// The secure origin's build, read once, at startup: each entry document and
// the files it loads, as its manifest lists them, with the placeholder base
// the build writes asset URLs under replaced by the shell's path. Nothing is
// built or read at request time.
function readSecureOriginBuild(shellBase: string): {
  entries: Record<string, string[]>;
  files: Map<string, SecureOriginFile>;
} {
  let packageDir = dirname(
    createRequire(import.meta.url).resolve(
      '@cardstack/secure-origin/package.json',
    ),
  );
  let distDir = join(packageDir, 'dist');
  let manifestFile = join(distDir, 'manifest.json');
  if (!existsSync(manifestFile)) {
    throw new Error(
      `secure origin: ${distDir} holds no build. Build it with \`pnpm --dir=packages/secure-origin build\` before starting the realm server.`,
    );
  }
  let { base, entries }: { base: string; entries: Record<string, string[]> } =
    JSON.parse(readFileSync(manifestFile, 'utf8'));
  // Replaced wherever it appears, so it must be a placeholder no page could
  // spell by chance.
  if (!/^\/__[A-Z_]+__\/$/.test(base)) {
    throw new Error(
      `secure origin: the build's base ${base} is not a placeholder`,
    );
  }
  let files = new Map<string, SecureOriginFile>();
  for (let name of new Set(Object.values(entries).flat())) {
    let contentType = CONTENT_TYPES[extname(name)];
    if (!contentType || name.includes('..') || name.startsWith('/')) {
      throw new Error(
        `secure origin: the build emits ${name}, which it may not serve`,
      );
    }
    let body: string | Buffer = readFileSync(join(distDir, name));
    if (contentType.startsWith('text/')) {
      body = body
        .toString('utf8')
        .replaceAll(
          base,
          `${contentType.startsWith('text/html') ? escapeAttribute(shellBase) : shellBase}/`,
        );
    }
    files.set(name, { body, contentType });
  }
  for (let document of [SHELL_DOCUMENT, CREDENTIALS_DOCUMENT]) {
    if (!entries[document]?.includes(document)) {
      throw new Error(`secure origin: the build has no ${document}`);
    }
  }
  return { entries, files };
}

function boxelUIAssets(): Map<string, SecureOriginFile> {
  let stylesDir = dirname(
    createRequire(import.meta.url).resolve(
      '@cardstack/boxel-ui/styles/fonts.css',
    ),
  );
  return new Map(
    BOXEL_UI_ASSETS.map((name) => [
      name,
      {
        body: readFileSync(join(stylesDir, name)),
        contentType: CONTENT_TYPES[extname(name)],
      },
    ]),
  );
}

const log = logger('realm:secure-origin');

export interface SecureOriginHeaderOptions {
  // Origins allowed to frame the response. Empty — the default — means none
  // may.
  frameAncestors?: string[];
  // Origins a document may send requests to besides its own. Empty — the
  // default — means only its own.
  connectSrc?: string[];
  // Where a document's forms may submit besides its own origin. Empty — the
  // default — means only its own.
  formAction?: string[];
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
// flow. It also cuts `postMessage` back to the opener, which no page uses —
// a page never takes input from the page that opened it.
export function secureOriginHeaders({
  frameAncestors = [],
  connectSrc = [],
  formAction = [],
}: SecureOriginHeaderOptions = {}): Record<string, string> {
  let headers: Record<string, string> = {
    'Content-Security-Policy': [
      `default-src 'self'`,
      ...(connectSrc.length > 0
        ? [`connect-src 'self' ${connectSrc.join(' ')}`]
        : []),
      `object-src 'none'`,
      `base-uri 'none'`,
      `form-action 'self'${formAction.map((source) => ` ${source}`).join('')}`,
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
  // on. With the realm server, it is the only server a password typed into
  // them is ever sent to, so it comes from the realm server's own
  // configuration, never from the page that frames them.
  matrixURL: URL;
  // The realm server, which a changed password's new password is sent to so
  // it can end the account's secure sessions.
  realmServerURL: URL;
  // Origins of the app pages that may frame the credential fields, and the
  // only ones the fields talk to.
  appOrigins: string[];
}

export interface ShellOptions {
  // The realm server the shell's pages sign in to and act on. It comes from
  // the realm server's own configuration, never from the page.
  realmServerURL: URL;
  // The Matrix server the shell's pages create accounts on and reset
  // passwords with. With the realm server, it is the only server the shell
  // talks to, and it too comes from the realm server's configuration.
  matrixURL?: URL;
}

// `url` is where the shell is served: its host is the secure origin and its
// path is the shell's (`https://secure.boxel.ai/`, or
// `https://localhost:4208/secure` in development). With `credentialFields`,
// the origin also serves the credential fields the app frames, at
// `credentials` beneath the shell. With `shellOptions`, the shell's pages talk
// to the realm server and the Matrix server it names, and the sign-in page may
// hand a session to the CLI's loopback listener.
export function createSecureOrigin(
  url: URL,
  credentialFields?: CredentialFieldsOptions,
  shellOptions?: ShellOptions,
): SecureOrigin {
  let shellBase = url.pathname.replace(/\/+$/, '');
  let build = readSecureOriginBuild(shellBase);
  let indexHTML = String(build.files.get(SHELL_DOCUMENT)!.body)
    .replace(
      REALM_SERVER_URL_PLACEHOLDER,
      escapeAttribute(shellOptions?.realmServerURL.href ?? ''),
    )
    .replace(
      MATRIX_URL_PLACEHOLDER,
      escapeAttribute(shellOptions?.matrixURL?.href ?? ''),
    )
    // The app origins a sign-in started by the app may be handed back to:
    // the same list the credential fields may be framed by.
    .replace(
      APP_ORIGINS_PLACEHOLDER,
      escapeAttribute(
        (credentialFields?.appOrigins ?? []).map(appOrigin).join(' '),
      ),
    );
  // Everything the origin serves, by path, each with the headers its
  // response carries.
  let routes = new Map<string, SecureOriginRoute>();
  let shell: SecureOriginRoute = {
    body: indexHTML,
    contentType: 'text/html; charset=utf-8',
    ...(shellOptions
      ? {
          headers: {
            connectSrc: [
              shellOptions.realmServerURL.origin,
              ...(shellOptions.matrixURL
                ? [shellOptions.matrixURL.origin]
                : []),
            ],
            formAction: [CLI_LOOPBACK_FORM_ACTION],
          },
        }
      : {}),
  };
  // The shell is one document at its own address and at each of its pages'
  // paths (`PAGE_PATHS`, and a key's share page at `keys/<key id>/share`,
  // matched in `route`); its router shows the page the path names.
  routes.set(shellBase, shell);
  routes.set(`${shellBase}/`, shell);
  for (let page of PAGE_PATHS) {
    routes.set(`${shellBase}/${page}`, shell);
  }
  addFileRoutes(routes, shellBase, [
    ...build.entries[SHELL_DOCUMENT].filter(
      (name) => name !== SHELL_DOCUMENT,
    ).map((name): [string, SecureOriginFile] => [name, build.files.get(name)!]),
    ...boxelUIAssets(),
  ]);
  if (credentialFields) {
    addCredentialFieldRoutes(routes, shellBase, build, credentialFields);
  }
  function keySharePage(path: string) {
    return path.startsWith(`${shellBase}/`) &&
      keyOfSharePath(path.slice(shellBase.length + 1))
      ? shell
      : undefined;
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
    let match = routes.get(ctx.path) ?? keySharePage(ctx.path);
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
// server and the realm server in `connect-src`. Their script, stylesheet and
// font are loaded by that page, never framed, and keep the locked-down
// defaults.
function addCredentialFieldRoutes(
  routes: Map<string, SecureOriginRoute>,
  shellBase: string,
  build: ReturnType<typeof readSecureOriginBuild>,
  { matrixURL, realmServerURL, appOrigins }: CredentialFieldsOptions,
) {
  let origins = appOrigins.map(appOrigin);
  if (origins.length === 0) {
    throw new Error(`secure origin: credential fields need an app origin`);
  }
  let html = String(build.files.get(CREDENTIALS_DOCUMENT)!.body)
    .replace(MATRIX_URL_PLACEHOLDER, escapeAttribute(matrixURL.href))
    .replace(REALM_SERVER_URL_PLACEHOLDER, escapeAttribute(realmServerURL.href))
    .replace(APP_ORIGINS_PLACEHOLDER, escapeAttribute(origins.join(' ')));
  routes.set(`${shellBase}/${CREDENTIALS_PATH}`, {
    body: html,
    contentType: 'text/html; charset=utf-8',
    headers: {
      frameAncestors: origins,
      connectSrc: [matrixURL.origin, realmServerURL.origin],
    },
  });
  addFileRoutes(
    routes,
    shellBase,
    build.entries[CREDENTIALS_DOCUMENT].filter(
      (name) => name !== CREDENTIALS_DOCUMENT,
    ).map((name) => [name, build.files.get(name)!]),
  );
}

// The files a page loads, each at its name beneath the shell, with the
// locked-down default headers: they are loaded, never framed. A file the
// shell and the credential fields share is served once.
function addFileRoutes(
  routes: Map<string, SecureOriginRoute>,
  shellBase: string,
  files: Iterable<[string, SecureOriginFile]>,
) {
  for (let [name, file] of files) {
    let path = `${shellBase}/${name}`;
    let existing = routes.get(path);
    if (existing && existing.body !== file.body) {
      throw new Error(`secure origin: two files would be served at ${path}`);
    }
    routes.set(path, { body: file.body, contentType: file.contentType });
  }
}

// An app origin as the credential fields' page and `frame-ancestors` name
// it. A host starting with `*.` stands for every subdomain of the rest, and a
// port of `*` for every port of the host, such as `http://localhost:*` for a
// host app served from this machine on whatever port it was started on.
// Anything that isn't a single origin of that shape, such as a bare `*`, a
// scheme alone, or a path, is refused rather than widened.
export function appOrigin(origin: string): string {
  let anyPort = origin.endsWith(':*');
  let rest = anyPort ? origin.slice(0, -2) : origin;
  let url: URL;
  try {
    url = new URL(rest);
  } catch {
    throw new Error(`secure origin: ${origin} is not an app origin`);
  }
  // Compared as written, so a port or a slash before the `*` is refused even
  // where the URL parser would drop it as the scheme's default.
  if (url.origin === 'null' || (anyPort && rest.toLowerCase() !== url.origin)) {
    throw new Error(`secure origin: ${origin} is not an app origin`);
  }
  let normalized = anyPort ? `${url.origin}:*` : url.origin;
  if (normalized.includes('*') && !parseListedOrigin(normalized)) {
    throw new Error(`secure origin: ${origin} is not an app origin`);
  }
  return normalized;
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
