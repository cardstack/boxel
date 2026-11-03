import { timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { createLocalIdentityBroker } from './local-identity-broker.ts';
import {
  LocalHostedLoginError,
  type createLocalHostedLogin,
} from './local-hosted-login.ts';

export async function startLocalIdentityServer(options: {
  broker: ReturnType<typeof createLocalIdentityBroker>;
  hostedLogin: ReturnType<typeof createLocalHostedLogin> | null;
  secret: string;
  port: number;
}) {
  const { broker, hostedLogin, secret, port } = options;
  if (
    !/^[a-f0-9]{64}$/.test(secret) ||
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535
  )
    throw new Error('Invalid native identity listener configuration');
  const authorization = Buffer.from(`Bearer ${secret}`);
  let host = '';

  function send(response: ServerResponse, status: number, body: object) {
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(body));
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const candidate = Buffer.from(request.headers.authorization ?? '');
    if (
      request.headers.host !== host ||
      request.headers.origin ||
      request.headers['sec-fetch-site'] ||
      candidate.length !== authorization.length ||
      !timingSafeEqual(candidate, authorization)
    ) {
      send(response, 401, { error: 'Native authentication required' });
      return;
    }
    if (request.method !== 'POST') {
      send(response, 405, { error: 'POST required' });
      return;
    }
    if (
      ![
        '/v1/link',
        '/v1/resolve',
        '/v1/resolve-verified',
        '/v1/login-hosted',
      ].includes(request.url ?? '')
    ) {
      send(response, 404, { error: 'Unknown identity operation' });
      return;
    }
    if (
      request.headers['content-type']?.split(';')[0]?.trim() !==
      'application/json'
    ) {
      send(response, 415, { error: 'JSON required' });
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 32768) {
        send(response, 413, { error: 'Identity request too large' });
        return;
      }
      chunks.push(buffer);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      send(response, 400, { error: 'Invalid identity request' });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (request.url === '/v1/login-hosted') {
      if (!hostedLogin) {
        send(response, 503, { error: 'Hosted sign-in unavailable' });
        return;
      }
      send(response, 200, await hostedLogin(value, now));
    } else if (request.url === '/v1/link') {
      send(response, 200, await broker.link(value, now));
    } else if (request.url === '/v1/resolve') {
      send(response, 200, await broker.resolve(value, now));
    } else {
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length !== 1 ||
        !('localUserId' in value) ||
        typeof value.localUserId !== 'string'
      ) {
        send(response, 400, { error: 'Invalid verified identity request' });
        return;
      }
      send(
        response,
        200,
        await broker.resolveVerifiedLocalAccount(value.localUserId, now),
      );
    }
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent && error instanceof LocalHostedLoginError) {
        send(response, error.status, {
          error: error.message,
          retryAfterMs: error.retryAfterMs,
        });
        return;
      }
      if (!response.headersSent)
        send(response, 403, { error: 'Identity exchange rejected' });
      else response.destroy();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 15000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Native identity listener unavailable');
  host = `127.0.0.1:${address.port}`;
  return {
    url: `http://${host}/`,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
