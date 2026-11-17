// Example AI app's server, on loopback: its pages, the redirect URI a flow
// comes back to, and its client ID metadata document.
//
//   GET /             the Connect page
//   GET /connect      starts a flow and sends the browser to Boxel
//   GET /callback     takes Boxel's response and shows the result page
//   GET /client.json  the metadata document, in the `cimd` mode

import http from 'http';
import type { AddressInfo } from 'net';
import {
  EXAMPLE_AI_APP_METADATA_DOCUMENT_PATH,
  ExampleAIApp,
  type ProviderTransport,
  type RegistrationMode,
} from './client.ts';
import { connectPage, errorPage, resultPage } from './pages.ts';

export interface RunningExampleAIApp {
  app: ExampleAIApp;
  // The server's own origin, `http://127.0.0.1:<port>`.
  origin: string;
  server: http.Server;
  close(): Promise<void>;
}

// Starts the app's server and registers the app with the provider at
// `issuer`. Registration happens here, so a provider that is off or refuses
// the app stops the start rather than the first Connect.
export async function startExampleAIApp({
  mode,
  issuer,
  transport,
  port = 0,
  resource,
  scope,
}: {
  mode: RegistrationMode;
  issuer: string;
  transport: ProviderTransport;
  port?: number;
  resource?: string;
  scope?: string;
}): Promise<RunningExampleAIApp> {
  let app: ExampleAIApp | undefined;
  let server = http.createServer((req, res) => {
    if (!app) {
      send(res, 503, 'text/html', errorPage('The app is still starting.'));
      return;
    }
    handle(app, req, res).catch((error: unknown) => {
      send(
        res,
        500,
        'text/html',
        errorPage(error instanceof Error ? error.message : String(error)),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  let origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  let created = new ExampleAIApp({
    mode,
    issuer,
    appOrigin: origin,
    transport,
    ...(resource ? { resource } : {}),
    ...(scope ? { scope } : {}),
  });
  try {
    await created.register();
  } catch (error) {
    await close();
    throw error;
  }
  app = created;
  return { app, origin, server, close };
}

async function handle(
  app: ExampleAIApp,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method !== 'GET') {
    send(res, 405, 'text/plain', 'Method not allowed');
    return;
  }
  switch (url.pathname) {
    case '/':
      send(res, 200, 'text/html', connectPage(app.mode));
      return;
    case '/connect':
      res.writeHead(302, {
        Location: app.startFlow().href,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    case '/callback':
      // The URL carries the code; nothing on the page may send it on.
      send(
        res,
        200,
        'text/html',
        resultPage(app.mode, await app.finishFlow(url.searchParams)),
      );
      return;
    case EXAMPLE_AI_APP_METADATA_DOCUMENT_PATH:
      if (app.mode === 'cimd') {
        send(
          res,
          200,
          'application/json',
          JSON.stringify(app.metadataDocument()),
        );
        return;
      }
      break;
  }
  send(res, 404, 'text/plain', 'Not found');
}

function send(
  res: http.ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void {
  res.writeHead(status, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}
