import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface StubServer {
  stop(): Promise<void>;
  url: string;
}

export interface PrivateRealmStubServer {
  origin: string;
  realmUrl: string;
  stop(): Promise<void>;
}

export interface RealmAuthTestServers {
  matrixServer: StubServer;
  realmServer: PrivateRealmStubServer;
  stop(): Promise<void>;
}

export async function startServers(
  options: {
    password?: string;
    sessionToken?: string;
    username?: string;
  } = {},
): Promise<RealmAuthTestServers> {
  let username = options.username ?? 'software-factory-browser';
  let matrixServer = await startMatrixStubServer(
    username,
    options.password ?? browserPassword(username),
  );
  let realmServer = await startPrivateRealmStubServer({
    sessionToken: options.sessionToken ?? buildRealmSessionJwt(),
  });

  return {
    matrixServer,
    realmServer,
    async stop() {
      await realmServer.stop();
      await matrixServer.stop();
    },
  };
}

async function startMatrixStubServer(
  username: string,
  password: string,
): Promise<StubServer> {
  let userId = `@${username}:localhost`;
  let openIdPath = `/_matrix/client/v3/user/${encodeURIComponent(
    userId,
  )}/openid/request_token`;

  // This is a live HTTP matrix stub, not a mocked fetch callback, so
  // createBoxelRealmFetch exercises the real login + OpenID request flow.
  let server = createServer((request, response) => {
    if (
      request.method === 'POST' &&
      request.url === '/_matrix/client/v3/login'
    ) {
      void (async () => {
        let body = await readRequestBody(request);
        let parsedBody = JSON.parse(body) as {
          identifier?: { user?: string };
          password?: string;
        };

        if (
          parsedBody.identifier?.user !== username ||
          parsedBody.password !== password
        ) {
          response.writeHead(401, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              errcode: 'M_FORBIDDEN',
              error: 'Invalid matrix credentials',
            }),
          );
          return;
        }

        respondJson(response, {
          access_token: 'matrix-access-token',
          device_id: 'device-id',
          user_id: userId,
        });
      })();
      return;
    }

    if (request.method === 'POST' && request.url === openIdPath) {
      respondJson(response, {
        access_token: 'openid-token',
        expires_in: 300,
        matrix_server_name: 'localhost',
        token_type: 'Bearer',
      });
      return;
    }

    if (
      request.method === 'GET' &&
      request.url === '/_matrix/client/v3/joined_rooms'
    ) {
      respondJson(response, {
        joined_rooms: [],
      });
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end(`Unexpected matrix request: ${request.method} ${request.url}`);
  });

  await listenOnRandomPort(server);

  let address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}/`,
    async stop() {
      await stopServer(server);
    },
  };
}

export function browserPassword(username: string): string {
  return createHash('sha256')
    .update(username.replace(/^@/, '').replace(/:.*$/, ''))
    .update("shhh! it's a secret")
    .digest('hex');
}

async function startPrivateRealmStubServer({
  sessionToken,
}: {
  sessionToken: string;
}): Promise<PrivateRealmStubServer> {
  let origin = '';
  let realmUrl = '';

  let server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/private/_session') {
      let body = await readRequestBody(request);
      let parsedBody = JSON.parse(body) as { access_token?: string };
      if (parsedBody.access_token !== 'openid-token') {
        response.writeHead(401, { 'content-type': 'text/plain' });
        response.end('invalid openid token');
        return;
      }

      response.writeHead(201, {
        Authorization: sessionToken,
      });
      response.end('');
      return;
    }

    if (
      request.method === 'GET' &&
      request.url === '/private/Wiki/brief-card'
    ) {
      if (request.headers.authorization !== sessionToken) {
        response.writeHead(401, {
          'content-type': 'text/plain',
          'x-boxel-realm-url': realmUrl,
        });
        response.end('unauthorized');
        return;
      }

      respondJson(
        response,
        {
          data: {
            type: 'card',
            attributes: {
              title: 'Private Brief',
              content:
                'Private brief content for testing realm auth. It should only be readable with a valid realm session.',
              tags: ['private', 'brief'],
              cardInfo: {
                name: 'Private Brief',
                summary: 'Private brief content for testing realm auth.',
              },
            },
          },
        },
        {
          'content-type': 'application/vnd.card+source',
        },
      );
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end(`Unexpected realm request: ${request.method} ${request.url}`);
  });

  await listenOnRandomPort(server);

  let address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}/`;
  realmUrl = `${origin}private/`;

  return {
    origin,
    realmUrl,
    async stop() {
      await stopServer(server);
    },
  };
}

export function buildRealmSessionJwt(): string {
  return `header.${Buffer.from(
    JSON.stringify({ sessionRoom: '' }),
    'utf8',
  ).toString('base64')}.signature`;
}

export function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

async function listenOnRandomPort(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

async function stopServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function respondJson(
  response: ServerResponse,
  value: unknown,
  headers?: Record<string, string>,
): void {
  response.writeHead(200, {
    'content-type': 'application/json',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let chunks: string[] = [];

  for await (let chunk of request) {
    chunks.push(String(chunk));
  }

  return chunks.join('');
}
