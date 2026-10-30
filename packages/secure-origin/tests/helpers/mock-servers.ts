// The Matrix server and the realm server, as the component tests' pages
// reach them: the page finds both from its markup, so their meta tags are
// added to the test page, and `fetch` answers each request from the handler
// a test gives for its method and path. A request no handler answers fails
// the test, so a page that asks for something unexpected is caught.

import { waitedFetch } from './waiters.ts';

export const MATRIX_URL = 'https://matrix.example.test/';
export const REALM_SERVER_URL = 'https://realm-server.example.test/';

export interface SeenRequest {
  server: 'matrix' | 'realm-server';
  method: string;
  path: string;
  authorization: string | undefined;
  body: any;
}

// A handler's answer: a JSON body for a 200, `{ status, body }` for any other
// status, `{ network: 'down' }` for a request that never reaches the server,
// or a promise of one of these, for a response the test lets through later.
export type Answer =
  | Record<string, unknown>
  | { status: number; body: unknown }
  | { network: 'down' };

type Handler = (body: any) => Answer | Promise<Answer>;

export interface MockServers {
  // `route` is a method and a path on the server, such as
  // `POST register` (Matrix client API) or `GET _secure-origin`.
  matrix(route: string, handler: Handler): void;
  realmServer(route: string, handler: Handler): void;
  requests(server: SeenRequest['server'], route?: string): SeenRequest[];
}

const MATRIX_API = `${MATRIX_URL}_matrix/client/v3/`;

function isStatusAnswer(
  answer: Answer,
): answer is { status: number; body: unknown } {
  return typeof (answer as { status?: unknown }).status === 'number';
}

// Installs the servers for each test of a module.
export function setupMockServers(hooks: NestedHooks): MockServers {
  let handlers = new Map<string, Handler>();
  let seen: SeenRequest[] = [];
  let originalFetch: typeof fetch;
  let metas: HTMLMetaElement[] = [];

  hooks.beforeEach(function () {
    handlers.clear();
    seen = [];
    for (let [name, content] of [
      ['boxel-matrix-url', MATRIX_URL],
      ['boxel-realm-server-url', REALM_SERVER_URL],
    ]) {
      let meta = document.createElement('meta');
      meta.name = name;
      meta.content = content;
      document.head.append(meta);
      metas.push(meta);
    }
    originalFetch = window.fetch;
    window.fetch = waitedFetch(async (input, init = {}) => {
      let url = new URL(String(input));
      let server: SeenRequest['server'];
      let path: string;
      if (url.href.startsWith(MATRIX_API)) {
        server = 'matrix';
        path = url.href.slice(MATRIX_API.length).split('?')[0]!;
      } else if (url.href.startsWith(REALM_SERVER_URL)) {
        server = 'realm-server';
        path = url.href.slice(REALM_SERVER_URL.length).split('?')[0]!;
      } else {
        throw new Error(`the page fetched ${url.href}, which no test serves`);
      }
      let method = init.method ?? 'GET';
      let headers = (init.headers ?? {}) as Record<string, string>;
      let body = init.body ? JSON.parse(String(init.body)) : undefined;
      seen.push({
        server,
        method,
        path,
        authorization: headers.Authorization,
        body,
      });
      let handler = handlers.get(`${server} ${method} ${path}`);
      if (!handler) {
        throw new Error(`no test handler for ${server} ${method} ${path}`);
      }
      let answer = await handler(body);
      if ('network' in answer) {
        throw new TypeError('Failed to fetch');
      }
      let { status, body: json } = isStatusAnswer(answer)
        ? answer
        : { status: 200, body: answer };
      return new Response(JSON.stringify(json), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  hooks.afterEach(function () {
    window.fetch = originalFetch;
    for (let meta of metas) {
      meta.remove();
    }
    metas = [];
  });

  return {
    matrix(route, handler) {
      handlers.set(`matrix ${route}`, handler);
    },
    realmServer(route, handler) {
      handlers.set(`realm-server ${route}`, handler);
    },
    requests(server, route) {
      return seen.filter(
        (request) =>
          request.server === server &&
          (!route || `${request.method} ${request.path}` === route),
      );
    },
  };
}

// The 401 a user-interactive auth request is answered with while a stage
// remains.
export function interactiveAuth(
  completed: string[],
  flows = [
    { stages: ['m.login.registration_token', 'm.login.email.identity'] },
  ],
): Answer {
  return {
    status: 401,
    body: { session: 'session-1', flows, completed, params: {} },
  };
}

// The realm server's answer to a sign-in.
export function secureSession(user: string, token = 'secure-token-1'): Answer {
  return {
    status: 201,
    body: {
      data: {
        type: 'secure-session',
        attributes: { token, user, expiresAt: '2099-01-01T00:00:00.000Z' },
      },
    },
  };
}

// Keeps the test page's address as it was: the pages replace it as they
// would their own.
export function setupPageAddress(hooks: NestedHooks) {
  let address: string;
  hooks.beforeEach(function () {
    address = window.location.href;
  });
  hooks.afterEach(function () {
    history.replaceState(null, '', address);
  });
}

// Records the forms a page submits instead of letting them navigate the test
// page away: the CLI hand-off posts a form to the CLI's loopback listener.
export function setupFormSubmits(hooks: NestedHooks): HTMLFormElement[] {
  let submitted: HTMLFormElement[] = [];
  let original: HTMLFormElement['submit'];
  hooks.beforeEach(function () {
    submitted.length = 0;
    original = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
      submitted.push(this);
    };
  });
  hooks.afterEach(function () {
    HTMLFormElement.prototype.submit = original;
    for (let form of submitted) {
      form.remove();
    }
  });
  return submitted;
}
