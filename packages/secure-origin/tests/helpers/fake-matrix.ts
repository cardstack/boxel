// A Matrix server for the security modules' tests, answering the requests
// `src/security/matrix.js` makes through a stubbed `fetch`. The modules find
// the server from the page's markup, so a `document` naming it is stubbed
// too.

const MATRIX_URL = 'https://matrix.test/';
const CLIENT_API = `${MATRIX_URL}_matrix/client/v3/`;

export interface MatrixRequest {
  path: string;
  method: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

// A handler's answer: a JSON body for a 200, `{ status, body }` for any other
// status, or `{ network: 'down' }` for a request that never reaches the
// server.
type Answer =
  | Record<string, unknown>
  | { status: number; body: Record<string, unknown> }
  | { network: 'down' };

export interface FakeMatrix {
  on(path: string, handler: (body: Record<string, unknown>) => Answer): void;
  requests(path: string): MatrixRequest[];
  restore(): void;
}

// The 401 a user-interactive auth request is answered with while a stage
// remains. `error` is the server's reason for refusing the last attempt.
export function interactiveAuth(
  completed: string[],
  error?: string,
  flows = [
    { stages: ['m.login.registration_token', 'm.login.email.identity'] },
  ],
): Answer {
  return {
    status: 401,
    body: {
      session: 'session-1',
      flows,
      completed,
      params: {},
      ...(error ? { errcode: 'M_UNAUTHORIZED', error } : {}),
    },
  };
}

export function fakeMatrix(): FakeMatrix {
  let handlers = new Map<string, (body: Record<string, unknown>) => Answer>();
  let seen: MatrixRequest[] = [];
  let globals = globalThis as Record<string, unknown>;
  let originalFetch = globals.fetch;
  let originalDocument = globals.document;

  globals.document = {
    querySelector(selector: string) {
      return selector === 'meta[name="boxel-matrix-url"]'
        ? { getAttribute: () => MATRIX_URL }
        : null;
    },
  };
  globals.fetch = async (input: URL | string, init: RequestInit = {}) => {
    let url = new URL(String(input));
    if (!url.href.startsWith(CLIENT_API)) {
      throw new TypeError(`fetch to ${url.href}, which is not the Matrix API`);
    }
    let path = url.href.slice(CLIENT_API.length).split('?')[0];
    let headers = (init.headers ?? {}) as Record<string, string>;
    let body = init.body ? JSON.parse(String(init.body)) : {};
    seen.push({
      path,
      method: init.method ?? 'GET',
      authorization: headers.Authorization,
      body,
    });
    let handler = handlers.get(path);
    if (!handler) {
      throw new Error(`no fake Matrix handler for ${path}`);
    }
    let answer = handler(body);
    if ('network' in answer) {
      throw new TypeError('Failed to fetch');
    }
    let { status, body: json } =
      typeof answer.status === 'number' && 'body' in answer
        ? (answer as { status: number; body: Record<string, unknown> })
        : { status: 200, body: answer };
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    on(path, handler) {
      handlers.set(path, handler);
    },
    requests(path) {
      return seen.filter((request) => request.path === path);
    },
    restore() {
      globals.fetch = originalFetch;
      globals.document = originalDocument;
    },
  };
}
