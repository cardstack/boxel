import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

// A stand-in for an OAuth vendor, on a real socket, for tests of OAuth
// clients and connections. It is the authorization server and the API both:
//
//   GET  /authorize   records the request and sends the user straight back to
//                     its `redirect_uri` with a code and the `state`, as a
//                     vendor does once the user approves; `deny` sends back
//                     `error=access_denied` instead
//   POST /token       `authorization_code` (checks the client, the code, the
//                     redirect URI and the PKCE verifier), `refresh_token`
//                     (rotates the refresh token unless `rotate` is off; a
//                     spent or revoked one is `invalid_grant`) and
//                     `client_credentials`
//   GET  /api/*       200 with the bearer token it was sent, as JSON
//   GET  /consent     the page a person would approve on, for screenshots
//
// `fail` makes the token endpoint answer the next requests with an error
// instead: an OAuth error code (as a 400), or an HTTP status.

export interface StubOAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface StubOAuthProvider {
  url: string;
  // The same server under its other loopback name, a different origin.
  alternateUrl: string;
  clients: StubOAuthClient[];
  // Every token request, in order, by grant type.
  tokenRequests: { grantType: string; body: URLSearchParams }[];
  // The bearer token of every API request, in order.
  apiCalls: { host: string; path: string; token: string | null }[];
  authorizeRequests: URLSearchParams[];
  // Every access and refresh token it has issued.
  issued: string[];
  expiresIn: number | null;
  issueRefreshTokens: boolean;
  rotate: boolean;
  // Answers for the next token requests, used up in order.
  fail: ({ error: string } | { status: number })[];
  // Milliseconds the token endpoint waits before answering.
  tokenDelayMs: number;
  deny: boolean;
  revokeRefreshTokens(): void;
  close(): Promise<void>;
}

export async function startStubOAuthProvider({
  port = 0,
  clients,
}: {
  port?: number;
  clients: StubOAuthClient[];
}): Promise<StubOAuthProvider> {
  let codes = new Map<
    string,
    { clientId: string; redirectURI: string; challenge: string | null }
  >();
  let refreshTokens = new Set<string>();
  let mint = (prefix: string) => {
    let token = `${prefix}_${randomBytes(12).toString('hex')}`;
    provider.issued.push(token);
    return token;
  };

  let readBody = (req: http.IncomingMessage) =>
    new Promise<string>((resolve) => {
      let chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

  let json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  let clientOf = (req: http.IncomingMessage, body: URLSearchParams) => {
    let id = body.get('client_id');
    let secret = body.get('client_secret');
    let basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '');
    if (basic) {
      let [u, p] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
      id = decodeURIComponent(u);
      secret = decodeURIComponent(p ?? '');
    }
    return provider.clients.find(
      (c) => c.clientId === id && c.clientSecret === secret,
    );
  };

  let tokens = (withRefresh: boolean) => {
    let body: Record<string, unknown> = {
      access_token: mint('access'),
      token_type: 'bearer',
      scope: 'read:user',
    };
    if (provider.expiresIn !== null) {
      body.expires_in = provider.expiresIn;
    }
    if (withRefresh) {
      let refresh = mint('refresh');
      refreshTokens.add(refresh);
      body.refresh_token = refresh;
    }
    return body;
  };

  let server = http.createServer(async (req, res) => {
    let url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/authorize') {
      provider.authorizeRequests.push(url.searchParams);
      let redirect = new URL(url.searchParams.get('redirect_uri')!);
      redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
      if (provider.deny) {
        redirect.searchParams.set('error', 'access_denied');
      } else {
        let code = `code_${randomBytes(8).toString('hex')}`;
        codes.set(code, {
          clientId: url.searchParams.get('client_id') ?? '',
          redirectURI: url.searchParams.get('redirect_uri') ?? '',
          challenge: url.searchParams.get('code_challenge'),
        });
        redirect.searchParams.set('code', code);
      }
      res.writeHead(302, { location: redirect.href });
      res.end();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/consent') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(consentPage(url.searchParams));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      let body = new URLSearchParams(await readBody(req));
      let grantType = body.get('grant_type') ?? '';
      provider.tokenRequests.push({ grantType, body });
      if (provider.tokenDelayMs > 0) {
        await new Promise((r) => setTimeout(r, provider.tokenDelayMs));
      }
      let failure = provider.fail.shift();
      if (failure) {
        if ('status' in failure) {
          json(res, failure.status, { error: 'server_error' });
        } else {
          json(res, 400, { error: failure.error });
        }
        return;
      }
      let client = clientOf(req, body);
      if (!client) {
        json(res, 401, { error: 'invalid_client' });
        return;
      }
      if (grantType === 'authorization_code') {
        let code = codes.get(body.get('code') ?? '');
        codes.delete(body.get('code') ?? '');
        let verifier = body.get('code_verifier') ?? '';
        if (
          !code ||
          code.clientId !== client.clientId ||
          code.redirectURI !== body.get('redirect_uri') ||
          code.challenge !==
            createHash('sha256').update(verifier).digest('base64url')
        ) {
          json(res, 400, { error: 'invalid_grant' });
          return;
        }
        json(res, 200, tokens(provider.issueRefreshTokens));
        return;
      }
      if (grantType === 'refresh_token') {
        let refresh = body.get('refresh_token') ?? '';
        if (!refreshTokens.has(refresh)) {
          json(res, 400, { error: 'invalid_grant' });
          return;
        }
        if (provider.rotate) {
          refreshTokens.delete(refresh);
          json(res, 200, tokens(true));
        } else {
          json(res, 200, { ...tokens(false), refresh_token: refresh });
        }
        return;
      }
      if (grantType === 'client_credentials') {
        json(res, 200, tokens(false));
        return;
      }
      json(res, 400, { error: 'unsupported_grant_type' });
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
      let token =
        /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
      provider.apiCalls.push({
        host: req.headers.host ?? '',
        path: url.pathname,
        token,
      });
      json(res, 200, { login: 'octocat', path: url.pathname });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve),
  );
  let actual = (server.address() as AddressInfo).port;
  let provider: StubOAuthProvider = {
    url: `http://127.0.0.1:${actual}`,
    alternateUrl: `http://localhost:${actual}`,
    clients,
    tokenRequests: [],
    apiCalls: [],
    authorizeRequests: [],
    issued: [],
    expiresIn: 3600,
    issueRefreshTokens: true,
    rotate: true,
    fail: [],
    tokenDelayMs: 0,
    deny: false,
    revokeRefreshTokens() {
      refreshTokens.clear();
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  return provider;
}

function escapeHTML(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
}

// The page a person approves an app on, drawn as a vendor's would be.
function consentPage(params: URLSearchParams) {
  let scopes = (params.get('scope') ?? '').split(/\s+/).filter(Boolean);
  // A GET form replaces its action's query with its fields, so each
  // parameter rides as a hidden field.
  let hidden = [...params]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHTML(name)}" value="${escapeHTML(value)}">`,
    )
    .join('');
  return `<!doctype html><html><head><title>Authorize application</title>
<style>body{font-family:system-ui;background:#f6f8fa;display:flex;justify-content:center;padding:48px}
main{background:#fff;border:1px solid #d0d7de;border-radius:12px;padding:32px;width:420px}
h1{font-size:20px}li{margin:6px 0}button{background:#1f883d;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:15px}</style></head>
<body><main><h1>Authorize ${escapeHTML(params.get('client_id') ?? '')}</h1>
<p>This application will be able to:</p><ul>${scopes.map((s) => `<li>${escapeHTML(s)}</li>`).join('') || '<li>Read your public profile</li>'}</ul>
<form method="get" action="/authorize">${hidden}<button type="submit">Authorize</button></form></main></body></html>`;
}
