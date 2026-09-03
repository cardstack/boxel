import Koa from 'koa';
import cors from '@koa/cors';
import http from 'http';
import http2 from 'http2';
import net from 'net';
import { readFileSync } from 'fs';
import type { DefinitionLookup, Realm } from '@cardstack/runtime-common';
import {
  logger,
  SupportedMimeType,
  type VirtualNetwork,
  type DBAdapter,
  type QueuePublisher,
  type MediaCacheAdapter,
  DEFAULT_AUDIO_SIZE_LIMIT_BYTES,
  DEFAULT_CARD_SIZE_LIMIT_BYTES,
  DEFAULT_FILE_SIZE_LIMIT_BYTES,
  DEFAULT_VIDEO_SIZE_LIMIT_BYTES,
} from '@cardstack/runtime-common';
import fsExtra from 'fs-extra';
const { ensureDirSync } = fsExtra;
import {
  httpLogging,
  ecsMetadata,
  methodOverrideSupport,
  proxyAsset,
} from './middleware/index.ts';
import convertAcceptHeaderQueryParam from './middleware/convert-accept-header-qp.ts';

import { extractSupportedMimeType } from '@cardstack/runtime-common/router';
import * as Sentry from '@sentry/node';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { createRoutes } from './routes.ts';
import { JobScopedSearchCache } from './job-scoped-search-cache.ts';
import { createSendEvent } from './handlers/send-event.ts';
import { createServeFromRealm } from './handlers/serve-from-realm.ts';
import { createServeIndex } from './handlers/serve-index.ts';
import { findOrMountRealm } from './lib/realm-routing.ts';
import type { Prerenderer } from '@cardstack/runtime-common';
import type { RealmRegistryReconciler } from './lib/realm-registry-reconciler.ts';

const TLS_CERT_FILE_ENV = 'REALM_SERVER_TLS_CERT_FILE';
const TLS_KEY_FILE_ENV = 'REALM_SERVER_TLS_KEY_FILE';

// HTTP/2 PING keepalive tuning. The h2 transport between Chrome and this
// server can wedge: the session stops carrying frames entirely — the server's
// PINGs go unanswered (PONG is handled by the peer's network stack, not JS,
// so a missing pong means no frames are flowing at all) while the browser
// still has a fetch awaiting its response. That fetch never rejects, so the
// client-side retry in runtime-common's virtual-network (which only retries
// rejections) never fires and a host test hangs until its 60s timeout. The
// keepalive turns the silent wedge into a recoverable error: every session is
// pinged on an interval, and one that misses enough consecutive pongs is torn
// down, RSTing its streams so the hung fetch rejects and retries on a fresh
// session.
//
// Budget: worst-case detection is maxMissedPings × (interval + pongTimeout) +
// grace = 3 × 10s + 3s = 33s, leaving the released fetch room to retry and
// complete inside a 60s host-test timeout. Three consecutive misses (~30s of
// silence) cannot be produced by a transient event-loop stall — a single
// delayed pong scores at most one miss before the next successful ping resets
// the counter — while a genuinely wedged session never pongs again, so the
// discrimination is clean. A false teardown would only cost the peer a
// reconnect, never a wrong result.
const HTTP2_KEEPALIVE_INTERVAL_MS = 5000;
const HTTP2_KEEPALIVE_PONG_TIMEOUT_MS = 5000;
const HTTP2_KEEPALIVE_MAX_MISSED_PINGS = 3;
// After a graceful close (GOAWAY) a wedged transport won't deliver anything,
// so force the session down to actually RST the browser's hung fetch.
const HTTP2_KEEPALIVE_GRACE_MS = 3000;
const HTTP2_KEEPALIVE_TCP_INITIAL_DELAY_MS = 15000;
// How long after the force-destroy to check whether the session actually
// emitted 'close'. A transport-wedged session can swallow `session.destroy()`
// — no 'close' fires, the session lingers, and its streams never RST — so this
// confirm window records whether the forced teardown reached the peer or the
// wedge is unreachable from the server.
const HTTP2_KEEPALIVE_POST_DESTROY_CONFIRM_MS = 2000;

// Per-session liveness recorded by the PING keepalive, so a teardown warning
// can name the session and say how long ago it last answered a ping.
interface SessionLiveness {
  id: number;
  lastPongAt: number | undefined;
}

export type RealmHttpServer =
  | http.Server
  | http2.Http2SecureServer
  | net.Server;

// Node's HTTP/2 compat layer reports Http2Stream.writable === false on
// server-side streams whose request method is HEAD (the protocol forbids a
// body, so the stream is marked non-writable up front). Koa's
// `ctx.writable` getter delegates to `res.socket.writable`, so for HEAD
// over h2 it sees `false` and `respond()` bails silently — the response
// headers never get sent and the client hangs until its timeout.
// Patching the prototype getter to recognise HEAD-over-h2 streams as
// writable (when they are otherwise healthy) restores normal HEAD
// semantics over h2 without disturbing GET/POST or HTTP/1.1. Exported so
// tests that build their own Koa app pick up the same fix.
let koaResponsePatchedForH2 = false;
export function patchKoaResponseForH2Head() {
  if (koaResponsePatchedForH2) return;
  // Construct a throwaway Koa instance just to find the prototype — Koa's
  // response prototype isn't exported directly.
  let proto = Object.getPrototypeOf(new Koa().response) as object;
  let descriptor = Object.getOwnPropertyDescriptor(proto, 'writable');
  let origWritable = descriptor?.get;
  if (!origWritable) return;
  Object.defineProperty(proto, 'writable', {
    configurable: true,
    get(this: Koa.Response) {
      let res = this.res as unknown as {
        writableEnded?: boolean;
        req?: { method?: string };
        stream?: { destroyed?: boolean; closed?: boolean };
      };
      if (res?.writableEnded) return false;
      let stream = res?.stream;
      if (
        res?.req?.method === 'HEAD' &&
        stream &&
        !stream.destroyed &&
        !stream.closed
      ) {
        return true;
      }
      return origWritable!.call(this);
    },
  });
  koaResponsePatchedForH2 = true;
}

// In TLS mode the realm-server binds a single net.Server that peeks each
// connection's first byte and routes TLS handshakes (0x16) to the HTTP/2
// secure server and plain-text HTTP to a tiny 308-redirect server. This
// gives http://localhost:4201 → https://localhost:4201 the same-port
// redirect UX without running two listeners on different ports.
// Exported for tests in `tests/listener-dispatcher-test.ts` — the
// production caller is `RealmServer.listen()` below.
export function createListener(
  log: ReturnType<typeof logger>,
  app: { callback: Koa['callback'] },
): { server: RealmHttpServer; proto: 'http' | 'https/h2' } {
  let certFile = process.env[TLS_CERT_FILE_ENV];
  let keyFile = process.env[TLS_KEY_FILE_ENV];

  // Env mode (Traefik in front): Traefik terminates the browser's TLS and
  // re-originates an HTTP/2-over-TLS connection to this backend — the dev
  // service registry registers an https:// upstream and Traefik negotiates h2
  // via ALPN. So the realm-server terminates TLS and serves h2 here too. There
  // is no first-byte dispatcher or :80→:443 redirect server in this mode:
  // Traefik is the only client, always connects over TLS, and owns the
  // plain-HTTP redirect on :80. HTTP/2 is a system invariant we never
  // downgrade; a missing or unreadable cert is a hard misconfiguration, so
  // buildHttp2SecureServer throws and boot fails loudly rather than quietly
  // serving HTTP/1.1 — which Traefik (expecting h2) would turn into all-502s.
  if (process.env.BOXEL_ENVIRONMENT) {
    return {
      server: withForcedConnectionClose(
        buildHttp2SecureServer(certFile, keyFile, app, log),
      ),
      proto: 'https/h2',
    };
  }

  // No TLS cert configured: plain HTTP/1.1. This is the hosted staging/prod
  // path today — TLS is terminated at the load balancer, which forwards plain
  // HTTP to the realm-server. Enabling h2 there (provisioning certs) is owned
  // separately; this branch is intentionally the plain-HTTP path.
  if (!certFile || !keyFile) {
    return { server: http.createServer(app.callback()), proto: 'http' };
  }

  // Standard local-dev mode: a browser hits this port directly, so wrap the h2
  // secure server in a first-byte dispatcher that routes TLS handshakes to h2
  // and plain-HTTP to a 308-redirect server.
  let tlsServer = buildHttp2SecureServer(certFile, keyFile, app, log);
  let redirectServer = http.createServer(redirectToHttps);
  // Track every accepted socket so shutdown can force-close them. Without
  // this, `dispatcher.close()` waits for active HTTP/2 sessions and
  // keep-alive HTTP/1 connections to end on their own — a single open
  // browser tab can keep the realm-server from ever shutting down. Mirror
  // the API surface (`closeAllConnections`) so main.ts's existing typeof
  // guard picks this up without a special-case branch.
  let activeSockets = new Set<net.Socket>();
  let dispatcher = net.createServer({ pauseOnConnect: true }, (socket) => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
    // Attach a per-socket error listener BEFORE doing any I/O. A peer that
    // RSTs the connection mid-handshake (or in the half-open window before
    // we route it) emits `'error'` on this raw socket; without a listener
    // Node escalates that to an uncaught exception and the realm-server
    // would crash. Logging + best-effort destroy is sufficient — the
    // dispatcher is the realm-server's single inbound listener and must
    // survive hostile or unlucky clients.
    socket.on('error', (e) => {
      log.warn(`dispatcher socket error: %s`, e.message);
      socket.destroy();
    });
    socket.once('readable', () => {
      let firstByte: Buffer | null;
      try {
        firstByte = socket.read(1);
      } catch {
        socket.destroy();
        return;
      }
      if (firstByte == null) {
        // Connection opened then closed without data — release the socket
        // promptly instead of letting it idle in CLOSE_WAIT until the OS
        // reaps it. Cheap defense against half-open-connection accumulators
        // (port scanners, eager load balancers, etc.).
        socket.destroy();
        return;
      }
      socket.unshift(firstByte);
      // 0x16 is the TLS ClientHello record type. Anything else is treated
      // as plain HTTP (ASCII verb byte) and gets the redirect path.
      if (firstByte[0] === 0x16) {
        tlsServer.emit('connection', socket);
      } else {
        redirectServer.emit('connection', socket);
      }
      socket.resume();
    });
  });
  // Server-level errors (e.g. `EADDRINUSE` at `listen()` time). Per-socket
  // errors are handled inside the connection callback above.
  dispatcher.on('error', (e) => {
    log.warn(`dispatcher server error: %s`, e.message);
  });
  // Mirror http.Server's `closeAllConnections()` so shutdown can force-
  // close in-flight TLS / HTTP/2 / keep-alive sockets without waiting for
  // peers to close them. main.ts feature-detects this method.
  (
    dispatcher as net.Server & { closeAllConnections: () => void }
  ).closeAllConnections = () => {
    for (let s of activeSockets) {
      try {
        s.destroy();
      } catch {
        // best-effort
      }
    }
    activeSockets.clear();
  };
  return { server: dispatcher, proto: 'https/h2' };
}

// Read the configured TLS cert/key and construct the HTTP/2 secure server.
// HTTP/2 is a system invariant: any failure here — cert/key not configured,
// unreadable, or malformed — throws so the realm-server fails startup with a
// non-zero exit instead of silently downgrading to HTTP/1.1 and masking the
// misconfiguration.
function buildHttp2SecureServer(
  certFile: string | undefined,
  keyFile: string | undefined,
  app: { callback: Koa['callback'] },
  log: ReturnType<typeof logger>,
): http2.Http2SecureServer {
  if (!certFile || !keyFile) {
    throw new Error(
      `HTTP/2 requires a TLS cert/key but ${TLS_CERT_FILE_ENV} / ${TLS_KEY_FILE_ENV} are not set`,
    );
  }
  // Idempotent and cheap; applied once before the h2 server is constructed.
  patchKoaResponseForH2Head();
  let cert: Buffer;
  let key: Buffer;
  try {
    cert = readFileSync(certFile);
    key = readFileSync(keyFile);
  } catch (e) {
    throw new Error(
      `Unable to read TLS cert/key (${certFile}, ${keyFile}): ${(e as Error).message}`,
    );
  }
  let tlsServer: http2.Http2SecureServer;
  try {
    tlsServer = http2.createSecureServer(
      { cert, key, allowHTTP1: true },
      endStreamOnFinalDataFrame(app.callback()),
    );
  } catch (e) {
    throw new Error(
      `Unable to construct HTTPS/h2 server (malformed cert?): ${(e as Error).message}`,
    );
  }
  // Tear down wedged h2 sessions so a hung browser fetch rejects (and retries)
  // instead of hanging until a test timeout.
  installHttp2Keepalive(tlsServer, log);
  return tlsServer;
}

// End every HTTP/2 response with END_STREAM on its final DATA frame rather
// than through node's trailers mechanism.
//
// Node's http2 compat layer — the half that turns an `Http2Stream` into the
// `(req, res)` pair Koa is written against — responds with
// `waitForTrailers: true` unconditionally. That moves END_STREAM off the final
// DATA frame and onto an empty trailers HEADERS frame emitted from a
// `setImmediate` (`finishSendTrailers` in `lib/internal/http2/core.js`), which
// drops that frame when the stream is already destroyed. A response whose
// END_STREAM never arrives leaves its peer holding a body it can neither
// complete nor fail.
//
// Whether this server can reach that state is not established — no sequence
// here is known to destroy a stream inside the window. What is established is
// that the deferral buys nothing: nothing in this repo sends HTTP trailers, so
// declining them is behavior-preserving and removes the window rather than
// reasoning about its reachability. The last DATA frame carries END_STREAM
// itself.
//
// Applied by wrapping the request listener rather than the `stream` event,
// because the compat listener registered by `createSecureServer(..., handler)`
// runs first and responds synchronously for a request the app answers without
// awaiting — a `stream` listener added afterwards would miss exactly those.
// `allowHTTP1` means this also sees HTTP/1.1 requests, whose `res` has no
// backing stream; those are passed through untouched.
function endStreamOnFinalDataFrame(
  requestListener: ReturnType<Koa['callback']>,
): ReturnType<Koa['callback']> {
  return function (req, res) {
    let stream = (res as unknown as { stream?: http2.ServerHttp2Stream })
      .stream;
    if (stream) {
      let respond = stream.respond;
      stream.respond = function (
        headers?: http2.OutgoingHttpHeaders,
        options?: http2.ServerStreamResponseOptions,
      ) {
        if (options?.waitForTrailers) {
          options = { ...options, waitForTrailers: false };
        }
        return respond.call(this, headers, options);
      };
    }
    return requestListener(req, res);
  };
}

// Wire the HTTP/2 PING keepalive onto every session the secure server
// accepts — see the HTTP2_KEEPALIVE_* constants for the rationale.
function installHttp2Keepalive(
  tlsServer: http2.Http2SecureServer,
  log: ReturnType<typeof logger>,
) {
  let liveness = new WeakMap<http2.Http2Session, SessionLiveness>();
  let nextSessionId = 0;
  tlsServer.on('session', (session) => {
    liveness.set(session, {
      id: nextSessionId++,
      lastPongAt: undefined,
    });
    // Belt-and-suspenders: TCP keepalive surfaces a dead peer at the socket
    // layer even if the h2 PING path is somehow starved. Best-effort.
    try {
      session.socket?.setKeepAlive?.(
        true,
        HTTP2_KEEPALIVE_TCP_INITIAL_DELAY_MS,
      );
    } catch {
      // some socket states reject setKeepAlive; ignore
    }
    startSessionKeepalive(session, log, {}, liveness);
  });
}

interface KeepaliveOptions {
  intervalMs?: number;
  pongTimeoutMs?: number;
  maxMissedPings?: number;
  graceMsBeforeDestroy?: number;
  postDestroyConfirmMs?: number;
}

// Ping a single h2 session on an interval; if it misses `maxMissedPings`
// consecutive pings (no PONG within `pongTimeoutMs`, or the PING frame can't
// even be queued), the session is wedged — close it (GOAWAY) and force it
// down after a grace period so its streams RST and the browser's pending
// fetch rejects. Returns a stop() for teardown/testing. Exported for unit
// tests, which drive it with a fake session and short timers.
export function startSessionKeepalive(
  session: http2.Http2Session,
  log: ReturnType<typeof logger>,
  options: KeepaliveOptions = {},
  liveness?: WeakMap<http2.Http2Session, SessionLiveness>,
): () => void {
  let intervalMs = options.intervalMs ?? HTTP2_KEEPALIVE_INTERVAL_MS;
  let pongTimeoutMs = options.pongTimeoutMs ?? HTTP2_KEEPALIVE_PONG_TIMEOUT_MS;
  let maxMissedPings =
    options.maxMissedPings ?? HTTP2_KEEPALIVE_MAX_MISSED_PINGS;
  let graceMsBeforeDestroy =
    options.graceMsBeforeDestroy ?? HTTP2_KEEPALIVE_GRACE_MS;
  let postDestroyConfirmMs =
    options.postDestroyConfirmMs ?? HTTP2_KEEPALIVE_POST_DESTROY_CONFIRM_MS;

  let stopped = false;
  let misses = 0;
  let nextTimer: ReturnType<typeof setTimeout> | undefined;

  function recordPong() {
    if (!liveness) {
      return;
    }
    let prev = liveness.get(session) ?? { id: -1, lastPongAt: undefined };
    liveness.set(session, { ...prev, lastPongAt: Date.now() });
  }

  function sessionLabel() {
    let id = liveness?.get(session)?.id;
    return id != null && id >= 0 ? `#${id}` : '<untracked>';
  }

  function stop() {
    stopped = true;
    if (nextTimer) {
      clearTimeout(nextTimer);
      nextTimer = undefined;
    }
  }

  function scheduleNext() {
    if (stopped) {
      return;
    }
    nextTimer = setTimeout(sendPing, intervalMs);
    nextTimer.unref?.();
  }

  function onMiss(reason: string) {
    misses++;
    if (misses < maxMissedPings) {
      scheduleNext();
      return;
    }
    let lastPongAt = liveness?.get(session)?.lastPongAt;
    let pongAge = lastPongAt != null ? `${Date.now() - lastPongAt}ms` : 'never';
    log.warn(
      `[h2-keepalive] session ${sessionLabel()} unresponsive ` +
        `(${misses} missed pings, ${reason}, last pong ${pongAge} ago) — ` +
        `closing to release wedged streams`,
    );
    stop();
    try {
      session.close();
    } catch {
      // already closing/closed
    }
    let hard = setTimeout(() => {
      if (session.destroyed) {
        return;
      }
      // Record the socket-level state that characterizes the wedge. Reads go
      // through the guarded Http2Session.socket proxy, which permits property
      // gets but throws ERR_HTTP2_NO_SOCKET_MANIPULATION on mutators — so this
      // can observe the socket but cannot tear it down directly; session
      // teardown is `session.destroy()`'s job (it targets the socket itself).
      let socket = session.socket as net.Socket | undefined;
      let socketState = socket
        ? `socket(destroyed=${socket.destroyed} writable=${socket.writable} ` +
          `writableLength=${socket.writableLength} ` +
          `bytesRead=${socket.bytesRead} bytesWritten=${socket.bytesWritten})`
        : 'socket=<none>';
      log.warn(
        `[h2-keepalive] session ${sessionLabel()} still up after ` +
          `${graceMsBeforeDestroy}ms grace — force-destroying; ${socketState}`,
      );
      let destroyAt = Date.now();
      let closeFired = false;
      session.once('close', () => {
        closeFired = true;
        log.warn(
          `[h2-keepalive] session ${sessionLabel()} closed ` +
            `${Date.now() - destroyAt}ms after force-destroy`,
        );
      });
      try {
        session.destroy();
      } catch {
        // already destroyed
      }
      // Whether destroy() actually releases the peer is the open question. If
      // 'close' never fires, the streams never RST and the browser's fetch
      // never rejects — no server-side teardown reached the wedged transport,
      // which is the signal that distinguishes a fixable server-side issue
      // from a hang only the client can recover from.
      let confirm = setTimeout(() => {
        if (!closeFired) {
          log.warn(
            `[h2-keepalive] session ${sessionLabel()} STILL not closed ` +
              `${postDestroyConfirmMs}ms after force-destroy ` +
              `(destroyed=${session.destroyed} ` +
              `socketDestroyed=${session.socket?.destroyed ?? '<none>'}) — ` +
              `transport-level wedge unreachable from the server`,
          );
        }
      }, postDestroyConfirmMs);
      confirm.unref?.();
    }, graceMsBeforeDestroy);
    hard.unref?.();
  }

  function sendPing() {
    if (stopped || session.destroyed || session.closed) {
      stop();
      return;
    }
    let settled = false;
    let pongTimer: ReturnType<typeof setTimeout> | undefined;
    function finish(then: () => void) {
      // `stopped` covers a ping still in flight when the session closes or
      // errors: its late pong callback / pong timeout must not record a miss
      // or tear down a session that already ended normally.
      if (settled || stopped) {
        return;
      }
      settled = true;
      if (pongTimer) {
        clearTimeout(pongTimer);
      }
      then();
    }

    let queued: boolean;
    try {
      // ping() returns false when the frame couldn't be queued; the callback
      // fires on PONG (or with an error if the session dies first).
      queued =
        session.ping((err: Error | null) => {
          finish(() => {
            if (err) {
              onMiss(`ping errored: ${err.message}`);
              return;
            }
            misses = 0;
            recordPong();
            scheduleNext();
          });
        }) !== false;
    } catch (e) {
      finish(() => onMiss(`ping threw: ${(e as Error).message}`));
      return;
    }

    if (!queued) {
      finish(() => onMiss('ping frame could not be queued'));
      return;
    }

    pongTimer = setTimeout(() => {
      finish(() => onMiss(`no pong within ${pongTimeoutMs}ms`));
    }, pongTimeoutMs);
    pongTimer.unref?.();
  }

  session.once('close', stop);
  session.once('error', stop);
  scheduleNext();
  return stop;
}

// Node's http2 secure server — like net/tls servers, and unlike
// `http.Server` — has no `closeAllConnections()`. A graceful shutdown's
// `server.close()` then waits for peers to end their sessions, so a single
// persistent h2 session (Traefik's backend connection in env mode, or an
// open browser tab) can keep the realm-server from ever exiting. Track
// accepted sockets and expose a `closeAllConnections()` that force-closes
// them, mirroring `http.Server`'s API so main.ts's existing `typeof` guard
// force-closes on shutdown without a special case. (Standard mode doesn't
// need this here — its h2 server is wrapped by the dispatcher, which already
// tracks sockets and mirrors the same method.)
function withForcedConnectionClose(
  server: http2.Http2SecureServer,
): http2.Http2SecureServer {
  let activeSockets = new Set<net.Socket>();
  server.on('connection', (socket: net.Socket) => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));
  });
  (
    server as http2.Http2SecureServer & { closeAllConnections: () => void }
  ).closeAllConnections = () => {
    for (let s of activeSockets) {
      try {
        s.destroy();
      } catch {
        // best-effort
      }
    }
    activeSockets.clear();
  };
  return server;
}

// Same-port 308 redirect for plain-text HTTP requests that land on the
// HTTPS port. The dispatcher binds a single port so the inbound and
// target ports agree; we just rewrite the scheme. Parses via URL so
// bracketed IPv6 authorities (`[::1]:4201`) round-trip cleanly instead
// of being mangled by string-level regex.
//
// 308 (vs 301): preserves the request method and body across the
// redirect. Local scripts that POST to `http://localhost:4201/...`
// (matrix registration/setup writes `/_server-session`, `/_user`,
// webhook endpoints) need that — a 301 makes fetch downgrade the
// follow-up to GET and drops the body, breaking those calls. 308 is
// also semantically correct: this redirect is a permanent property of
// the wire protocol, not a temporary handler decision.
function redirectToHttps(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  let hostHeader = typeof req.headers.host === 'string' ? req.headers.host : '';
  let path = req.url ?? '/';
  let authority: string;
  try {
    let parsed = new URL(`http://${hostHeader || hostFromSocket(req)}`);
    // `url.host` preserves brackets around IPv6 literals and the port if
    // present, which is exactly the form we want in the redirect target.
    authority = parsed.host;
  } catch {
    authority = hostFromSocket(req);
  }
  let location = `https://${authority}${path}`;
  res.writeHead(308, {
    Location: location,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end(`Redirecting to ${location}\n`);
}

// Best-effort fallback when the inbound request has no Host header
// (HTTP/1.0 client). Uses the dispatcher's bound `localAddress:localPort`
// so the redirect goes to the actual listener instead of guessing port
// 443. Brackets IPv6 literals to match URL `host` formatting.
function hostFromSocket(req: http.IncomingMessage): string {
  let addr = req.socket.localAddress ?? 'localhost';
  let port = req.socket.localPort;
  let bracketed = addr.includes(':') ? `[${addr}]` : addr;
  return port ? `${bracketed}:${port}` : bracketed;
}

export class RealmServer {
  private log = logger('realm-server');
  private realms: Realm[];
  private virtualNetwork: VirtualNetwork;
  private matrixClient: MatrixClient;
  private realmServerSecretSeed: string;
  private realmSecretSeed: string;
  private grafanaSecret: string;
  private aiBotDelegationSecret: string | undefined;

  private realmsRootPath: string;
  private dbAdapter: DBAdapter;
  private queue: QueuePublisher;
  private definitionLookup: DefinitionLookup;
  private mediaCacheAdapter: MediaCacheAdapter | undefined;
  private assetsURL: URL;
  private getIndexHTML: () => Promise<string>;
  private serverURL: URL;
  private matrixRegistrationSecret: string | undefined;
  private matrixAdminUsername: string | undefined;
  private matrixAdminPassword: string | undefined;
  private getRegistrationSecret:
    | (() => Promise<string | undefined>)
    | undefined;
  private cardSizeLimitBytes: number;
  private fileSizeLimitBytes: number;
  private audioSizeLimitBytes: number;
  private videoSizeLimitBytes: number;
  private domainsForPublishedRealms:
    | {
        boxelSpace?: string;
        boxelSite?: string;
      }
    | undefined;
  private prerenderer: Prerenderer | undefined;
  private reportHostShell: (() => Promise<void>) | undefined;
  private reconciler: RealmRegistryReconciler;
  private searchCache: JobScopedSearchCache;
  private cachedApp: ReturnType<RealmServer['buildApp']> | undefined;

  constructor({
    serverURL,
    realms,
    reconciler,
    virtualNetwork,
    matrixClient,
    realmServerSecretSeed,
    realmSecretSeed,
    grafanaSecret,
    aiBotDelegationSecret,
    realmsRootPath,
    dbAdapter,
    queue,
    definitionLookup,
    mediaCacheAdapter,
    assetsURL,
    getIndexHTML,
    matrixRegistrationSecret,
    matrixAdminUsername,
    matrixAdminPassword,
    getRegistrationSecret,
    domainsForPublishedRealms,
    prerenderer,
    reportHostShell,
    searchCache,
  }: {
    serverURL: URL;
    realms: Realm[];
    reconciler: RealmRegistryReconciler;
    virtualNetwork: VirtualNetwork;
    matrixClient: MatrixClient;
    realmServerSecretSeed: string;
    realmSecretSeed: string;
    grafanaSecret: string;
    aiBotDelegationSecret?: string;
    realmsRootPath: string;
    dbAdapter: DBAdapter;
    queue: QueuePublisher;
    definitionLookup: DefinitionLookup;
    // MediaCache object store shared with the realms this server mounts;
    // absent means the POST screenshot endpoint captures without persisting.
    mediaCacheAdapter?: MediaCacheAdapter;
    assetsURL: URL;
    getIndexHTML: () => Promise<string>;
    matrixRegistrationSecret?: string;
    matrixAdminUsername?: string;
    matrixAdminPassword?: string;
    getRegistrationSecret?: () => Promise<string | undefined>;
    enableFileWatcher?: boolean;
    domainsForPublishedRealms?: {
      boxelSpace?: string;
      boxelSite?: string;
    };
    prerenderer?: Prerenderer;
    // Reports the current host-shell token to the prerender manager. main.ts
    // wires this so the post-deployment hook can re-report once the service is
    // stable (the boot-time report fires as soon as this server starts serving).
    reportHostShell?: () => Promise<void>;
    // Optional so test harnesses that construct a RealmServer directly get a
    // private cache for free. main.ts passes a shared instance so the
    // JobsFinishedListener can evict the same cache the handlers populate.
    searchCache?: JobScopedSearchCache;
  }) {
    if (!matrixRegistrationSecret && !getRegistrationSecret) {
      throw new Error(
        `'matrixRegistrationSecret' or 'getRegistrationSecret' must be specified`,
      );
    }
    detectRealmCollision(realms);
    ensureDirSync(realmsRootPath);

    this.serverURL = serverURL;
    this.cardSizeLimitBytes = Number(
      process.env.CARD_SIZE_LIMIT_BYTES ?? DEFAULT_CARD_SIZE_LIMIT_BYTES,
    );
    this.fileSizeLimitBytes = Number(
      process.env.FILE_SIZE_LIMIT_BYTES ?? DEFAULT_FILE_SIZE_LIMIT_BYTES,
    );
    this.audioSizeLimitBytes = Number(
      process.env.AUDIO_SIZE_LIMIT_BYTES ?? DEFAULT_AUDIO_SIZE_LIMIT_BYTES,
    );
    this.videoSizeLimitBytes = Number(
      process.env.VIDEO_SIZE_LIMIT_BYTES ?? DEFAULT_VIDEO_SIZE_LIMIT_BYTES,
    );
    this.virtualNetwork = virtualNetwork;
    this.matrixClient = matrixClient;

    this.realmSecretSeed = realmSecretSeed;
    this.aiBotDelegationSecret = aiBotDelegationSecret;
    this.realmServerSecretSeed = realmServerSecretSeed;
    this.grafanaSecret = grafanaSecret;
    this.realmsRootPath = realmsRootPath;
    this.dbAdapter = dbAdapter;
    this.queue = queue;
    this.definitionLookup = definitionLookup;
    this.mediaCacheAdapter = mediaCacheAdapter;
    this.assetsURL = assetsURL;
    this.getIndexHTML = getIndexHTML;
    this.matrixRegistrationSecret = matrixRegistrationSecret;
    this.matrixAdminUsername = matrixAdminUsername;
    this.matrixAdminPassword = matrixAdminPassword;
    this.getRegistrationSecret = getRegistrationSecret;
    this.domainsForPublishedRealms = domainsForPublishedRealms;
    // Pass-by-reference: handlers and the reconciler both mutate this
    // array. Copying it would create two divergent views of mounted
    // realms — a bug under multi-instance Phase 3 semantics. The legacy
    // `[...realms]` copy is gone with that constraint.
    this.realms = realms;
    this.reconciler = reconciler;
    this.prerenderer = prerenderer;
    this.reportHostShell = reportHostShell;
    this.searchCache = searchCache ?? new JobScopedSearchCache(dbAdapter);
  }

  get app() {
    return (this.cachedApp ??= this.buildApp());
  }

  private buildApp() {
    let { serveIndex, serveHostApp } = createServeIndex({
      serverURL: this.serverURL,
      assetsURL: this.assetsURL,
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
      matrixClient: this.matrixClient,
      getIndexHTML: this.getIndexHTML,
      cardSizeLimitBytes: this.cardSizeLimitBytes,
      fileSizeLimitBytes: this.fileSizeLimitBytes,
      audioSizeLimitBytes: this.audioSizeLimitBytes,
      videoSizeLimitBytes: this.videoSizeLimitBytes,
    });
    let serveFromRealm = createServeFromRealm({
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
      virtualNetwork: this.virtualNetwork,
    });
    let sendEvent = createSendEvent({
      matrixClient: this.matrixClient,
      dbAdapter: this.dbAdapter,
    });

    let app = new Koa<Koa.DefaultState, Koa.Context>()
      .use(httpLogging)
      .use(ecsMetadata)
      .use(
        cors({
          origin: '*',
          // Range/If-Range are here for native media playback: <audio>/<video>
          // elements cannot attach Authorization, so the host's auth service
          // worker re-issues their requests as mode:'cors' with the token
          // injected. That rewrite turns the media element's Range header into
          // an author header needing preflight approval — without Range in
          // this list the preflight fails and the player errors before any
          // bytes flow.
          allowHeaders:
            'Authorization, Content-Type, If-Match, If-None-Match, If-Range, Range, X-Requested-With, X-Boxel-Client-Request-Id, X-Boxel-Assume-User, X-HTTP-Method-Override, X-Boxel-Disable-Module-Cache, X-Filename, X-Boxel-During-Prerender, X-Boxel-Consuming-Realm, X-Boxel-Job-Id, X-Boxel-Job-Priority, X-Boxel-Logging-Correlation-Id, X-Grafana-Device-Id, X-Grafana-Action',
          // Without an explicit expose list, @koa/cors only emits the
          // CORS-safelisted response headers (cache-control, content-*,
          // expires, last-modified, pragma). ETag is not on that list,
          // so cross-origin browser callers (the host SPA inside a
          // prerender tab, or any in-DevTools fetch) get a response
          // whose `headers.get('ETag')` is `null` even though the
          // server emitted one — making the entire revalidation
          // protocol invisible to JS. Location/Retry-After are likewise
          // non-safelisted; expose them so a cross-origin client can read
          // the async-publish status monitor target off the 202 response.
          // Content-Range/Accept-Ranges are what a cross-origin caller needs
          // to reason about a 206 byte-range response (Content-Length is
          // safelisted, but is listed for symmetry with the range pair).
          exposeHeaders:
            'ETag, Location, Retry-After, Content-Range, Accept-Ranges, Content-Length',
          allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS,QUERY',
          // Cache the preflight response for 24 h. Without this @koa/cors
          // omits Access-Control-Max-Age and Chrome falls back to its
          // ~5 s default, which forces a fresh OPTIONS round-trip in front
          // of nearly every cross-origin QUERY the host fires during a
          // long indexing run. The doubled HTTP-arrival count translates
          // directly to wall-clock since each preflight is a serial RTT
          // blocking the QUERY behind it.
          maxAge: 86400,
        }),
      )
      .use(async (ctx, next) => {
        // Disable browser cache for all data requests to the realm server. The condition captures our supported mime types but not others,
        // such as assets, which we probably want to cache.
        let mimeType = extractSupportedMimeType(
          ctx.header.accept as unknown as null | string | [string],
        );

        if (
          Object.values(SupportedMimeType)
            // Actually, we want to use HTTP caching for executable modules which
            // are requested with the "*/*" accept header
            .filter((m) => m !== '*/*')
            .includes(mimeType as any)
        ) {
          ctx.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        }

        await next();
      })
      .use(convertAcceptHeaderQueryParam)
      .use(methodOverrideSupport)
      .use(
        createRoutes({
          dbAdapter: this.dbAdapter,
          definitionLookup: this.definitionLookup,
          mediaCacheAdapter: this.mediaCacheAdapter,
          serverURL: this.serverURL.href,
          matrixClient: this.matrixClient,
          realmServerSecretSeed: this.realmServerSecretSeed,
          realmSecretSeed: this.realmSecretSeed,
          grafanaSecret: this.grafanaSecret,
          aiBotDelegationSecret: this.aiBotDelegationSecret,
          virtualNetwork: this.virtualNetwork,
          serveHostApp,
          serveIndex,
          serveFromRealm,
          sendEvent,
          queue: this.queue,
          realms: this.realms,
          assetsURL: this.assetsURL,
          realmsRootPath: this.realmsRootPath,
          getMatrixRegistrationSecret: this.getMatrixRegistrationSecret,
          matrixAdminUsername: this.matrixAdminUsername,
          matrixAdminPassword: this.matrixAdminPassword,
          domainsForPublishedRealms: this.domainsForPublishedRealms,
          prerenderer: this.prerenderer,
          reportHostShell: this.reportHostShell,
          reconciler: this.reconciler,
          searchCache: this.searchCache,
        }),
      )
      .use(
        proxyAsset('/auth-service-worker.js', this.assetsURL, {
          requestHeaders: {
            'accept-encoding': 'identity',
          },
        }),
      )
      .use(serveIndex)
      .use(serveFromRealm);

    app.on('error', (err, ctx) => {
      console.error(`Unhandled server error`, err);
      Sentry.withScope((scope) => {
        scope.setSDKProcessingMetadata({ request: ctx.request });
        Sentry.captureException(err);
      });
    });

    return app;
  }

  listen(port: number): RealmHttpServer {
    let { server: instance, proto } = createListener(this.log, this.app);
    instance.listen(port);
    instance.on('listening', () => {
      let actualPort =
        (instance.address() as import('net').AddressInfo | null)?.port ?? port;
      this.log.info(
        `Realm server listening on port %s (%s)\n`,
        actualPort,
        proto,
      );
    });
    return instance;
  }

  async start() {
    // Phase 3: two paths converge here.
    //
    // 1. Constructor-supplied realms — test helpers and any legacy boot
    //    code path push realms directly into `this.realms` before
    //    server.start() runs and expect this method to call
    //    realm.start() on them (it used to do this implicitly via
    //    loadRealms()). They are not in reconciler.knownByUrl, so the
    //    reconcile pass below would skip them. Iterate first, in
    //    insertion order — realms[] is empty in production main.ts, so
    //    this is a no-op there.
    // 2. Reconciler-driven boot — reconciler.reconcile() reads
    //    realm_registry into knownByUrl and eager-mounts every pinned
    //    row via mountFromRow (the main.ts factory), which constructs
    //    a Realm, publishes into realms[] + virtualNetwork, then
    //    awaits realm.start() so each pinned realm is fully indexed
    //    before this method returns. Non-pinned rows are deferred to
    //    findOrMountRealm() on first request.
    //
    // The reconciler's background poll loop (LISTEN realm_registry +
    // 30s safety poll) starts in main.ts after this method returns.
    for (let realm of this.realms) {
      await realm.start();
    }
    await this.reconciler.reconcile();
  }

  get testingOnlyRealms() {
    return [...this.realms];
  }

  // Test-only accessor for the on-disk root that source/published realm
  // disk_ids resolve under. Exposed so download-realm tests can stage a
  // source realm at <realmsRootPath>/<disk_id> + matching realm_registry
  // row to exercise the post-restart code path (CS-11270) without
  // spinning up a full RealmServer for a second realm.
  get testingOnlyRealmsRootPath() {
    return this.realmsRootPath;
  }

  // Test-only accessor for the reconciler. Exposed so realm-auth-test
  // can inspect knownByUrl / mounted as preconditions and assert that
  // _realm-auth does not cold-mount during request handling.
  get testingOnlyReconciler() {
    return this.reconciler;
  }

  testingOnlyUnmountRealms() {
    for (let realm of this.realms) {
      this.virtualNetwork.unmount(realm.handle);
    }
  }

  // Drop a realm from this process's in-memory view to simulate a
  // post-restart state, without tearing down its disk mount, indexer,
  // or matrix client. Two regression-test shapes need different
  // amounts of eviction:
  //
  //   - Default (keepMounted: false) — remove from BOTH `realms[]` and
  //     `reconciler.mounted`, leaving only the realm_registry row /
  //     `knownByUrl` entry. This is the true post-restart state for a
  //     non-pinned realm: a handler that wants the realm must resolve
  //     it from the registry (and would cold-mount via lookupOrMount
  //     if it actually needs a started Realm). realm-auth-test uses
  //     this to prove `_realm-auth` issues a JWT from registry
  //     presence alone, without mounting.
  //
  //   - keepMounted: true — remove from `realms[]` only, leaving the
  //     realm in `reconciler.mounted`. Use this for handlers that DO
  //     route through `reconciler.lookupOrMount` (e.g. the
  //     `_grafana-reindex` path): the test proves the handler consults
  //     the reconciler rather than iterating `realms[]`, while the
  //     mounted fast-path keeps `lookupOrMount` from constructing a
  //     second `Realm` against the already-mounted disk (which would
  //     race on workers / matrix / queue subscribers). The genuine
  //     cold-mount path is covered against the reconciler directly in
  //     lazy-mount-test.ts.
  testingOnlyEvictRealmFromRealmsList(
    url: string,
    opts?: { keepMounted?: boolean },
  ): void {
    let idx = this.realms.findIndex((r) => r.url === url);
    if (idx !== -1) {
      this.realms.splice(idx, 1);
    }
    if (!opts?.keepMounted) {
      this.reconciler.mounted.delete(url);
    }
  }

  // Test-only accessor for the request-path realm resolver. Exposed so
  // lazy-mount integration tests can drive findOrMountRealm directly
  // without spinning up an HTTP listener + mocked Koa context.
  testingOnlyFindOrMountRealm(requestURL: URL): Promise<Realm | undefined> {
    return findOrMountRealm(requestURL, {
      realms: this.realms,
      reconciler: this.reconciler,
      dbAdapter: this.dbAdapter,
    });
  }

  // Test-only synchronous reconcile pass. The production reconciler
  // wakes on NOTIFY realm_registry, but tests need a deterministic
  // way to drive the post-DELETE unmount path without polling.
  testingOnlyReconcile(): Promise<void> {
    return this.reconciler.reconcile();
  }

  // we use a function to get the matrix registration secret because matrix
  // client tests leverage a synapse instance that changes multiple times per
  // realm lifespan, and each new synapse instance has a unique registration
  // secret
  private getMatrixRegistrationSecret = async () => {
    if (this.getRegistrationSecret) {
      let secret = await this.getRegistrationSecret();
      if (!secret) {
        throw new Error(
          `the getRegistrationSecret() function returned no secret`,
        );
      }
      return secret;
    }

    if (this.matrixRegistrationSecret) {
      return this.matrixRegistrationSecret;
    }

    throw new Error(`Can not determine the matrix registration secret`);
  };
}

function detectRealmCollision(realms: Realm[]): void {
  let collisions: string[] = [];
  let realmsURLs = realms.map(({ url }) => ({
    url,
    path: new URL(url).pathname,
  }));
  for (let realmA of realmsURLs) {
    for (let realmB of realmsURLs) {
      if (realmA.path.length > realmB.path.length) {
        if (realmA.path.startsWith(realmB.path)) {
          collisions.push(`${realmA.url} collides with ${realmB.url}`);
        }
      }
    }
  }
  if (collisions.length > 0) {
    throw new Error(
      `Cannot start realm server--realm route collisions detected: ${JSON.stringify(
        collisions,
      )}`,
    );
  }
}
